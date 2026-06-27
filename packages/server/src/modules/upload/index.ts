import { Hono } from 'hono';
import { auth } from '../../middleware/auth.js';
import { uploadFile, getFileUrl } from '../../services/oss.js';
import { db, uploads } from '../../db/index.js';
import { ErrorCode } from '@fd/shared';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export const uploadRoutes = new Hono();

uploadRoutes.post('/', auth, async (c) => {
  const body = await c.req.blob();

  if (body.size === 0) {
    return c.json({ code: ErrorCode.VALIDATION_ERROR, message: '请选择文件' }, 400);
  }
  if (body.size > MAX_SIZE) {
    return c.json({ code: ErrorCode.FILE_TOO_LARGE, message: '文件过大(最大10MB)' }, 400);
  }
  if (body.type && !ALLOWED_TYPES.includes(body.type)) {
    return c.json({ code: ErrorCode.INVALID_FILE_TYPE, message: '仅支持JPG/PNG/GIF/WebP' }, 400);
  }

  const buffer = Buffer.from(await body.arrayBuffer());
  const originalName = `upload.${body.type?.split('/')[1] ?? 'jpg'}`;

  const { objectKey, thumbnailKey } = await uploadFile(
    buffer,
    originalName,
    body.type ?? 'image/jpeg',
  );

  // Record in DB
  const { sub } = c.get('auth');
  const [record] = await db
    .insert(uploads)
    .values({
      userId: sub,
      originalName,
      objectKey,
      thumbnailKey,
      mimeType: body.type,
      size: buffer.length,
    })
    .returning();

  return c.json(
    {
      id: record.id,
      url: getFileUrl(objectKey),
      thumb: getFileUrl(thumbnailKey),
    },
    201,
  );
});
