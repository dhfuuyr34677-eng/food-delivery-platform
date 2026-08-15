import { Hono } from 'hono';
import { z } from 'zod';
import {
  db,
  orders,
  deliveryOrders,
  deliveryProviders,
  deliveryCallbacks,
  shops,
} from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../utils/validator.js';
import { ErrorCode } from '@fd/shared';
import {
  mapDadaStatusToDeliveryStatus,
  DeliveryOrderStatus,
  isDeliveryTerminal,
} from '@fd/shared';
import { notifyUser } from '../../services/websocket.js';
import { getProviderById } from '../../services/delivery/index.js';
import { finishSplitForOrder } from '../order/index.js';

export const deliveryRoutes = new Hono();

// ── Schemas ─────────────────────────────────────────

const feeEstimateSchema = z.object({
  shopId: z.string().uuid(),
  addressLat: z.number().min(-90).max(90),
  addressLng: z.number().min(-180).max(180),
  cargoPrice: z.number().positive(),
  cargoWeight: z.number().positive().default(1),
});

// ── GET /api/delivery/fee/estimate ─────────────────
// Estimate delivery fee before placing order

deliveryRoutes.get(
  '/fee/estimate',
  auth,
  validate(feeEstimateSchema),
  async (c) => {
    const { shopId, addressLat, addressLng, cargoPrice, cargoWeight } =
      c.get('validated');

    const [shop] = await db
      .select({
        deliveryType: shops.deliveryType,
        deliveryProviderId: shops.deliveryProviderId,
        externalShopNo: shops.externalShopNo,
        address: shops.address,
      })
      .from(shops)
      .where(eq(shops.id, shopId));

    if (!shop) {
      return c.json({ code: ErrorCode.SHOP_NOT_FOUND, message: 'Shop not found' }, 404);
    }

    if (shop.deliveryType !== 'platform') {
      return c.json({
        code: ErrorCode.DELIVERY_NOT_PLATFORM_SHOP,
        message: 'Shop uses self delivery, no third-party fee',
      }, 400);
    }

    if (!shop.deliveryProviderId || !shop.externalShopNo) {
      return c.json({
        code: ErrorCode.DELIVERY_PROVIDER_INACTIVE,
        message: 'Shop has no active delivery provider configured',
      }, 400);
    }

    const provider = await getProviderById(shop.deliveryProviderId);
    if (!provider) {
      return c.json({
        code: ErrorCode.DELIVERY_PROVIDER_INACTIVE,
        message: 'Delivery provider not found or inactive',
      }, 400);
    }

    try {
      const result = await provider.queryFee({
        externalShopNo: shop.externalShopNo,
        originId: `estimate_${shopId}_${Date.now()}`,
        cityCode: '028', // default to Chengdu, can be made configurable
        cargoPrice: Math.round(cargoPrice * 100) / 100, // ensure 2 decimal
        isPrepay: 0,
        receiverName: '',
        receiverAddress: '',
        receiverLat: addressLat,
        receiverLng: addressLng,
        receiverPhone: '',
        cargoWeight,
        cargoType: 1, // default: food
        callback: '',
      });

      return c.json({
        deliveryFee: result.deliveryFee,
        distance: result.distance,
      });
    } catch (err) {
      return c.json({
        code: ErrorCode.DELIVERY_FEE_QUERY_FAILED,
        message: err instanceof Error ? err.message : 'Failed to query delivery fee',
      }, 500);
    }
  },
);

// ── POST /api/delivery/callback/dada ───────────────
// Dada order status callback (no auth — verified via signature)

