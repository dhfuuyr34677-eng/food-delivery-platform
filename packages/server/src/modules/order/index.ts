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
  deliveryOrders,
  splitOrders,
  splitReceivers,
  paymentProviders,
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
  DeliveryOrderStatus,
  USER_CANCELLABLE_STATUSES,
  SplitStatus,
  SplitReceiverType,
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
import { getProviderForShop } from '../../services/delivery/index.js';
import { getGatewayForOrder, getProviderById } from '../../services/payment-gateway/index.js';
import type { SplitReceiver } from '../../services/payment-gateway/types.js';

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
  const orderNo = generateOrderNo();

  // If shop uses platform delivery, query delivery fee
  let deliveryFee = 0;
  let deliveryOrderId: string | null = null;

  if (shop.deliveryType === 'platform') {
    const deliveryInfo = await getProviderForShop(shopId);
    if (deliveryInfo) {
      // Extract coordinates from address geometry via raw SQL
      const [coordRow] = await db.execute(
        `SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng FROM addresses WHERE id = '${addressId}'`,
      );
      const addrLat = (coordRow as Record<string, unknown> | undefined)?.lat as number | undefined;
      const addrLng = (coordRow as Record<string, unknown> | undefined)?.lng as number | undefined;

      if (addrLat != null && addrLng != null) {
        try {
          const feeResult = await deliveryInfo.provider.queryFee({
            externalShopNo: deliveryInfo.externalShopNo,
            originId: orderNo,
            cityCode: '028',
            cargoPrice: totalAmount / 100,
            isPrepay: 0,
            receiverName: address.contactName,
            receiverAddress: address.address,
            receiverLat: Number(addrLat),
            receiverLng: Number(addrLng),
            receiverPhone: address.phone,
            cargoWeight: 1,
            cargoType: 1,
            callback: `${process.env.APP_BASE_URL ?? 'http://localhost:8787'}/api/delivery/callback/dada`,
          });
          deliveryFee = feeResult.deliveryFee;
        } catch (err) {
          console.error('[Order] Delivery fee query failed:', err);
          // Don't block order creation — fall back to deliveryFee=0
        }
      }
    }
  }

  // Calculate split breakdown (immutable — locked at order creation)
  const grossAmount = totalAmount + deliveryFee;
  const commissionRate = Number(shop.commissionRate) / 100; // e.g., 5 -> 0.05
  const platformCommission = Math.floor(totalAmount * commissionRate); // fen
  const merchantAmount = grossAmount - platformCommission - deliveryFee;

  // Create order with address snapshot + split fields
  const [order] = await db
    .insert(orders)
    .values({
      orderNo,
      userId,
      shopId,
      totalAmount: grossAmount,
      deliveryFee,
      platformCommission,
      merchantAmount,
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

  // Create delivery order record for platform shops
  if (shop.deliveryType === 'platform' && shop.deliveryProviderId) {
    const [dOrder] = await db
      .insert(deliveryOrders)
      .values({
        orderId: order.id,
        providerId: shop.deliveryProviderId,
        deliveryFee: deliveryFee > 0 ? deliveryFee : null,
        status: DeliveryOrderStatus.PENDING,
      })
      .returning();
    deliveryOrderId = dOrder?.id ?? null;
  }

  // Notify merchant via WebSocket
  notifyUser(shopId, {
    type: 'new_order',
    orderNo: order.orderNo,
    amount: order.totalAmount,
  });

  // Create payment via gateway (supports direct WeChat Pay + aggregated providers)
  const [user] = await db
    .select({ openid: users.openid })
    .from(users)
    .where(eq(users.id, userId));

  const gateway = await getGatewayForOrder();
  const paymentResult = await gateway.createPayment({
    orderId: order.id,
    orderNo: order.orderNo,
    amount: grossAmount,
    description: `${shop.name}外卖订单`,
    payerOpenid: user!.openid,
    notifyUrl: `${process.env.APP_BASE_URL ?? 'http://localhost:8787'}/api/order/payment/callback`,
  });

  // Save prepay_id for idempotency
  await db
    .update(orders)
    .set({ prepayId: paymentResult.prepayId })
    .where(eq(orders.id, order.id));

  return c.json({
    orderNo: order.orderNo,
    orderId: order.id,
    payment: paymentResult.jsapiParams,
  }, 201);
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

  // Include delivery order info if present
  const [deliveryOrder] = await db
    .select()
    .from(deliveryOrders)
    .where(eq(deliveryOrders.orderId, order.id));

  return c.json({
    ...order,
    items,
    statusLogs: logs,
    delivery: deliveryOrder ?? null,
  });
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

    // Auto-create split order (fire-and-forget — failures are caught by cron)
    try {
      await createSplitForOrder(order.id);
    } catch (err) {
      console.error('[Payment] Failed to auto-create split order:', err);
      // Don't fail the callback — the cron split-sync will retry
    }

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

  // Cancel delivery order if exists and not terminal
  try {
    const [dOrder] = await db
      .select()
      .from(deliveryOrders)
      .where(eq(deliveryOrders.orderId, id));

    if (dOrder && dOrder.externalOrderId) {
      const delivery = await getProviderForShop(order.shopId);
      if (delivery) {
        try {
          await delivery.provider.cancelOrder(dOrder.externalOrderId, 'Platform order cancelled');
        } catch (err) {
          console.error('[Order] Delivery cancel failed:', err);
        }
      }
      // Mark delivery as cancelled regardless of API success
      await db
        .update(deliveryOrders)
        .set({ status: DeliveryOrderStatus.CANCELLED, updatedAt: new Date() })
        .where(eq(deliveryOrders.id, dOrder.id));
    }
  } catch (err) {
    console.error('[Order] Delivery order lookup failed:', err);
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

  // Close split order if exists (cancelled orders don't need profit sharing)
  try {
    await closeSplitForOrder(id);
  } catch (err) {
    console.error('[Order] Failed to close split on cancel:', err);
  }

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
        // Auto-create split on payment sync
        try {
          await createSplitForOrder(order.id);
        } catch (err) {
          console.error('[Order] Failed to auto-create split on payment sync:', err);
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
// merchantOrderAction('deliver', ...) — see custom handler below

// ── POST /api/order/merchant/:id/deliver ─────
// Handles both self-delivery and platform delivery dispatch

orderRoutes.post(
  '/merchant/:id/deliver',
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

    if (!canTransition(order.status, OrderStatus.DELIVERING)) {
      return c.json(
        { code: ErrorCode.INVALID_STATUS_TRANSITION, message: `无法从 ${order.status} 转换到 delivering` },
        400,
      );
    }

    await db.update(orders)
      .set({ status: OrderStatus.DELIVERING, updatedAt: new Date() })
      .where(eq(orders.id, id));

    await db.insert(orderStatusLogs).values({
      orderId: id, fromStatus: order.status, toStatus: OrderStatus.DELIVERING,
      operatorRole: 'merchant', operatorId: sub,
    });

    notifyUser(order.userId, { type: 'order_update', orderNo: order.orderNo, status: OrderStatus.DELIVERING });

    // Platform shop: dispatch to third-party delivery provider
    const [orderShop] = await db.select({ deliveryType: shops.deliveryType })
      .from(shops).where(eq(shops.id, order.shopId));

    if (orderShop?.deliveryType === 'platform') {
      const deliveryInfo = await getProviderForShop(order.shopId);
      if (deliveryInfo) {
        let receiverLat = 30.5728, receiverLng = 104.0668;
        const snap = order.addressSnapshot as Record<string, string> | null;
        const receiverName = snap?.contactName ?? '';
        const receiverPhone = snap?.phone ?? '';
        const receiverAddress = snap?.address ?? '';

        try {
          const [userAddr] = await db.select().from(addresses)
            .where(eq(addresses.userId, order.userId)).limit(1);
          if (userAddr?.location) {
            const [coord] = await db.execute(
              `SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng FROM addresses WHERE id = '${userAddr.id}'`,
            );
            const lat = (coord as Record<string, unknown> | undefined)?.lat as number | undefined;
            const lng = (coord as Record<string, unknown> | undefined)?.lng as number | undefined;
            if (lat != null && lng != null) { receiverLat = Number(lat); receiverLng = Number(lng); }
          }
        } catch { /* use defaults */ }

        try {
          const result = await deliveryInfo.provider.createOrder({
            externalShopNo: deliveryInfo.externalShopNo,
            originId: order.orderNo,
            cityCode: '028',
            cargoPrice: (order.totalAmount - (order.deliveryFee ?? 0)) / 100,
            isPrepay: 0,
            receiverName: receiverName || '收件人',
            receiverAddress: receiverAddress || '未知地址',
            receiverLat, receiverLng,
            receiverPhone: receiverPhone || '',
            cargoWeight: 1,
            cargoType: 1,
            callback: `${process.env.APP_BASE_URL ?? 'http://localhost:8787'}/api/delivery/callback/dada`,
          });

          await db.update(deliveryOrders)
            .set({
              externalOrderId: result.externalOrderId,
              deliveryFee: result.deliveryFee,
              deliveryDistance: result.distance,
              status: DeliveryOrderStatus.CREATED,
              updatedAt: new Date(),
            })
            .where(eq(deliveryOrders.orderId, order.id));
        } catch (err) {
          console.error('[Order] Create delivery failed:', err);
        }
      }
    }

    return c.json({ status: OrderStatus.DELIVERING });
  },
);

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

// ── Split Helpers ──────────────────────────

/**
 * Create a split (profit sharing) order for a paid order.
 * Idempotent — safe to call multiple times.
 */
export async function createSplitForOrder(orderId: string): Promise<void> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order || order.splitStatus !== SplitStatus.UNSPLIT) return;
  if (order.paymentStatus !== 'paid' || !order.transactionId) return;

  const gateway = await getGatewayForOrder();

  // Build receivers list
  const receivers: SplitReceiver[] = [];

  // 1. Platform commission
  if (order.platformCommission > 0) {
    receivers.push({
      receiverType: SplitReceiverType.PLATFORM,
      receiverId: 'platform',
      receiverName: '平台佣金',
      amount: order.platformCommission,
      description: `订单#${order.orderNo} 平台抽成`,
    });
  }

  // 2. Merchant share (requires settlement account on shop)
  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.id, order.shopId));

  if (order.merchantAmount > 0) {
    const settlementAccount = shop?.settlementAccount as Record<string, string> | null;
    const receiverId = settlementAccount?.accountNo ?? order.shopId;
    const receiverName = settlementAccount?.accountName ?? shop?.name ?? '商户';
    receivers.push({
      receiverType: SplitReceiverType.MERCHANT,
      receiverId,
      receiverName,
      amount: order.merchantAmount,
      description: `订单#${order.orderNo} 商户收入`,
    });
  }

  // 3. Delivery fee (only for platform delivery orders)
  if (order.deliveryFee && order.deliveryFee > 0) {
    receivers.push({
      receiverType: SplitReceiverType.DELIVERY,
      receiverId: 'delivery',
      receiverName: '配送费',
      amount: order.deliveryFee,
      description: `订单#${order.orderNo} 配送费`,
    });
  }

  if (receivers.length === 0) {
    await db
      .update(orders)
      .set({ splitStatus: SplitStatus.CLOSED })
      .where(eq(orders.id, orderId));
    return;
  }

  // Get the default payment provider ID
  const [defaultProvider] = await db
    .select()
    .from(paymentProviders)
    .where(eq(paymentProviders.isDefault, true))
    .limit(1);

  // Create split via gateway
  const splitResult = await gateway.createSplit({
    orderId: order.id,
    transactionId: order.transactionId,
    totalAmount: order.totalAmount,
    receivers,
    idempotencyKey: `split_${order.id}`,
  });

  // Insert split_orders row
  const [splitOrder] = await db
    .insert(splitOrders)
    .values({
      orderId: order.id,
      providerId: defaultProvider?.id ?? '00000000-0000-0000-0000-000000000000',
      gatewaySplitNo: splitResult.gatewaySplitNo,
      gatewayTransactionId: order.transactionId,
      totalAmount: order.totalAmount,
      unfinishAmount: order.totalAmount,
      status: SplitStatus.PROCESSING,
    })
    .returning();

  // Insert split_receivers rows
  for (const result of splitResult.receiverResults) {
    const receiverDef = receivers.find((r) => r.receiverType === result.receiverType);
    if (receiverDef) {
      await db.insert(splitReceivers).values({
        splitOrderId: splitOrder.id,
        receiverType: receiverDef.receiverType,
        receiverId: receiverDef.receiverId,
        receiverName: receiverDef.receiverName,
        amount: receiverDef.amount,
        description: receiverDef.description,
        gatewaySplitNo: result.gatewaySplitNo,
        result: result.result,
      });
    }
  }

  // Update order.splitStatus
  await db
    .update(orders)
    .set({ splitStatus: SplitStatus.PROCESSING })
    .where(eq(orders.id, orderId));

  console.log(`[Split] Created split order ${splitOrder.id} for order ${order.orderNo}`);
}

