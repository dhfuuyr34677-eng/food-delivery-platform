// Payment Admin Routes — provider CRUD + split order management.
// All routes require admin authentication.

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc, and, sql } from 'drizzle-orm';
import {
  db,
  paymentProviders,
  splitOrders,
  splitReceivers,
  orders,
} from '../../db/index.js';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/role.js';
import { validate } from '../../utils/validator.js';
import { ErrorCode, SplitStatus } from '@fd/shared';
import {
  getProviderById,
  createPaymentGateway,
} from '../../services/payment-gateway/index.js';
import { PaymentProviderType } from '@fd/shared';
import type { PaymentProviderConfig } from '../../services/payment-gateway/types.js';

export const paymentRoutes = new Hono();

// All routes require admin
paymentRoutes.use('*', auth, requireRole('admin'));

// ── Schemas ──────────────────────────────────────

const createProviderSchema = z.object({
  name: z.string().min(1).max(32),
  displayName: z.string().min(1).max(64),
  providerType: z.enum([
    PaymentProviderType.WECHAT_PAY_DIRECT,
    PaymentProviderType.WECHAT_PAY_AGGREGATED,
    PaymentProviderType.MOCK,
  ]),
  config: z.record(z.unknown()).default({}),
  isDefault: z.boolean().default(false),
});

