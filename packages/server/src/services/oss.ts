import { Client as MinioClient } from 'minio';
import sharp from 'sharp';
import { v4 as uuid } from 'uuid';

const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: Number(process.env.MINIO_PORT) || 9000,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
});

const BUCKET = process.env.MINIO_BUCKET ?? 'food-delivery';

async function ensureBucket() {
  const exists = await minio.bucketExists(BUCKET);
  if (!exists) {
    await minio.makeBucket(BUCKET);
    // Make bucket publicly readable for dev
    await minio.setBucketPolicy(
      BUCKET,
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${BUCKET}/*`],
          },
        ],
      }),
    );
  }
}

export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
): Promise<{ objectKey: string; thumbnailKey: string }> {
  await ensureBucket();

  const ext = originalName.split('.').pop() ?? 'jpg';
  const objectKey = `${uuid()}.${ext}`;
  const thumbnailKey = `${uuid()}_thumb.${ext}`;

  // Upload original
  await minio.putObject(BUCKET, objectKey, buffer, buffer.length, {
    'Content-Type': mimeType,
  });

  // Generate and upload thumbnail (200x200)
  const thumb = await sharp(buffer).resize(200, 200, { fit: 'inside' }).toBuffer();
  await minio.putObject(BUCKET, thumbnailKey, thumb, thumb.length, {
    'Content-Type': 'image/jpeg',
  });

  return { objectKey, thumbnailKey };
}

export function getFileUrl(objectKey: string): string {
  const endpoint = process.env.MINIO_PUBLIC_URL ?? 'http://localhost:9000';
  return `${endpoint}/${BUCKET}/${objectKey}`;
}
