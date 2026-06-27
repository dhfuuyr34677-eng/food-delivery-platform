import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, inArray } from 'drizzle-orm';
import {
  db,
  orders,
  orderItems,
  orderStatusLogs,
  products,
  addresses,
  shops,
  users,
} from '../../db/index.js';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/role.js';
import { validate } from '../../utils/validator.js';
import {
  ErrorCode,
  generateOrderNo,
  calcOrderAmount,
  canTransition,
  OrderStatus,
  PaymentStatus,
  USER_CANCELLABLE_STATUSES,
} from '@fd/shared';
import { notifyUser } from '../../services/websocket.js';
import { getRedis } from '../../services/redis.js';
import {
  createJSAPIPrepay,
  buildJSAPIParams,
  verifyAndDecryptCallback,
  createRefund,
  queryOrder,
} from '../../services/wechat-pay.js';

export const orderRoutes = new Hono();

// ── Schemas ────────────────────────────────

const placeOrderSchema = z.object({
  shopId: z.string().uuid(),
  addressId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50),
  remark: z.string().max(200).optional(),
});

// ── POST /api/order ────────────────────────
// Place order: server recalculates amount, creates snapshots

orderRoutes.post('/', auth, validate(placeOrderSchema), async (c) => {
  const { sub: userId } = c.get('auth');
  const { shopId, addressId, items: inputItems, remark } = c.get('validated');

  // Verify address belongs to user
  const [address] = await db
    .select()
    .from(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));
  if (!address) return c.json({ code: ErrorCode.ADDRESS_NOT_FOUND }, 404);

  // Verify shop exists and is active
  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.id, shopId));
  if (!shop) return c.json({ code: ErrorCode.SHOP_NOT_FOUND }, 404);
  if (shop.status !== 'active') return c.json({ code: ErrorCode.SHOP_NOT_ACTIVE }, 400);

  // Fetch product prices from DB (price verification)
  const productIds = inputItems.map((i) => i.productId);
  const dbProducts = await db
    .select()
    .from(products)
    .where(and(inArray(products.id, productIds), eq(products.shopId, shopId)));

  const productMap = new Map(dbProducts.map((p) => [p.id, p]));

  // Validate all products exist and belong to shop
  for (const item of inputItems) {
    const p = productMap.get(item.productId);
    if (!p) {
      return c.json({ code: ErrorCode.PRODUCT_NOT_FOUND, message: `商品不存在: ${item.productId}` }, 400);
    }
    if (!p.isAvailable) {
      return c.json({ code: ErrorCode.PRODUCT_NOT_AVAILABLE, message: `商品已下架: ${p.name}` }, 400);
    }
  }

  // Calculate amounts from DB prices (don't trust client)
  const orderItems_data = inputItems.map((item) => {
    const p = productMap.get(item.productId)!;
    return {
      productId: p.id,
      productSnapshot: { name: p.name, image: p.image, price: p.price },
      quantity: item.quantity,
      unitPrice: p.price,
    };
  });

  const totalAmount = calcOrderAmount(orderItems_data);

  // Create order with address snapshot
  const orderNo = generateOrderNo();
  const [order] = await db
    .insert(orders)
    .values({
      orderNo,
      userId,
      shopId,
      totalAmount,
      deliveryFee: 0, // self-delivery, no platform fee
      remark,
      addressSnapshot: {
        contactName: address.contactName,
        phone: address.phone,
        address: address.address,
      },
    })
    .returning();

  // Create order items
  await db.insert(orderItems).values(
    orderItems_data.map((item) => ({
      orderId: order.id,
      ...item,
    })),
  );

  // Log status
  await db.insert(orderStatusLogs).values({
    orderId: order.id,
    toStatus: OrderStatus.PENDING,
    operatorRole: 'user',
    operatorId: userId,
  });

  // Notify merchant via WebSocket
  notifyUser(shopId, {
    type: 'new_order',
    orderNo: order.orderNo,
    amount: order.totalAmount,
  });

  // Create WeChat prepay order for mini-program payment
  const [user] = await db
    .select({ openid: users.openid })
    .from(users)
    .where(eq(users.id, userId));

  const { prepay_id } = await createJSAPIPrepay({
    orderNo: order.orderNo,
    openid: user!.openid,
    totalAmount,
    description: `${shop.name}外卖订单`,
  });

  // Save prepay_id for idempotency
  await db
    .update(orders)
    .set({ prepayId: prepay_id })
    .where(eq(orders.id, order.id));

  const payment = buildJSAPIParams(prepay_id);

  return c.json({ orderNo: order.orderNo, orderId: order.id, payment }, 201);
});

