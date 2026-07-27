/**
 * SessionService — entry layer for session routes.
 *
 * The orchestration is intentionally thin: every action is "load → call
 * AgentTurn → persist → return". All state-machine complexity lives in
 * `agent-turn.ts` and `stream/parser.ts`; all codec lives in `codec/`.
 */
import type { Message, Session } from '@my-agent/shared';
import { sessionDao, DEFAULT_USER } from '../repository/dao/session';
import { messageDao } from '../repository/dao/message';
import { agentTurn } from './agent-turn';
import { StreamParser } from './stream/parser';
import { memoryService } from './memory';
import { baseMessageToMessage } from '../codec/langchain';
import { logger } from '../common/utils/logger';

const SUMMARIZE_THRESHOLD = 30;
const SUMMARIZE_FOLD_COUNT = 15;

class SessionService {
  // ---------- CRUD ----------

  createSession(title?: string, userId = DEFAULT_USER) {
    return sessionDao.create(title, userId);
  }

  async listSessions(userId = DEFAULT_USER) {
    const rows = await sessionDao.listByUser(userId);
    return Promise.all(rows.map(async (s) => ({
      id: s.id,
      title: s.title,
      userId: s.userId,
      messageCount: await messageDao.countBySession(s.id),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })));
  }

  async getSession(id: string, userId = DEFAULT_USER): Promise<(Session & { messages: Message[] }) | null> {
    const session = await sessionDao.findById(id);
    if (!session || session.userId !== userId) return null;
    const msgs = await messageDao.listBySession(id);
    return {
      id: session.id,
      title: session.title,
      userId: session.userId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: msgs.map(messageDao.toMessage),
    };
  }

  deleteSession(id: string, userId = DEFAULT_USER) {
    return sessionDao.delete(id, userId);
  }

  // ---------- Non-streaming turn ----------

  async runAgentTurn(sessionId: string, userMessage: string, userId = DEFAULT_USER) {
    const { outputs, historyLength } = await agentTurn.run(sessionId, userMessage, userId);
    await this.persistTurnOutputs(sessionId, outputs, historyLength, userId);
    return this.getSession(sessionId, userId);
  }

  // ---------- Streaming turn (SSE) ----------

  /**
   * Run a turn and yield structured SSE events as the agent streams:
   *   start → thinking_delta / text_delta / tool_call / tool_result → done | error
   *
   * The two layers are clean: `agentTurn.stream` yields LangChain chunks;
   * `StreamParser` turns them into typed events AND the final persisted
   * shape. We just orchestrate the two and persist.
   */
  async *streamAgentTurn(
    sessionId: string,
    userMessage: string,
    userId = DEFAULT_USER,
  ): AsyncGenerator<{ event: string; data: unknown }> {
    const parser = new StreamParser();
    try {
      for await (const chunk of agentTurn.stream(sessionId, userMessage, userId)) {
        yield* parser.feed(chunk);
      }
      const finalised = parser.finalize();
      await this.persistStreamedOutputs(sessionId, finalised, userId);
      yield { event: 'done', data: { sessionId, totalChunks: finalised.chunkCount } };
    } catch (err) {
      logger.error('Agent streaming failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      yield { event: 'error', data: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  // ---------- Internals ----------

  /** Persist the new messages from a non-streaming run. */
  private async persistTurnOutputs(
    sessionId: string,
    outputs: Array<{ constructor?: { name?: string } } & Record<string, unknown>>,
    historyLength: number,
    userId: string,
  ) {
    const slice = outputs.slice(historyLength);
    await this.insertMessages(sessionId, slice);
    await this.finaliseTurn(sessionId, userId);
  }

  /** Persist the reconstructed messages from a streaming run. */
  private async persistStreamedOutputs(
    sessionId: string,
    finalised: {
      aiMessage: { content: import('@my-agent/shared').ContentBlock[]; tool_calls: Array<{ id: string; name: string; args: Record<string, unknown> }> };
      toolMessages: Array<{ tool_call_id: string; name?: string; content: string }>;
    },
    userId: string,
  ) {
    const aiLcMsg = { constructor: { name: 'AIMessage' }, content: finalised.aiMessage.content, tool_calls: finalised.aiMessage.tool_calls };
    const toolLcMsgs = finalised.toolMessages.map((t) => ({
      constructor: { name: 'ToolMessage' },
      content: t.content,
      tool_call_id: t.tool_call_id,
      name: t.name,
    }));
    await this.insertMessages(sessionId, [aiLcMsg, ...toolLcMsgs]);
    await this.finaliseTurn(sessionId, userId);
  }

  /** Insert messages, then link tool_message rows to their originating tool_call. */
  private async insertMessages(
    sessionId: string,
    messages: Array<{ constructor?: { name?: string } } & Record<string, unknown>>,
  ) {
    // Pass 1: insert each message; build a tool_call_id → row_id map for AI messages.
    const toolCallIdToRowId = new Map<string, string>();
    for (const msg of messages) {
      const row = baseMessageToMessage(msg, sessionId);
      if (!row) continue;
      await messageDao.create(row);
      for (const tc of row.toolCalls ?? []) {
        toolCallIdToRowId.set(tc.id, row.id);
      }
    }
    // Pass 2: link each tool message to its originating AI row.
    for (const msg of messages) {
      if (msg.constructor?.name !== 'ToolMessage') continue;
      const tcId = (msg as { tool_call_id?: string }).tool_call_id;
      if (!tcId) continue;
      const parentRowId = toolCallIdToRowId.get(tcId);
      if (parentRowId) await messageDao.updateParent(tcId, parentRowId);
    }
  }

  /** Touch the session, then fire-and-forget memory maintenance. */
  private async finaliseTurn(sessionId: string, userId: string): Promise<void> {
    await sessionDao.touch(sessionId);
    memoryService
      .runMaintenance(sessionId, userId, { threshold: SUMMARIZE_THRESHOLD, foldCount: SUMMARIZE_FOLD_COUNT })
      .catch((err) => logger.error('Memory maintenance failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      }));
  }
}

export const sessionService = new SessionService();
