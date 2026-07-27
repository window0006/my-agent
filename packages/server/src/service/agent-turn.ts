/**
 * AgentTurn — the orchestrator for one conversational turn.
 *
 *   user message → load history (with memory block) → run agent → return outputs
 *
 * A "turn" is the atomic unit of conversation: one user message + the
 * agent's full response (which may include tool calls, reasoning, and
 * multiple LLM calls). The streaming and non-streaming entry points share
 * the same setup (`prepare`) and runner; they differ only in iteration.
 */
import { v4 as uuidv4 } from 'uuid';
import type { Message } from '@my-agent/shared';
import { sessionDao } from '../repository/dao/session';
import { messageDao } from '../repository/dao/message';
import { memoryService } from './memory';
import { MockChatModel } from '../llm/mock-chat-model';
import { lazy } from '../common/lazy';
import { blocksToText } from '../codec/content-block';
import { logger } from '../common/utils/logger';

const USE_MOCK = (process.env.LLM_PROVIDER ?? 'minimax').toLowerCase() === 'mock';

const loadCoreAgent = lazy(() => import('@my-agent/core-agent'));
const loadLcMessages = lazy(() => import('@langchain/core/messages'));

/** Minimal shape we need from a LangChain message. */
interface LcMessage {
  constructor?: { name?: string };
  [k: string]: unknown;
}

export interface TurnResult {
  /** All messages produced by the agent (ready to persist). */
  outputs: LcMessage[];
  /** Length of the history BEFORE the agent ran — for slice-out semantics. */
  historyLength: number;
}

export class AgentTurn {
  /**
   * Non-streaming entry: persist user msg, load history, run agent, return.
   */
  async run(sessionId: string, userMessage: string, userId: string): Promise<TurnResult> {
    const history = await this.prepare(sessionId, userMessage, userId);
    const runner = await this.getRunner();
    const result = await runner.run(history);
    return { outputs: (result.messages ?? []) as unknown as LcMessage[], historyLength: history.length };
  }

  /**
   * Streaming entry: same setup, but yield chunks as they arrive. The chunk
   * iterator's persistence side is the caller's job (see session service).
   */
  async *stream(sessionId: string, userMessage: string, userId: string): AsyncGenerator<LcMessage> {
    const history = await this.prepare(sessionId, userMessage, userId);
    const runner = await this.getRunner();
    for await (const [chunk] of runner.stream(history)) {
      yield chunk as unknown as LcMessage;
    }
  }

  /** Shared setup: load session, persist user msg, load history with memory. */
  private async prepare(sessionId: string, userMessage: string, userId: string) {
    const session = await loadOwnedSession(sessionId, userId);
    await persistUserMessage(sessionId, userMessage);
    return loadHistory(sessionId, userId);
  }

  private async getRunner() {
    const coreAgent = await loadCoreAgent();
    if (USE_MOCK) {
      logger.info('Using MockChatModel (LLM_PROVIDER=mock)');
      return new coreAgent.AgentRunner({ llm: new MockChatModel() });
    }
    return new coreAgent.AgentRunner();
  }
}

async function loadOwnedSession(sessionId: string, userId: string) {
  const session = await sessionDao.findById(sessionId);
  if (!session || session.userId !== userId) {
    throw new Error(`Session ${sessionId} not found or access denied`);
  }
  return session;
}

async function persistUserMessage(sessionId: string, text: string) {
  const userMsg: Message = {
    id: uuidv4(),
    role: 'user',
    content: [{ type: 'text', text }],
    status: 'success',
    createdAt: Date.now(),
  };
  await messageDao.create(messageDao.fromMessage(sessionId, userMsg));
  await sessionDao.touch(sessionId);
}

async function loadHistory(sessionId: string, userId: string) {
  const lc = await loadLcMessages();
  const rows = await messageDao.listBySession(sessionId);
  const messages = rows.map((row) => toLcMessage(lc, row));

  const memoryBlock = await memoryService.buildMemoryBlock(sessionId, userId);
  if (memoryBlock) messages.unshift(new lc.SystemMessage(memoryBlock));

  logger.info('Running agent turn', {
    sessionId,
    messageCount: messages.length,
    memoryInjected: !!memoryBlock,
  });
  return messages;
}

function toLcMessage(lc: typeof import('@langchain/core/messages'), row: MessageRowShape) {
  const text = blocksToText(row.content);
  const role = row.role as 'user' | 'assistant' | 'tool' | 'system';
  switch (role) {
    case 'user':      return new lc.HumanMessage(text);
    case 'assistant': return new lc.AIMessage(text);
    case 'tool':      return new lc.ToolMessage({ content: text, tool_call_id: row.toolCallId ?? '', name: row.toolName ?? '' });
    case 'system':    return new lc.SystemMessage(text);
    default: {
      const _exhaustive: never = role;
      throw new Error(`Unknown role: ${String(_exhaustive)}`);
    }
  }
}

interface MessageRowShape {
  role: string;
  content: unknown;
  toolCallId: string | null;
  toolName: string | null;
}

export const agentTurn = new AgentTurn();
