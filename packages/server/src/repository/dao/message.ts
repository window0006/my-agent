/**
 * Message DAO — MySQL-backed.
 *
 * v2: message rows hold a JSON array of ContentBlock under `content`,
 * plus optional tool_calls, status, usage, and parent_message_id.
 */
import { eq, asc, and, lt, desc, count, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../connection';
import { messages } from '../schema';
import type { MessageRow } from '../schema';
import type { Message, ContentBlock, ToolCall, TokenUsage, MessageStatus } from '@my-agent/shared';

export type { MessageRow };

class MessageDao {
  /**
   * Append a message to a session.
   * Caller is responsible for bumping the session's updatedAt.
   */
  async create(input: Omit<MessageRow, 'createdAt'>): Promise<MessageRow> {
    const db = getDatabase();
    const row = {
      ...input,
      createdAt: Date.now(),
    };
    await db.insert(messages).values(row);
    return row;
  }

  /**
   * Update the parent_message_id of a tool message (back-link to its
   * originating tool_call row). Called from service.persistAgentOutputs
   * after both messages have been inserted.
   */
  async updateParent(toolCallId: string, parentRowId: string): Promise<void> {
    const db = getDatabase();
    await db
      .update(messages)
      .set({ parentMessageId: parentRowId })
      .where(eq(messages.toolCallId, toolCallId));
  }

  /**
   * Get all messages for a session, ordered by createdAt ascending.
   */
  async listBySession(sessionId: string): Promise<MessageRow[]> {
    const db = getDatabase();
    return db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt));
  }

  /**
   * Get the most recent N messages for a session (newest first).
   */
  async listRecent(sessionId: string, limit: number): Promise<MessageRow[]> {
    const db = getDatabase();
    return db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  }

  /**
   * Count messages in a session.
   */
  async countBySession(sessionId: string): Promise<number> {
    const db = getDatabase();
    const rows = await db
      .select({ c: count() })
      .from(messages)
      .where(eq(messages.sessionId, sessionId));
    return rows[0]?.c ?? 0;
  }

  /**
   * Delete all messages in a session (used when rolling into a summary).
   */
  async deleteBySession(sessionId: string): Promise<number> {
    const db = getDatabase();
    const result = await db.delete(messages).where(eq(messages.sessionId, sessionId));
    return result[0].affectedRows;
  }

  /**
   * Delete messages older than a given timestamp in a session.
   */
  async deleteOlderThan(sessionId: string, cutoffMs: number): Promise<number> {
    const db = getDatabase();
    const result = await db
      .delete(messages)
      .where(and(eq(messages.sessionId, sessionId), lt(messages.createdAt, cutoffMs)));
    return result[0].affectedRows;
  }

  /**
   * Convert a DB row to the public Message type.
   * Handles both v1 (string content) and v2 (ContentBlock[] content) shapes
   * — v1 rows get wrapped into a single text block on read.
   */
  toMessage(row: MessageRow): Message {
    const content: ContentBlock[] = normaliseRowContent(row.content);
    const toolCalls: ToolCall[] | undefined = Array.isArray(row.toolCalls) && row.toolCalls.length
      ? row.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: (tc.args as Record<string, unknown>) ?? {},
        }))
      : undefined;

    return {
      id: row.id,
      role: row.role as Message['role'],
      content,
      toolCalls,
      toolCallId: row.toolCallId ?? null,
      toolName: row.toolName ?? null,
      parentId: row.parentMessageId ?? null,
      status: (row.status ?? 'success') as MessageStatus,
      model: row.model ?? null,
      usage: row.usage
        ? {
            inputTokens: row.usage.inputTokens ?? 0,
            outputTokens: row.usage.outputTokens ?? 0,
            totalTokens: row.usage.totalTokens ?? 0,
          }
        : null,
      finishReason: row.finishReason ?? null,
      createdAt: row.createdAt,
    };
  }

  /**
   * Convert a public Message to a DB row (no createdAt; let DB set it).
   */
  fromMessage(sessionId: string, msg: Message): Omit<MessageRow, 'createdAt'> {
    return {
      id: msg.id || uuidv4(),
      sessionId,
      role: msg.role,
      content: msg.content as unknown[],
      toolCallId: msg.toolCallId ?? null,
      toolName: msg.toolName ?? null,
      toolCalls: msg.toolCalls ?? null,
      parentMessageId: msg.parentId ?? null,
      status: msg.status ?? 'success',
      model: msg.model ?? null,
      usage: msg.usage ?? null,
      finishReason: msg.finishReason ?? null,
    };
  }
}

/**
 * Wrap a v1 string content into a v2 ContentBlock[] on read.
 * Old rows had a plain string; new rows have an array.
 */
function normaliseRowContent(raw: unknown): ContentBlock[] {
  if (Array.isArray(raw)) {
    return raw.filter((b) => b && typeof b === 'object') as ContentBlock[];
  }
  if (typeof raw === 'string') {
    return [{ type: 'text', text: raw }];
  }
  return [{ type: 'text', text: String(raw ?? '') }];
}

export const messageDao = new MessageDao();