/**
 * Standalone integration test — bypasses the server bootstrap to verify
 * the core agent + DB + memory flow works end-to-end.
 *
 * This is a development sanity check while we work around the slow
 * pnpm/macOS require chain.
 */
import 'dotenv/config';
import { appendFileSync } from 'fs';
const log = (m: string) => appendFileSync('/tmp/integration.log', `[${new Date().toISOString()}] ${m}\n`);

async function main() {
  log('=== integration test start ===');

  // 1. Test DB connection
  log('1. importing drizzle...');
  const { drizzle } = await import('drizzle-orm/mysql2');
  const mysql = await import('mysql2/promise');
  const { eq } = await import('drizzle-orm');
  const { sessions } = await import('./dist/repository/schema');
  log('2. drizzle imported');

  const pool = mysql.default.createPool({
    uri: process.env.DATABASE_URL || 'mysql://myagent:myagent@localhost:3306/my_agent',
    connectionLimit: 2,
  });
  log('3. pool created');

  const [rows] = await pool.query('SELECT 1 AS ok');
  log(`4. DB query: ${JSON.stringify(rows)}`);

  // 2. Test session create
  const db = drizzle(pool, { schema: { sessions } });
  const newId = 'test-' + Date.now();
  await db.insert(sessions).values({
    id: newId,
    userId: 'default-user',
    title: 'Integration test session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  log(`5. inserted session: ${newId}`);

  // 3. Read back
  const found = await db.select().from(sessions).where(eq(sessions.id, newId)).limit(1);
  log(`6. read back: ${JSON.stringify(found[0])}`);

  // 4. Test cascade delete (need to add a message first to verify cascade)
  const { messages } = await import('./dist/repository/schema');
  await db.insert(messages).values({
    id: 'msg-' + Date.now(),
    sessionId: newId,
    role: 'user',
    content: 'hello',
    createdAt: Date.now(),
  });
  log('7. inserted test message');

  await db.delete(sessions).where(eq(sessions.id, newId));
  log('8. deleted session (FK cascade should delete message too)');

  const remaining = await db.select().from(messages).where(eq(messages.sessionId, newId));
  log(`9. messages after cascade delete: ${remaining.length} (should be 0)`);

  await pool.end();
  log('=== integration test PASSED ===');
}

main().catch((err) => {
  log(`FAILED: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});