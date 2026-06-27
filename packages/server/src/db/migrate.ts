import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[Migrate] DATABASE_URL not set');
  process.exit(1);
}

async function runMigrations() {
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  // migrationsFolder is relative to the dist/ directory where this script lives.
  // In the Docker image: /app/packages/server/dist/migrate.js
  // Migrations are at: /app/packages/server/drizzle/
  const migrationsFolder = join(__dirname, '..', 'drizzle');

  console.log('[Migrate] Running database migrations...');
  console.log('[Migrate] Folder:', migrationsFolder);

  await migrate(db, { migrationsFolder });
  console.log('[Migrate] Migrations complete.');

  await sql.end();
}

runMigrations().catch((err) => {
  console.error('[Migrate] Migration failed:', err);
  process.exit(1);
});
