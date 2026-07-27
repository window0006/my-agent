/**
 * Database schema (Drizzle ORM).
 *
 * Four tables:
 *   - sessions            : conversation sessions (one row per chat)
 *   - messages            : all chat messages, FK to sessions, cascade delete
 *   - memories            : long-term memories (user-level facts/preferences)
 *   - session_summaries   : mid-term memory (rolling session summaries), FK to sessions
 *
 * Foreign-key relationships:
 *   messages.session_id         -> sessions.id       (ON DELETE CASCADE)
 *   session_summaries.session_id -> sessions.id       (ON DELETE CASCADE)
 *
 * Time fields: we use BIGINT unix-ms throughout (no Date objects) for
 * portability and zero-dependency serialization.
 */
import {
  mysqlTable,
  varchar,
  text,
  bigint,
  json,
  tinyint,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/mysql-core';

/**
 * A conversation session.
 *
 * userId is a logical identifier — for v1 we default to "default-user"
 * for single-user setups. When auth lands in v4, this will become a
 * proper foreign key.
 */
export const sessions = mysqlTable(
  'sessions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 64 }).notNull().default('default-user'),
    title: varchar('title', { length: 255 }).notNull().default('New Session'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    userIdx: index('idx_sessions_user_id').on(t.userId),
    updatedIdx: index('idx_sessions_updated_at').on(t.updatedAt),
  }),
);

/**
 * A single chat message within a session.
 *
 * - role: 'user' | 'assistant' | 'system' | 'tool'
 * - toolCalls: optional JSON for assistant messages describing the tool invocations
 * - toolCallId / toolName: only set on 'tool' role messages (the result of a tool call)
 *
 * FK: messages.session_id → sessions.id, ON DELETE CASCADE.
 * Deleting a session will automatically delete all its messages.
 */
export const messages = mysqlTable(
  'messages',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    sessionId: varchar('session_id', { length: 36 }).notNull(),
    role: varchar('role', { length: 16 }).notNull(),
    // v2: JSON array of ContentBlock, mirroring LangChain 1.2 v1 standard.
    // Field name kept as `content` for backward compatibility with existing
    // rows; data shape changed from TEXT to JSON.
    content: json('content').$type<unknown[]>().notNull(),
    toolCallId: varchar('tool_call_id', { length: 64 }),
    toolName: varchar('tool_name', { length: 64 }),
    toolCalls: json('tool_calls').$type<Array<{ id: string; name: string; args: unknown }> | null>(),
    // v2: link tool_result messages back to the originating tool_call message
    parentMessageId: varchar('parent_message_id', { length: 36 }),
    // v2: lifecycle of the message (in-flight / done / failed / aborted)
    status: varchar('status', { length: 16 }).notNull().default('success'),
    model: varchar('model', { length: 64 }),
    usage: json('usage').$type<{ inputTokens: number; outputTokens: number; totalTokens: number } | null>(),
    finishReason: varchar('finish_reason', { length: 32 }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    sessionFk: foreignKey({
      name: 'fk_messages_session_id',
      columns: [t.sessionId],
      foreignColumns: [sessions.id],
    }).onDelete('cascade'),
    parentFk: foreignKey({
      name: 'fk_messages_parent_message',
      columns: [t.parentMessageId],
      foreignColumns: [t.id],
    }).onDelete('set null'),
    sessionIdx: index('idx_messages_session_id').on(t.sessionId),
    parentIdx: index('idx_messages_parent').on(t.parentMessageId),
    statusIdx: index('idx_messages_status').on(t.sessionId, t.status),
    modelIdx: index('idx_messages_model').on(t.sessionId, t.model),
    createdIdx: index('idx_messages_created_at').on(t.createdAt),
  }),
);

/**
 * Long-term memory — facts about the user that persist across sessions.
 *
 * Uniqueness is enforced on (user_id, key_name) so the same key can be
 * upserted as the user's preferences evolve.
 *
 * - importance: 1-10, used by the recall ranker
 * - expiresAt: optional TTL; null = never expires
 * - source: 'extracted' (LLM-derived) | 'manual' (user set directly)
 */
export const memories = mysqlTable(
  'memories',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 64 }).notNull().default('default-user'),
    keyName: varchar('key_name', { length: 128 }).notNull(),
    value: text('value').notNull(),
    importance: tinyint('importance').notNull().default(5),
    source: varchar('source', { length: 32 }).notNull().default('extracted'),
    expiresAt: bigint('expires_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    userKeyUnique: uniqueIndex('uk_memories_user_key').on(t.userId, t.keyName),
    userIdx: index('idx_memories_user_id').on(t.userId),
    importanceIdx: index('idx_memories_importance').on(t.userId, t.importance),
  }),
);

/**
 * Mid-term memory — rolling summaries of conversation segments.
 *
 * When a session's message count exceeds a threshold, we summarize the
 * oldest N messages into a summary row and delete those messages from
 * the active window. This keeps the live context small while preserving
 * the substance.
 *
 * FK: session_summaries.session_id → sessions.id, ON DELETE CASCADE.
 */
export const sessionSummaries = mysqlTable(
  'session_summaries',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    sessionId: varchar('session_id', { length: 36 }).notNull(),
    summary: text('summary').notNull(),
    keyPoints: json('key_points').$type<string[]>(),
    // Range of message createdAt timestamps this summary covers.
    rangeStart: bigint('range_start', { mode: 'number' }).notNull(),
    rangeEnd: bigint('range_end', { mode: 'number' }).notNull(),
    // How many messages were folded into this summary.
    messageCount: bigint('message_count', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    sessionFk: foreignKey({
      name: 'fk_summaries_session_id',
      columns: [t.sessionId],
      foreignColumns: [sessions.id],
    }).onDelete('cascade'),
    sessionIdx: index('idx_summaries_session_id').on(t.sessionId),
    createdIdx: index('idx_summaries_created_at').on(t.sessionId, t.createdAt),
  }),
);

// Type aliases for ergonomic use throughout the codebase.
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type MemoryRow = typeof memories.$inferSelect;
export type NewMemoryRow = typeof memories.$inferInsert;
export type SessionSummaryRow = typeof sessionSummaries.$inferSelect;
export type NewSessionSummaryRow = typeof sessionSummaries.$inferInsert;