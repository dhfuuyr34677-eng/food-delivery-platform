import { createMiddleware } from 'hono/factory';
import { verifyToken } from '../utils/jwt.js';
import { ErrorCode } from '@fd/shared';

export const auth = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ code: ErrorCode.UNAUTHORIZED, message: '未登录' }, 401);
  }
  try {
    const payload = await verifyToken(header.slice(7));
    c.set('auth', payload);
    await next();
  } catch {
    return c.json({ code: ErrorCode.INVALID_TOKEN, message: 'Token无效或已过期' }, 401);
  }
});
