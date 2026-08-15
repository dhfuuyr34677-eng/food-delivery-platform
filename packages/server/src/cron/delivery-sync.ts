import { db, deliveryOrders, orders } from '../db';
import { ne, and, eq, lt } from 'drizzle-orm';
import { DeliveryOrderStatus, mapDadaStatusToDeliveryStatus } from '@fd/shared';
import { getProviderById } from '../services/delivery/index';
import { notifyUser } from '../services/websocket';

const NON_TERMINAL = [
  DeliveryOrderStatus.PENDING,
  DeliveryOrderStatus.CREATED,
  DeliveryOrderStatus.ASSIGNED,
  DeliveryOrderStatus.PICKED_UP,
  DeliveryOrderStatus.DELIVERING,
];

/**
 * Poll non-terminal delivery orders every 2 minutes.
 * Queries third-party provider for latest status and syncs.
 * This is the fallback for missed callbacks.
 */
export async function syncDeliveryOrders(): Promise<void> {
  try {
    const pendingDeliveries = await db
      .select()
      .from(deliveryOrders)
      .where(and(
        // Only poll orders that have an external order ID
        ne(deliveryOrders.externalOrderId, ''),
        // Only non-terminal statuses
        ...NON_TERMINAL.map((s) => ne(deliveryOrders.status, s)),
      ));

    // Fix: use a proper OR condition instead of ne() chaining
    // Actually, just filter in JS for simplicity
    const allDeliveries = await db
      .select()
      .from(deliveryOrders)
      .where(and(
        ne(deliveryOrders.externalOrderId, ''),
      ));

    const active = allDeliveries.filter((d) =>
      (NON_TERMINAL as readonly string[]).includes(d.status),
    );

    if (active.length === 0) return;

    console.log(`[Cron] Syncing ${active.length} delivery orders...`);

    for (const delivery of active) {
      try {
        const provider = await getProviderById(delivery.providerId);
        if (!provider) continue;

        const status = await provider.queryStatus(delivery.externalOrderId!);
        const mappedStatus = mapDadaStatusToDeliveryStatus(status.statusCode);

        // Update delivery order
        await db
          .update(deliveryOrders)
          .set({
            status: mappedStatus,
            statusDetail: status.raw as Record<string, unknown>,
            riderName: status.riderName ?? undefined,
            riderPhone: status.riderPhone ?? undefined,
            riderLat: status.riderLat != null ? String(status.riderLat) : undefined,
            riderLng: status.riderLng != null ? String(status.riderLng) : undefined,
            actualDeliveryTime: mappedStatus === DeliveryOrderStatus.DELIVERED
              ? new Date()
              : undefined,
            updatedAt: new Date(),
          })
          .where(eq(deliveryOrders.id, delivery.id));

        // If delivered, update order status
        if (mappedStatus === DeliveryOrderStatus.DELIVERED) {
          const [order] = await db
            .select()
            .from(orders)
            .where(eq(orders.id, delivery.orderId));

          if (order && order.status !== 'completed') {
            await db
              .update(orders)
              .set({ status: 'completed', updatedAt: new Date() })
              .where(eq(orders.id, order.id));

            notifyUser(order.userId, {
              type: 'order_delivered',
              orderId: order.id,
              orderNo: order.orderNo,
            });
          }
        }
      } catch (err) {
        console.error(`[Cron] Sync failed for delivery ${delivery.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[Cron] Delivery sync error:', err);
  }
}

let _interval: ReturnType<typeof setInterval> | null = null;

export function startDeliverySync(intervalMs = 120_000): void {
  if (_interval) return;
  console.log(`[Cron] Starting delivery sync (every ${intervalMs / 1000}s)`);
  _interval = setInterval(syncDeliveryOrders, intervalMs);
  // Do an immediate first sync
  syncDeliveryOrders();
}

export function stopDeliverySync(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    console.log('[Cron] Delivery sync stopped');
  }
}
