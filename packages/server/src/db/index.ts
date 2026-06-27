import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import * as relations from './relations';

const connectionString = process.env.DATABASE_URL ??
  'postgres://fduser:fdpass@localhost:5432/food_delivery';

const client = postgres(connectionString, { max: 20 });

export const db = drizzle(client, { schema: { ...schema, ...relations } });
export * from './schema';
export * from './relations';
