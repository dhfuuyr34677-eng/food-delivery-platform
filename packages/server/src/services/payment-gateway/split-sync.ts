// Split Status Sync Cron — polls stuck split orders and retries/reconciles.
// Follows the exact same pattern as cron/delivery-sync.ts

import { db } from '../../db';
import { splitOrders, splitReceivers, orders } from '../../db/schema';
import { eq, and, lt, isNull } from 'drizzle-orm';
import { getProviderById } from './index';
import { SplitStatus } from '@fd/shared';

let _interval: ReturnType<typeof setInterval> | null = null;

export function startSplitSync(intervalMs = 300_000): void {
  if (_interval) return;
  console.log(`[Cron] Starting split sync (every ${intervalMs / 1000}s)`);
  _interval = setInterval(syncSplitOrders, intervalMs);
  syncSplitOrders(); // immediate first run
}

export function stopSplitSync(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    console.log('[Cron] Split sync stopped');
  }
}

async function syncSplitOrders(): Promise<void> {
  try {
    // 1. Retry 'unsplit' orders that are paid but never got a split created
    const unpaidSplits = await db
      .select({
        so: splitOrders,
        o: orders,
      })
      .from(splitOrders)
      .innerJoin(orders, eq(splitOrders.orderId, orders.id))
      .where(
        and(
          eq(splitOrders.status, SplitStatus.UNSPLIT),
          eq(orders.paymentStatus, 'paid'),
          lt(splitOrders.retryCount, 5),
        ),
      )
      .limit(50);

    for (const { so } of unpaidSplits) {
      try {
        console.log(`[Cron] Sync unsplit order: ${so.orderId}`);
        // The split creation is idempotent — calling createSplit with the
        // same order ID will return the same result. The order module's
        // createSplitForOrder handles the full workflow.
        // We just mark for retry here; the actual retry is triggered by
        // the order module's payment callback or admin manual action.
        await db
          .update(splitOrders)
          .set({ retryCount: so.retryCount + 1 })
          .where(eq(splitOrders.id, so.id));
      } catch (err) {
        console.error(`[Cron] Failed to sync unsplit ${so.orderId}:`, err);
      }
    }

    // 2. Query gateway for 'processing' splits to check progress
    const processingSplits = await db
      .select()
      .from(splitOrders)
      .where(eq(splitOrders.status, SplitStatus.PROCESSING))
      .limit(50);

    for (const so of processingSplits) {
      try {
        if (!so.gatewaySplitNo || !so.gatewayTransactionId) continue;

        const gateway = await getProviderById(so.providerId);
        const result = await gateway.querySplit({
          gatewaySplitNo: so.gatewaySplitNo,
          transactionId: so.gatewayTransactionId,
        });

        console.log(
          `[Cron] Split ${so.id}: gateway status = ${result.status}, receivers = ${result.receivers.length}`,
        );

        // Update per-receiver results
        for (const r of result.receivers) {
          await db
            .update(splitReceivers)
            .set({
              result: r.result === 'SUCCESS' ? 'SUCCESS' : r.result,
              finishedAt: r.result === 'SUCCESS' ? new Date() : undefined,
            })
            .where(
              and(
                eq(splitReceivers.splitOrderId, so.id),
                eq(splitReceivers.receiverType, r.receiverType),
              ),
            );
        }

        // If all receivers are SUCCESS and split is still 'processing', mark finished
        const allSuccess = result.receivers.every(
          (r) => r.result === 'SUCCESS',
        );
        if (allSuccess) {
          await db
            .update(splitOrders)
            .set({
              status: SplitStatus.FINISHED,
              finishedAt: new Date(),
              unfinishAmount: 0,
            })
            .where(eq(splitOrders.id, so.id));

          await db
            .update(orders)
            .set({ splitStatus: SplitStatus.FINISHED })
            .where(eq(orders.id, so.orderId));

          console.log(`[Cron] Split ${so.id} auto-finished (all receivers success)`);
        }
      } catch (err) {
        console.error(`[Cron] Failed to sync processing split ${so.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[Cron] Split sync error:', err);
  }
}
