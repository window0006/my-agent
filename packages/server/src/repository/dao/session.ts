/**
 * Session DAO — MySQL-backed via Drizzle ORM.
 *
 * Replaces the previous in-memory Map. Same public API surface, but now
 * persists to MySQL and supports per-user filtering via `userId`.
 */
import { eq, desc, and, lt } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../connection';
import { sessions } from '../schema';
import type { SessionRow } from '../schema';

const DEFAULT_USER = 'default-user';

class SessionDao {
  /**
   * Create a new session.
   */
  async create(title?: string, userId?: string): Promise<SessionRow> {
    const db = getDatabase();
    const now = Date.now();
    const row = {
      id: uuidv4(),
      userId: userId ?? DEFAULT_USER,
      title: title ?? 'New Session',
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(sessions).values(row);
    return row;
  }

  /**
   * Find a session by id (metadata only, no messages).
   */
  async findById(id: string): Promise<SessionRow | null> {
    const db = getDatabase();
    const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * List sessions for a user, ordered by most recently updated first.
   */
  async listByUser(userId?: string): Promise<SessionRow[]> {
    const db = getDatabase();
    return db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId ?? DEFAULT_USER))
      .orderBy(desc(sessions.updatedAt));
  }

  /**
   * Update the session title.
   */
  async updateTitle(id: string, title: string): Promise<void> {
    const db = getDatabase();
    await db
      .update(sessions)
      .set({ title, updatedAt: Date.now() })
      .where(eq(sessions.id, id));
  }

  /**
   * Bump updatedAt timestamp (called when a new message is added).
   */
  async touch(id: string): Promise<void> {
    const db = getDatabase();
    await db.update(sessions).set({ updatedAt: Date.now() }).where(eq(sessions.id, id));
  }

  /**
   * Delete a session. Returns whether anything was deleted.
   */
  async delete(id: string, userId?: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db
      .delete(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId ?? DEFAULT_USER)));
    return result[0].affectedRows > 0;
  }

  /**
   * Delete sessions older than `olderThanMs` (relative to now).
   * Returns count of deleted rows.
   */
  async deleteOlderThan(olderThanMs: number, userId?: string): Promise<number> {
    const db = getDatabase();
    const cutoff = Date.now() - olderThanMs;
    const result = await db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId ?? DEFAULT_USER), lt(sessions.updatedAt, cutoff)));
    return result[0].affectedRows;
  }
}

export const sessionDao = new SessionDao();
export { DEFAULT_USER };