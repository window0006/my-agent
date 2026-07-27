import 'dotenv/config';
import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 *
 * Usage:
 *   pnpm db:generate    — generate SQL migration from schema diffs
 *   pnpm db:migrate     — apply migrations to the database
 *   pnpm db:push        — push schema directly (dev only, no migration file)
 *   pnpm db:studio      — open Drizzle Studio (visual DB browser)
 */
export default {
  schema: './src/repository/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://root:root@localhost:3306/my_agent',
  },
  verbose: true,
  strict: true,
} satisfies Config;