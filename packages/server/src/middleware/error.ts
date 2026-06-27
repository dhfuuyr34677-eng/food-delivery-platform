import type { Context } from 'hono';
import type { Hono } from 'hono';
import { ErrorCode } from '@fd/shared';

export function errorHandler(err: Error, c: Context) {
  console.error('[Error]', err.message);
  return c.json(
    { code: ErrorCode.INTERNAL_ERROR, message: '服务器内部错误' },
    500,
  );
}