const updateProviderSchema = z.object({
  name: z.string().min(1).max(32).optional(),
  displayName: z.string().min(1).max(64).optional(),
  config: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// ── GET /api/payment/providers ──────────────────

paymentRoutes.get('/providers', async (c) => {
  const list = await db
    .select()
    .from(paymentProviders)
    .orderBy(desc(paymentProviders.createdAt));

  return c.json({ providers: list });
});

// ── GET /api/payment/providers/:id ──────────────

paymentRoutes.get('/providers/:id', async (c) => {
  const id = c.req.param('id');

  const [provider] = await db
    .select()
    .from(paymentProviders)
    .where(eq(paymentProviders.id, id));

  if (!provider) {
    return c.json({ code: ErrorCode.PAYMENT_PROVIDER_NOT_FOUND }, 404);
  }

  return c.json({ provider });
});

// ── POST /api/payment/providers ─────────────────

paymentRoutes.post('/providers', validate(createProviderSchema), async (c) => {
  const body = c.get('validated');

  // If setting as default, unset existing defaults first
  if (body.isDefault) {
    await db
      .update(paymentProviders)
      .set({ isDefault: false })
      .where(eq(paymentProviders.isDefault, true));
  }

  const [provider] = await db
    .insert(paymentProviders)
    .values({
      name: body.name,
      displayName: body.displayName,
      providerType: body.providerType,
      config: body.config,
      isDefault: body.isDefault,
    })
    .returning();

  return c.json({ provider }, 201);
});

// ── PUT /api/payment/providers/:id ──────────────

paymentRoutes.put('/providers/:id', validate(updateProviderSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.get('validated');

  const [existing] = await db
    .select()
    .from(paymentProviders)
    .where(eq(paymentProviders.id, id));

  if (!existing) {
    return c.json({ code: ErrorCode.PAYMENT_PROVIDER_NOT_FOUND }, 404);
  }

  // If setting as default, unset existing defaults first
  if (body.isDefault) {
    await db
      .update(paymentProviders)
      .set({ isDefault: false })
      .where(eq(paymentProviders.isDefault, true));
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.displayName !== undefined) updateData.displayName = body.displayName;
  if (body.config !== undefined) updateData.config = body.config;
  if (body.isDefault !== undefined) updateData.isDefault = body.isDefault;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  const [updated] = await db
    .update(paymentProviders)
    .set(updateData)
    .where(eq(paymentProviders.id, id))
    .returning();

  return c.json({ provider: updated });
});

// ── DELETE /api/payment/providers/:id ───────────
// Soft-delete: sets isActive = false

paymentRoutes.delete('/providers/:id', async (c) => {
  const id = c.req.param('id');

  const [existing] = await db
    .select()
    .from(paymentProviders)
    .where(eq(paymentProviders.id, id));

  if (!existing) {
    return c.json({ code: ErrorCode.PAYMENT_PROVIDER_NOT_FOUND }, 404);
  }

  await db
    .update(paymentProviders)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(paymentProviders.id, id));

  return c.json({ success: true });
});

// ── GET /api/payment/splits ─────────────────────
// List all split orders, paginated, filterable

paymentRoutes.get('/splits', async (c) => {
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const pageSize = Math.min(parseInt(c.req.query('pageSize') ?? '20', 10), 100);
  const status = c.req.query('status');
  const offset = (page - 1) * pageSize;

  const where = status ? eq(splitOrders.status, status) : undefined;

  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(splitOrders)
    .where(where ?? sql`1=1`);

  const list = await db
    .select()
    .from(splitOrders)
    .where(where ?? sql`1=1`)
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

// ── GET /api/payment/splits/:id ─────────────────
// Split order detail with receivers

paymentRoutes.get('/splits/:id', async (c) => {
  const id = c.req.param('id');

  const [splitOrder] = await db
    .select()
    .from(splitOrders)
    .where(eq(splitOrders.id, id));

  if (!splitOrder) {
    return c.json({ code: ErrorCode.SPLIT_FAILED, message: '分账单不存在' }, 404);
  }

  const receivers = await db
    .select()
    .from(splitReceivers)
    .where(eq(splitReceivers.splitOrderId, id));

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, splitOrder.orderId));

  return c.json({
    split: { ...splitOrder, receivers },
    order,
  });
});

// ── POST /api/payment/splits/:id/finish ─────────
// Manually finish a split order

paymentRoutes.post('/splits/:id/finish', async (c) => {
  const id = c.req.param('id');

  const [splitOrder] = await db
    .select()
    .from(splitOrders)
    .where(eq(splitOrders.id, id));

  if (!splitOrder) {
    return c.json({ code: ErrorCode.SPLIT_FAILED, message: '分账单不存在' }, 404);
  }

  if (splitOrder.status !== SplitStatus.PROCESSING) {
    return c.json({
      code: ErrorCode.SPLIT_ALREADY_PROCESSED,
      message: `当前状态 ${splitOrder.status} 不可完成`,
    }, 400);
  }

  try {
    const gateway = await getProviderById(splitOrder.providerId);
    const result = await gateway.finishSplit({
      gatewaySplitNo: splitOrder.gatewaySplitNo!,
      transactionId: splitOrder.gatewayTransactionId!,
      totalAmount: splitOrder.totalAmount,
      idempotencyKey: `admin_finish_${splitOrder.id}_${Date.now()}`,
    });

    await db
      .update(splitOrders)
      .set({
        status: SplitStatus.FINISHED,
        finishedAt: new Date(),
        unfinishAmount: 0,
      })
      .where(eq(splitOrders.id, id));

    await db
      .update(orders)
      .set({ splitStatus: SplitStatus.FINISHED })
      .where(eq(orders.id, splitOrder.orderId));

    return c.json({ split: { ...splitOrder, status: SplitStatus.FINISHED }, gatewayResult: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : '完成分账失败';
    return c.json({ code: ErrorCode.SPLIT_FAILED, message }, 500);
  }
});

// ── POST /api/payment/splits/:id/return ─────────

paymentRoutes.post('/splits/:id/return', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const [splitOrder] = await db
    .select()
    .from(splitOrders)
    .where(eq(splitOrders.id, id));

  if (!splitOrder) {
    return c.json({ code: ErrorCode.SPLIT_FAILED, message: '分账单不存在' }, 404);
  }

  if (splitOrder.status !== SplitStatus.FINISHED) {
    return c.json({
      code: ErrorCode.SPLIT_ALREADY_PROCESSED,
      message: '仅已完成的分账单可回退',
    }, 400);
  }

  const receivers = await db
    .select()
    .from(splitReceivers)
    .where(eq(splitReceivers.splitOrderId, id));

  try {
    const gateway = await getProviderById(splitOrder.providerId);
    const result = await gateway.refundSplit({
      gatewaySplitNo: splitOrder.gatewaySplitNo!,
      transactionId: splitOrder.gatewayTransactionId!,
      totalAmount: splitOrder.totalAmount,
      receivers: receivers.map((r) => ({
        receiverType: r.receiverType as 'merchant' | 'platform' | 'delivery',
        receiverId: r.receiverId,
        receiverName: r.receiverName,
        amount: r.amount,
        description: `回退: ${r.description}`,
      })),
      idempotencyKey: `admin_return_${splitOrder.id}_${Date.now()}`,
    });

    await db
      .update(splitOrders)
      .set({ status: SplitStatus.RETURNED })
      .where(eq(splitOrders.id, id));

    await db
      .update(orders)
      .set({ splitStatus: SplitStatus.RETURNED })
      .where(eq(orders.id, splitOrder.orderId));

    return c.json({ split: { ...splitOrder, status: SplitStatus.RETURNED }, gatewayResult: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : '分账回退失败';
    return c.json({ code: ErrorCode.SPLIT_RETURN_FAILED, message }, 500);
  }
});
