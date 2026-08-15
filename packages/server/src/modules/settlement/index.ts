// Settlement Routes — merchant self-service split views + settlement summary.
// Replaces the Phase 4 placeholder stub.

import { Hono } from 'hono';
import { eq, and, desc, sql, gte, lte } from 'drizzle-orm';
import {
  db,
  splitOrders,
  splitReceivers,
  orders,
  shops,
} from '../../db/index.js';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/role.js';
import { ErrorCode } from '@fd/shared';

export const settlementRoutes = new Hono();

// ── GET /api/settlement/splits ─────────────────
// Merchant views their own shop's split records

settlementRoutes.get('/splits', auth, requireRole('merchant'), async (c) => {
  const { shopId } = c.get('auth');
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const pageSize = Math.min(parseInt(c.req.query('pageSize') ?? '20', 10), 100);
  const status = c.req.query('status');
  const offset = (page - 1) * pageSize;

  // Join: orders.shopId = merchant's shopId → split_orders.orderId
  const whereClauses = [eq(orders.shopId, shopId!)];
  if (status) {
    whereClauses.push(eq(splitOrders.status, status));
  }

  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(splitOrders)
    .innerJoin(orders, eq(splitOrders.orderId, orders.id))
    .where(and(...whereClauses));

  const list = await db
    .select({
      id: splitOrders.id,
      orderId: splitOrders.orderId,
      status: splitOrders.status,
      totalAmount: splitOrders.totalAmount,
      unfinishAmount: splitOrders.unfinishAmount,
      gatewaySplitNo: splitOrders.gatewaySplitNo,
      createdAt: splitOrders.createdAt,
      finishedAt: splitOrders.finishedAt,
      orderNo: orders.orderNo,
      orderTotalAmount: orders.totalAmount,
      platformCommission: orders.platformCommission,
      merchantAmount: orders.merchantAmount,
    })
    .from(splitOrders)
    .innerJoin(orders, eq(splitOrders.orderId, orders.id))
    .where(and(...whereClauses))
    .orderBy(desc(splitOrders.createdAt))
    .limit(pageSize)
    .offset(offset);

  return c.json({
    splits: list,
    total: totalResult?.count ?? 0,
    page,
    pageSize,
  });
});

// ── GET /api/settlement/splits/:id ──────────────
// Split order detail with receivers

settlementRoutes.get('/splits/:id', auth, requireRole('merchant'), async (c) => {
  const id = c.req.param('id');
  const { shopId } = c.get('auth');

  // Verify ownership via orders.shopId
  const [splitOrder] = await db
    .select()
    .from(splitOrders)
    .innerJoin(orders, eq(splitOrders.orderId, orders.id))
    .where(and(eq(splitOrders.id, id), eq(orders.shopId, shopId!)));

  if (!splitOrder) {
    return c.json({ code: ErrorCode.SPLIT_FAILED, message: '分账单不存在' }, 404);
  }

  const receivers = await db
    .select()
    .from(splitReceivers)
    .where(eq(splitReceivers.splitOrderId, id));

  return c.json({
    split: { ...splitOrder.split_orders, receivers },
    order: splitOrder.orders,
  });
});

// ── GET /api/settlement/summary ──────────────────
// Settlement dashboard summary for merchant

settlementRoutes.get('/summary', auth, requireRole('merchant'), async (c) => {
  const { shopId } = c.get('auth');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');

  const whereClauses = [
    eq(orders.shopId, shopId!),
    eq(orders.paymentStatus, 'paid'),
  ];
  if (dateFrom) whereClauses.push(gte(orders.createdAt, new Date(dateFrom)));
  if (dateTo) whereClauses.push(lte(orders.createdAt, new Date(dateTo)));

  const [summary] = await db
    .select({
      totalOrders: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(${orders.totalAmount}), 0)::int`,
      totalCommission: sql<number>`coalesce(sum(${orders.platformCommission}), 0)::int`,
      totalNetAmount: sql<number>`coalesce(sum(${orders.merchantAmount}), 0)::int`,
    })
    .from(orders)
    .where(and(...whereClauses));

  // Unsettled: orders paid but split not finished/closed
  const [unsettled] = await db
    .select({
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${orders.merchantAmount}), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shopId!),
        eq(orders.paymentStatus, 'paid'),
        eq(orders.splitStatus, 'unsplit'),
      ),
    );

  return c.json({
    totalOrders: summary?.totalOrders ?? 0,
    totalAmount: summary?.totalAmount ?? 0,
    totalCommission: summary?.totalCommission ?? 0,
    totalNetAmount: summary?.totalNetAmount ?? 0,
    unsettledCount: unsettled?.count ?? 0,
    unsettledAmount: unsettled?.amount ?? 0,
  });
});
