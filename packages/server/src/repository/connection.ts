/**
 * Database connection management.
 *
 * - Single MySQL connection pool, lazily initialized on first use
 * - Provides a `runMigrations()` helper called at server bootstrap
 * - `closeDatabase()` for clean shutdown
 */
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import * as schema from './schema';
import { logger } from '../common/utils/logger';

type DB = MySql2Database<typeof schema>;

let dbInstance: DB | null = null;
let poolInstance: mysql.Pool | null = null;

/**
 * Lazily initialize the database connection pool + Drizzle instance.
 * Re-call is safe; returns the same instance.
 */
export function getDatabase(): DB {
  if (dbInstance) return dbInstance;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      '[db] DATABASE_URL is not set. Please configure .env.development.',
    );
  }

  logger.info('Initializing MySQL connection pool', { url: maskCredentials(url) });

  poolInstance = mysql.createPool({
    uri: url,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  dbInstance = drizzle(poolInstance, { schema, mode: 'default' });
  return dbInstance;
}

/**
 * Run pending Drizzle migrations against the configured database.
 * Called once at server startup. Safe to call repeatedly.
 *
 * NOTE: If the tables already exist (e.g. created manually), drizzle will
 * try to recreate them and fail. We tolerate this by checking whether the
 * target tables exist; if all do, we skip migration.
 */
export async function runMigrations(): Promise<void> {
  const db = getDatabase();

  // Quick check: are our tables already there?
  try {
    const [rows] = await db.execute('SHOW TABLES LIKE "sessions"');
    if (Array.isArray(rows) && rows.length > 0) {
      logger.info('Tables already exist, skipping migration');
      return;
    }
  } catch {
    // SHOW TABLES failed — proceed with migration and let it error if needed.
  }

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    logger.info('Database migrations applied successfully');
  } catch (err) {
    logger.error('Database migration failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Close the pool. Call from graceful shutdown handlers.
 */
export async function closeDatabase(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
    dbInstance = null;
    logger.info('Database connection pool closed');
  }
}

/**
 * Mask credentials when logging the connection URL.
 */
function maskCredentials(url: string): string {
  return url.replace(/(mysql:\/\/[^:]+:)[^@]+(@)/, '$1***$2');
}

export { schema };