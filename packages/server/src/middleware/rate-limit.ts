import { createMiddleware } from 'hono/factory';
import { ErrorCode } from '@fd/shared';

const store = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number = 60, windowMs: number = 60000) {
  return createMiddleware(async (c, next) => {
    const key = c.req.header('X-Forwarded-For') ?? 'anonymous';
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= maxRequests) {
      return c.json(
        { code: ErrorCode.RATE_LIMITED, message: '请求过于频繁' },
        429,
      );
    }

    entry.count++;
    await next();
  });
}
