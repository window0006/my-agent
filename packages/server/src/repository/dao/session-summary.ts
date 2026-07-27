/**
 * Session Summary DAO — mid-term memory store.
 */
import { eq, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../connection';
import { sessionSummaries } from '../schema';
import type { SessionSummaryRow } from '../schema';

export interface SummaryCreateInput {
  sessionId: string;
  summary: string;
  keyPoints?: string[];
  rangeStart: number;
  rangeEnd: number;
  messageCount: number;
}

class SessionSummaryDao {
  async create(input: SummaryCreateInput): Promise<SessionSummaryRow> {
    const db = getDatabase();
    const row = {
      id: uuidv4(),
      sessionId: input.sessionId,
      summary: input.summary,
      keyPoints: input.keyPoints ?? null,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      messageCount: input.messageCount,
      createdAt: Date.now(),
    };
    await db.insert(sessionSummaries).values(row);
    return row;
  }

  async listBySession(sessionId: string): Promise<SessionSummaryRow[]> {
    const db = getDatabase();
    return db
      .select()
      .from(sessionSummaries)
      .where(eq(sessionSummaries.sessionId, sessionId))
      .orderBy(asc(sessionSummaries.createdAt));
  }

  async deleteBySession(sessionId: string): Promise<number> {
    const db = getDatabase();
    const result = await db
      .delete(sessionSummaries)
      .where(eq(sessionSummaries.sessionId, sessionId));
    return result[0].affectedRows;
  }
}

export const sessionSummaryDao = new SessionSummaryDao();