// ── GET /api/order ─────────────────────────
// User's order list

orderRoutes.get('/', auth, async (c) => {
  const { sub: userId } = c.get('auth');

  const list = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt));

  return c.json(list);
});

// ── GET /api/order/:id ─────────────────────
// Order detail with items and status logs

orderRoutes.get('/:id', auth, async (c) => {
  const id = c.req.param('id');
  const { sub, role, shopId } = c.get('auth');

  const where =
    role === 'merchant'
      ? and(eq(orders.id, id), eq(orders.shopId, shopId!))
      : and(eq(orders.id, id), eq(orders.userId, sub));

  const [order] = await db.select().from(orders).where(where);
  if (!order) return c.json({ code: ErrorCode.ORDER_NOT_FOUND }, 404);

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  const logs = await db
    .select()
    .from(orderStatusLogs)
    .where(eq(orderStatusLogs.orderId, order.id))
    .orderBy(orderStatusLogs.createdAt);

  return c.json({ ...order, items, statusLogs: logs });
});

// ── POST /api/order/payment/callback ────────
// WeChat Pay notification (no auth — called by WeChat server)

orderRoutes.post('/payment/callback', async (c) => {
  try {
    const body = await c.req.text();
    const headers = {
      'wechatpay-timestamp': c.req.header('Wechatpay-Timestamp') ?? '',
      'wechatpay-nonce': c.req.header('Wechatpay-Nonce') ?? '',
      'wechatpay-signature': c.req.header('Wechatpay-Signature') ?? '',
      'wechatpay-serial': c.req.header('Wechatpay-Serial') ?? '',
    };

    const resource = await verifyAndDecryptCallback(headers, body);
    if (resource.trade_state !== 'SUCCESS') {
      return c.json({ code: 'SUCCESS', message: 'OK' });
    }

    // Idempotency: Redis lock prevents duplicate processing
    const redis = getRedis();
    const lockKey = `payment_callback:${resource.out_trade_no}`;
    const locked = await redis.set(lockKey, '1', 'EX', 30, 'NX');
    if (!locked) {
      return c.json({ code: 'SUCCESS', message: 'OK' });
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNo, resource.out_trade_no));

    if (!order || order.paymentStatus === 'paid') {
      return c.json({ code: 'SUCCESS', message: 'OK' });
    }

    // Update payment status
    await db
      .update(orders)
      .set({
        paymentStatus: 'paid',
        transactionId: resource.transaction_id,
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    // Transition: pending -> confirmed (payment auto-confirms)
    if (order.status === 'pending') {
      await db
        .update(orders)
        .set({ status: 'confirmed', updatedAt: new Date() })
        .where(eq(orders.id, order.id));

      await db.insert(orderStatusLogs).values({
        orderId: order.id,
        fromStatus: 'pending',
        toStatus: 'confirmed',
        operatorRole: 'user',
        operatorId: order.userId,
        remark: '微信支付成功，自动确认',
      });
    }

    // Notify merchant
    notifyUser(order.shopId, {
      type: 'order_paid',
      orderNo: order.orderNo,
      amount: order.totalAmount,
    });

    return c.json({ code: 'SUCCESS', message: 'OK' });
  } catch (err) {
    console.error('[Payment] Callback error:', err);
    // Always return 200 to WeChat to prevent retry flooding
    return c.json({ code: 'FAIL', message: 'Internal error' });
  }
});

// ── POST /api/order/:id/cancel ─────────────

orderRoutes.post('/:id/cancel', auth, async (c) => {
  const id = c.req.param('id');
  const { sub, role } = c.get('auth');

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id));
  if (!order) return c.json({ code: ErrorCode.ORDER_NOT_FOUND }, 404);

  // Check ownership
  if (role === 'user' && order.userId !== sub) {
    return c.json({ code: ErrorCode.FORBIDDEN }, 403);
  }

  // Check cancellable
  if (role === 'user' && !USER_CANCELLABLE_STATUSES.includes(order.status)) {
    return c.json(
      { code: ErrorCode.ORDER_NOT_CANCELLABLE, message: '当前状态不可取消' },
      400,
    );
  }

  // State machine validation
  if (!canTransition(order.status, OrderStatus.CANCELLED)) {
    return c.json({ code: ErrorCode.INVALID_STATUS_TRANSITION }, 400);
  }

  // Refund if already paid
  if (order.paymentStatus === 'paid' && order.transactionId) {
    try {
      await createRefund({
        outTradeNo: order.orderNo,
        transactionId: order.transactionId,
        totalAmount: order.totalAmount,
        refundAmount: order.totalAmount,
      });
      await db
        .update(orders)
        .set({ paymentStatus: 'refunded' })
        .where(eq(orders.id, id));
    } catch (err) {
      console.error('[Order] Refund failed:', err);
      await db
        .update(orders)
        .set({ paymentStatus: 'refunding' })
        .where(eq(orders.id, id));
    }
  }

  // Cancel order
  await db
    .update(orders)
    .set({ status: OrderStatus.CANCELLED, updatedAt: new Date() })
    .where(eq(orders.id, id));

  // Log
  await db.insert(orderStatusLogs).values({
    orderId: id,
    fromStatus: order.status,
    toStatus: OrderStatus.CANCELLED,
    operatorRole: role,
    operatorId: sub,
  });

  // Notify
  notifyUser(order.userId, {
    type: 'order_cancelled',
    orderNo: order.orderNo,
  });
  notifyUser(order.shopId, {
    type: 'order_cancelled',
    orderNo: order.orderNo,
  });

  return c.json({ status: OrderStatus.CANCELLED });
});

