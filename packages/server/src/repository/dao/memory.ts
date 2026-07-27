/**
 * Memory DAO — MySQL-backed long-term memory store.
 */
import { eq, and, desc, isNotNull, isNull, or, lt, gt } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../connection';
import { memories } from '../schema';
import type { MemoryRow } from '../schema';
import { DEFAULT_USER } from './session';

export interface MemoryUpsertInput {
  userId?: string;
  keyName: string;
  value: string;
  importance?: number;
  source?: 'extracted' | 'manual';
  expiresAt?: number | null;
}

class MemoryDao {
  /**
   * Upsert by (userId, keyName). If the key exists, updates value/importance/updatedAt.
   */
  async upsert(input: MemoryUpsertInput): Promise<MemoryRow> {
    const db = getDatabase();
    const userId = input.userId ?? DEFAULT_USER;
    const now = Date.now();

    const existing = await db
      .select()
      .from(memories)
      .where(and(eq(memories.userId, userId), eq(memories.keyName, input.keyName)))
      .limit(1);

    if (existing[0]) {
      await db
        .update(memories)
        .set({
          value: input.value,
          importance: input.importance ?? existing[0].importance,
          expiresAt: input.expiresAt ?? existing[0].expiresAt,
          updatedAt: now,
        })
        .where(eq(memories.id, existing[0].id));
      const updated = await db.select().from(memories).where(eq(memories.id, existing[0].id)).limit(1);
      return updated[0];
    }

    const row = {
      id: uuidv4(),
      userId,
      keyName: input.keyName,
      value: input.value,
      importance: input.importance ?? 5,
      source: input.source ?? 'extracted',
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(memories).values(row);
    return row;
  }

  async findByKey(keyName: string, userId?: string): Promise<MemoryRow | null> {
    const db = getDatabase();
    const rows = await db
      .select()
      .from(memories)
      .where(and(eq(memories.userId, userId ?? DEFAULT_USER), eq(memories.keyName, keyName)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByUser(
    userId?: string,
    options?: { includeExpired?: boolean; limit?: number },
  ): Promise<MemoryRow[]> {
    const db = getDatabase();
    const now = Date.now();
    const conds = [eq(memories.userId, userId ?? DEFAULT_USER)];
    if (!options?.includeExpired) {
      conds.push(or(isNull(memories.expiresAt), gt(memories.expiresAt, now))!);
    }
    const query = db
      .select()
      .from(memories)
      .where(and(...conds))
      .orderBy(desc(memories.importance), desc(memories.updatedAt));
    return options?.limit ? query.limit(options.limit) : query;
  }

  async deleteById(id: string, userId?: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db
      .delete(memories)
      .where(and(eq(memories.id, id), eq(memories.userId, userId ?? DEFAULT_USER)));
    return result[0].affectedRows > 0;
  }

  async deleteAllForUser(userId?: string): Promise<number> {
    const db = getDatabase();
    const result = await db.delete(memories).where(eq(memories.userId, userId ?? DEFAULT_USER));
    return result[0].affectedRows;
  }

  async deleteExpired(now: number = Date.now()): Promise<number> {
    const db = getDatabase();
    const result = await db
      .delete(memories)
      .where(and(isNotNull(memories.expiresAt), lt(memories.expiresAt, now)));
    return result[0].affectedRows;
  }
}

export const memoryDao = new MemoryDao();