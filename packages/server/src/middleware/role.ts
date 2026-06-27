import { createMiddleware } from 'hono/factory';
import { ErrorCode, UserRoleType } from '@fd/shared';

export function requireRole(...roles: UserRoleType[]) {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth');
    if (!auth || !roles.includes(auth.role)) {
      return c.json({ code: ErrorCode.FORBIDDEN, message: '无权限' }, 403);
    }
    await next();
  });
}