deliveryRoutes.post('/callback/dada', async (c) => {
  let payload: Record<string, unknown>;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(
      { code: ErrorCode.DELIVERY_CALLBACK_INVALID, message: 'Invalid JSON body' },
      400,
    );
  }

  // 1. Find the active Dada provider to verify signature
  const [dadaProvider] = await db
    .select()
    .from(deliveryProviders)
    .where(eq(deliveryProviders.name, 'dada'));

  if (!dadaProvider) {
    // No Dada provider configured yet — log and accept
    console.warn('[dada callback] No Dada provider configured');
    return c.json({ ok: true });
  }

  const { getProviderById: _getProvider } = await import(
    '../../services/delivery/index.js'
  );
  const provider = await _getProvider(dadaProvider.id);

  if (!provider) {
    console.warn('[dada callback] Provider inactive');
    return c.json({ ok: true });
  }

  // 2. Verify signature
  if (!provider.verifyCallback(payload)) {
    // Log invalid callback
    await db.insert(deliveryCallbacks).values({
      providerId: dadaProvider.id,
      rawBody: JSON.stringify(payload),
      parsedStatus: 'invalid_signature',
    });
    return c.json(
      { code: ErrorCode.DELIVERY_CALLBACK_INVALID, message: 'Invalid signature' },
      403,
    );
  }

  // 3. Parse status from Dada callback
  // Dada callback fields: order_id, client_id, order_status, cancel_reason, ...
  const orderStatus = payload.order_status as number | undefined;
  const externalOrderId = (payload.order_id ?? payload.client_id) as
    | string
    | undefined;

  // Save callback log
  const parsedStatus = orderStatus != null ? String(orderStatus) : 'unknown';
  await db.insert(deliveryCallbacks).values({
    providerId: dadaProvider.id,
    rawBody: JSON.stringify(payload),
    parsedStatus,
  });

  if (!externalOrderId || orderStatus == null) {
    return c.json({ ok: true }); // Accept but don't process
  }

  // 4. Find the delivery_order by external_order_id
  const [deliveryOrder] = await db
    .select()
    .from(deliveryOrders)
    .where(eq(deliveryOrders.externalOrderId, externalOrderId));

  if (!deliveryOrder) {
    console.warn(
      `[dada callback] Delivery order not found for external ID: ${externalOrderId}`,
    );
    return c.json({ ok: true });
  }

  // 5. Map and update delivery status
  const mappedStatus = mapDadaStatusToDeliveryStatus(orderStatus);

  // Update delivery_order
  await db
    .update(deliveryOrders)
    .set({
      status: mappedStatus,
      statusDetail: payload,
      riderName: (payload.transporter_name as string) ?? undefined,
      riderPhone: (payload.transporter_phone as string) ?? undefined,
      riderLat: payload.transporter_lat != null
        ? String(payload.transporter_lat)
        : undefined,
      riderLng: payload.transporter_lng != null
        ? String(payload.transporter_lng)
        : undefined,
      estimatedDeliveryTime: payload.expect_fetch_time
        ? new Date(payload.expect_fetch_time as string).toISOString() as unknown as Date
        : undefined,
      ...(mappedStatus === DeliveryOrderStatus.DELIVERED
        ? { actualDeliveryTime: new Date() }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(deliveryOrders.id, deliveryOrder.id));

  // 6. If delivered, also update the order status to completed
  if (mappedStatus === DeliveryOrderStatus.DELIVERED) {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, deliveryOrder.orderId));

    if (order && order.status !== 'completed') {
      await db
        .update(orders)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(orders.id, order.id));

      // Notify customer and merchant
      notifyUser(order.userId, {
        type: 'order_delivered',
        orderId: order.id,
        orderNo: order.orderNo,
      });
      notifyUser(order.shopId, {
        type: 'order_delivered',
        orderId: order.id,
        orderNo: order.orderNo,
      });

      // Auto-finish profit sharing split on delivery completion
      try {
        await finishSplitForOrder(order.id);
      } catch (err) {
        console.error('[Delivery] Failed to finish split on delivery:', err);
      }
    }
  }

  // 7. Notify customer on rider status change
  if (deliveryOrder.orderId) {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, deliveryOrder.orderId));

    if (order) {
      if (mappedStatus === DeliveryOrderStatus.ASSIGNED) {
        notifyUser(order.userId, {
          type: 'order_accepted',
          orderId: order.id,
          riderName: payload.transporter_name,
        });
      } else if (mappedStatus === DeliveryOrderStatus.PICKED_UP) {
        notifyUser(order.userId, {
          type: 'rider_picked_up',
          orderId: order.id,
        });
      } else if (mappedStatus === DeliveryOrderStatus.DELIVERING) {
        notifyUser(order.userId, {
          type: 'rider_arriving',
          orderId: order.id,
        });
      }
    }
  }

  return c.json({ ok: true });
});