// ── POST /api/order/:id/query-payment ───────
// Sync payment status from WeChat (fallback if callback missed)

orderRoutes.post('/:id/query-payment', auth, async (c) => {
  const id = c.req.param('id');
  const { sub } = c.get('auth');

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.userId, sub)));
  if (!order) return c.json({ code: ErrorCode.ORDER_NOT_FOUND }, 404);

  if (order.paymentStatus === 'paid') {
    return c.json({ paymentStatus: order.paymentStatus });
  }

  try {
    const result = await queryOrder(order.orderNo);
    if (
      result.trade_state === 'SUCCESS' &&
      result.transaction_id
    ) {
      const redis = getRedis();
      const lockKey = `payment_callback:${order.orderNo}`;
      const locked = await redis.set(lockKey, '1', 'EX', 30, 'NX');
      if (locked) {
        await db
          .update(orders)
          .set({
            paymentStatus: 'paid',
            transactionId: result.transaction_id,
            paidAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id));

        if (order.status === 'pending') {
          await db
            .update(orders)
            .set({ status: 'confirmed', updatedAt: new Date() })
            .where(eq(orders.id, order.id));

          await db.insert(orderStatusLogs).values({
            orderId: order.id,
            fromStatus: 'pending',
            toStatus: 'confirmed',
            operatorRole: 'user',
            operatorId: order.userId,
            remark: '支付同步确认',
          });
        }
        return c.json({ paymentStatus: 'paid' });
      }
    }
  } catch {
    // Query failed — return current status
  }

  return c.json({ paymentStatus: order.paymentStatus });
});

// ── Merchant Order Operations ──────────────
// accept / reject / prepare / deliver

function merchantOrderAction(
  path: string,
  targetStatus: string,
) {
  return orderRoutes.post(
    `/merchant/:id/${path}`,
    auth,
    requireRole('merchant'),
    async (c) => {
      const id = c.req.param('id');
      const { sub, shopId } = c.get('auth');

      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, id), eq(orders.shopId, shopId!)));
      if (!order) return c.json({ code: ErrorCode.ORDER_NOT_FOUND }, 404);

      if (!canTransition(order.status, targetStatus)) {
        return c.json(
          {
            code: ErrorCode.INVALID_STATUS_TRANSITION,
            message: `无法从 ${order.status} 转换到 ${targetStatus}`,
          },
          400,
        );
      }

      await db
        .update(orders)
        .set({ status: targetStatus, updatedAt: new Date() })
        .where(eq(orders.id, id));

      await db.insert(orderStatusLogs).values({
        orderId: id,
        fromStatus: order.status,
        toStatus: targetStatus,
        operatorRole: 'merchant',
        operatorId: sub,
      });

      // Notify user
      notifyUser(order.userId, {
        type: 'order_update',
        orderNo: order.orderNo,
        status: targetStatus,
      });

      return c.json({ status: targetStatus });
    },
  );
}

merchantOrderAction('accept', OrderStatus.CONFIRMED);
merchantOrderAction('reject', OrderStatus.CANCELLED);
merchantOrderAction('prepare', OrderStatus.PREPARING);
merchantOrderAction('deliver', OrderStatus.DELIVERING);

// ── GET /api/merchant/orders ───────────────
// (defined in merchant module, but aliased here for convenience)

orderRoutes.get('/merchant', auth, requireRole('merchant'), async (c) => {
  const { shopId } = c.get('auth');

  const list = await db
    .select()
    .from(orders)
    .where(eq(orders.shopId, shopId!))
    .orderBy(desc(orders.createdAt));

  return c.json(list);
});