/**
 * Finish a split order — releases frozen funds to receivers.
 * Called when the order transitions to 'completed'.
 */
export async function finishSplitForOrder(orderId: string): Promise<void> {
  const [splitOrder] = await db
    .select()
    .from(splitOrders)
    .where(eq(splitOrders.orderId, orderId));

  if (!splitOrder || splitOrder.status !== SplitStatus.PROCESSING) return;
  if (!splitOrder.gatewaySplitNo || !splitOrder.gatewayTransactionId) return;

  try {
    const gateway = await getProviderById(splitOrder.providerId);
    await gateway.finishSplit({
      gatewaySplitNo: splitOrder.gatewaySplitNo,
      transactionId: splitOrder.gatewayTransactionId,
      totalAmount: splitOrder.totalAmount,
      idempotencyKey: `finish_${splitOrder.id}`,
    });

    await db
      .update(splitOrders)
      .set({
        status: SplitStatus.FINISHED,
        finishedAt: new Date(),
        unfinishAmount: 0,
      })
      .where(eq(splitOrders.id, splitOrder.id));

    await db
      .update(orders)
      .set({ splitStatus: SplitStatus.FINISHED })
      .where(eq(orders.id, orderId));

    console.log(`[Split] Finished split for order ${orderId}`);
  } catch (err) {
    console.error(`[Split] Failed to finish split for order ${orderId}:`, err);
  }
}

/**
 * Close split — marks as not needed (used when order is cancelled before split creation).
 */
export async function closeSplitForOrder(orderId: string): Promise<void> {
  await db
    .update(orders)
    .set({ splitStatus: SplitStatus.CLOSED })
    .where(eq(orders.id, orderId));

  await db
    .update(splitOrders)
    .set({ status: SplitStatus.CLOSED })
    .where(eq(splitOrders.orderId, orderId));
}
