import type { ZodSchema } from 'zod';
import type { Context, Next } from 'hono';
import { ErrorCode } from '@fd/shared';

export function validate(schema: ZodSchema) {
  return async (c: Context, next: Next) => {
    const body = await c.req.json().catch(() => ({}));
    const result = schema.safeParse(body);
    if (!result.success) {
      return c.json(
        {
          code: ErrorCode.VALIDATION_ERROR,
          message: '参数错误',
          errors: result.error.flatten().fieldErrors,
        },
        400,
      );
    }
    c.set('validated', result.data);
    await next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return async (c: Context, next: Next) => {
    const query = c.req.query();
    const result = schema.safeParse(query);
    if (!result.success) {
      return c.json(
        {
          code: ErrorCode.VALIDATION_ERROR,
          message: '参数错误',
          errors: result.error.flatten().fieldErrors,
        },
        400,
      );
    }
    c.set('validatedQuery', result.data);
    await next();
  };
}
