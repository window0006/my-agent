/**
 * SessionService — orchestrates Agent runs and session/message persistence.
 *
 * All LangChain / @my-agent/core-agent imports are LAZY (dynamic) because
 * LangChain 1.x modules take 30s+ to require synchronously. Deferring the
 * import keeps server startup fast and lets non-LLM endpoints work first.
 *
 * Provider selection: set `LLM_PROVIDER=mock` to use the in-process mock model
 * (no API key needed). Otherwise the real provider from llmProvider is used.
 */
import type { ContentBlock, Message, Session, ToolCall, TokenUsage } from '@my-agent/shared';
import { sessionDao, DEFAULT_USER } from '../repository/dao/session';
import { messageDao } from '../repository/dao/message';
import type { MessageRow } from '../repository/dao/message';
import { memoryService } from './memory';
import { logger } from '../common/utils/logger';
import { MockChatModel } from '../llm/mock-chat-model';

const SUMMARIZE_THRESHOLD = 30;
const SUMMARIZE_FOLD_COUNT = 15;
const PROVIDER = (process.env.LLM_PROVIDER ?? 'minimax').toLowerCase();
const USE_MOCK = PROVIDER === 'mock';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Module cache for lazy-loaded LangChain bits.
let lcModule: typeof import('@langchain/core/messages') | null = null;
let runnerModule: typeof import('@my-agent/core-agent') | null = null;
let _runner: import('@my-agent/core-agent').AgentRunner | null = null;

async function loadLangChain() {
  if (!lcModule) lcModule = await import('@langchain/core/messages');
  return lcModule;
}

async function getRunner(): Promise<import('@my-agent/core-agent').AgentRunner> {
  if (!runnerModule) runnerModule = await import('@my-agent/core-agent');
  if (!_runner) {
    const opts: import('@my-agent/core-agent').AgentRunnerOptions = USE_MOCK
      ? { llm: new MockChatModel() }
      : {};
    if (USE_MOCK) logger.info('Using MockChatModel (LLM_PROVIDER=mock)');
    _runner = new runnerModule.AgentRunner(opts);
  }
  return _runner;
}

class SessionService {
  private async getRunner() {
    return getRunner();
  }

  // ---------- Session CRUD ----------

  async createSession(title?: string, userId: string = DEFAULT_USER) {
    return sessionDao.create(title, userId);
  }

  async listSessions(userId: string = DEFAULT_USER) {
    const rows = await sessionDao.listByUser(userId);
    return Promise.all(
      rows.map(async (s) => ({
        id: s.id,
        title: s.title,
        userId: s.userId,
        messageCount: await messageDao.countBySession(s.id),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    );
  }

  async getSession(
    id: string,
    userId: string = DEFAULT_USER,
  ): Promise<(Session & { messages: Message[] }) | null> {
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

  async deleteSession(id: string, userId: string = DEFAULT_USER): Promise<boolean> {
    return sessionDao.delete(id, userId);
  }

  // ---------- Agent run (non-streaming) ----------

  async runAgentTurn(
    sessionId: string,
    userMessageText: string,
    userId: string = DEFAULT_USER,
  ) {
    const { finalMessages, historyBeforeRun } = await this.executeAgentTurn(
      sessionId,
      userMessageText,
      userId,
    );
    await this.persistAgentOutputs(sessionId, finalMessages, historyBeforeRun, userId);
    return this.getSession(sessionId, userId);
  }

  // ---------- Agent run (streaming via SSE) ----------

  /**
   * Stream an agent turn with structured, per-block events.
   *
   * M2 protocol (over SSE):
   *   - start         { sessionId, role: 'assistant' }
   *   - thinking_delta { text }   — emitted while inside a <think>...</think> block
   *   - text_delta    { content } — emitted for plain text (outside <think>)
   *   - tool_call     { name, args, callId } — when the model decides to call a tool
   *   - tool_result   { toolCallId, name, content, isError? } — from the tool node
   *   - done          { sessionId, totalEvents }
   *   - error         { message }
   *
   * The <think> marker is the MiniMax M3 model-specific reasoning delimiter
   * (M3 returns reasoning inline as `<think>...</think>` in the content
   * rather than as a separate reasoning_content field like Anthropic).
   * We split on these boundaries on the server so the client can render
   * each block type with its own component.
   */
  async *streamAgentTurn(
    sessionId: string,
    userMessageText: string,
    userId: string = DEFAULT_USER,
  ): AsyncGenerator<{ event: string; data: unknown }> {
    // 1. Persist the user message and load history (same setup as runAgentTurn).
    const session = await sessionDao.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error(`Session ${sessionId} not found or access denied`);
    }
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: userMessageText } as ContentBlock],
      status: 'success',
      createdAt: Date.now(),
    };
    await messageDao.create(messageDao.fromMessage(sessionId, userMsg));
    await sessionDao.touch(sessionId);

    const historyRows = await messageDao.listBySession(sessionId);
    const lc = await loadLangChain();
    const { HumanMessage, AIMessage, ToolMessage, SystemMessage } = lc;
    // Use the loose BaseMessage type — our chunk stream yields a mix of
    // HumanMessage / AIMessageChunk / ToolMessage / SystemMessage subclasses,
    // and the type parameter for the content shape varies. We narrow with
    // `constructor.name` checks at the call sites instead.
    type BaseMessage = import('@langchain/core/messages').BaseMessage;

    const lcMessages: BaseMessage[] = historyRows.map((row) => {
      const textContent = rowContentToString(row.content);
      switch (row.role) {
        case 'user':
          return new HumanMessage(textContent);
        case 'assistant':
          return new AIMessage(textContent);
        case 'tool':
          return new ToolMessage({
            content: textContent,
            tool_call_id: row.toolCallId ?? '',
            name: row.toolName ?? '',
          });
        case 'system':
          return new SystemMessage(textContent);
        default:
          return new HumanMessage(textContent);
      }
    });

    const memoryBlock = await memoryService.buildMemoryBlock(sessionId, userId);
    if (memoryBlock) {
      lcMessages.unshift(new SystemMessage(memoryBlock));
    }

    const historyBeforeRun = lcMessages.length;
    const runner = await this.getRunner();

    // 2. Accumulator for <think> parsing (stateful — boundaries may straddle chunks).
    const parser = new ThinkTagParser();

    // 3. Accumulator for tool_call_chunks → assembled tool_calls.
    const toolCallAcc = new ToolCallAccumulator();

    // 4. Stream chunks from the agent.
    let chunkCount = 0;
    const streamedMessages: BaseMessage[] = [];

    yield { event: 'start', data: { sessionId, role: 'assistant' } };

    try {
      for await (const [chunk] of runner.stream(lcMessages)) {
        chunkCount++;
        const ctorName = chunk.constructor?.name;

        if (ctorName === 'AIMessageChunk') {
          const c = chunk as BaseMessage & {
            content: unknown;
            tool_call_chunks?: Array<{ name?: string; args?: string; id?: string; index?: number }>;
          };

          // 3a. Tool call chunks — accumulate, then emit when complete.
          if (c.tool_call_chunks?.length) {
            for (const tcc of c.tool_call_chunks) {
              const completed = toolCallAcc.add(tcc);
              if (completed) {
                yield {
                  event: 'tool_call',
                  data: {
                    callId: completed.id,
                    name: completed.name,
                    args: completed.args,
                  },
                };
              }
            }
          }

          // 3b. Content text — split on <think> boundaries.
          if (typeof c.content === 'string' && c.content.length > 0) {
            const deltas = parser.feed(c.content);
            for (const d of deltas) {
              if (d.kind === 'thinking') {
                yield { event: 'thinking_delta', data: { text: d.text } };
              } else {
                yield { event: 'text_delta', data: { content: d.text } };
              }
            }
          }

          streamedMessages.push(chunk);
        } else if (ctorName === 'ToolMessage') {
          const t = chunk as BaseMessage & {
            tool_call_id?: string;
            name?: string;
            content: unknown;
          };
          const resultText = rowContentToString(t.content);
          yield {
            event: 'tool_result',
            data: {
              toolCallId: t.tool_call_id,
              name: t.name,
              content: resultText,
              isError: false,
            },
          };
          streamedMessages.push(chunk);
        }
      }
    } catch (err) {
      logger.error('Agent streaming failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      yield {
        event: 'error',
        data: { message: err instanceof Error ? err.message : String(err) },
      };
      return;
    }

    // 5. Flush any tail text/thinking buffered in the parser.
    const tail = parser.flush();
    for (const d of tail) {
      if (d.kind === 'thinking') {
        yield { event: 'thinking_delta', data: { text: d.text } };
      } else {
        yield { event: 'text_delta', data: { content: d.text } };
      }
    }

    // 6. Build the final assistant message from the parser/toolCall state
    // so we don't lose the reasoning on persistence.
    const finalBlocks = parser.toContentBlocks();
    for (const tc of toolCallAcc.drainAll()) {
      finalBlocks.push({
        type: 'tool_call',
        name: tc.name,
        args: tc.args,
        ...(tc.id ? { callId: tc.id } : {}),
      } as ContentBlock);
    }
    // Append tool_result messages to the assistant message as blocks too
    // (so the persisted history shows both call and result on the same msg).
    for (const m of streamedMessages) {
      if (m.constructor?.name !== 'ToolMessage') continue;
      const t = m as BaseMessage & {
        tool_call_id?: string;
        name?: string;
        content: unknown;
      };
      const resultText = rowContentToString(t.content);
      finalBlocks.push({
        type: 'tool_result',
        toolCallId: t.tool_call_id ?? '',
        name: t.name,
        content: resultText,
      } as ContentBlock);
    }

    // 7. Build the final AIMessage + any ToolMessages for persistence.
    const finalMessages: BaseMessage[] = [];
    if (finalBlocks.length > 0) {
      // Local AIMessage construction — keep the content as ContentBlock[]
      // so reasoning + text + tool calls survive persistence.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { AIMessage } = require('@langchain/core/messages') as typeof import('@langchain/core/messages');
      const persistedAIMsg = new AIMessage({
        content: finalBlocks as unknown as string,
      });
      finalMessages.push(persistedAIMsg);
    }
    // Also persist any standalone tool messages for completeness (e.g.
    // when the tool node emits a message that doesn't get folded into the
    // assistant message blocks above).
    for (const m of streamedMessages) {
      if (m.constructor?.name === 'ToolMessage') finalMessages.push(m);
    }

    await this.persistAgentOutputs(sessionId, finalMessages, 0, userId);

    yield {
      event: 'done',
      data: { sessionId, totalChunks: chunkCount },
    };
  }

  // ---------- Internals ----------

  /**
   * Shared execution path for streaming and non-streaming turns.
   * Persists the user message and invokes the agent.
   */
  private async executeAgentTurn(
    sessionId: string,
    userMessageText: string,
    userId: string,
  ) {
    const session = await sessionDao.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error(`Session ${sessionId} not found or access denied`);
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      // v2: content is always ContentBlock[]; user input is a single text block.
      content: [{ type: 'text', text: userMessageText } as ContentBlock],
      status: 'success',
      createdAt: Date.now(),
    };
    await messageDao.create(messageDao.fromMessage(sessionId, userMsg));
    await sessionDao.touch(sessionId);

    const historyRows = await messageDao.listBySession(sessionId);

    const lc = await loadLangChain();
    const { HumanMessage, AIMessage, ToolMessage, SystemMessage } = lc;
    type BaseMessage = InstanceType<
      typeof HumanMessage | typeof AIMessage | typeof ToolMessage | typeof SystemMessage
    >;

    // v2: row.content is now a ContentBlock[]; pass as a flat string
    // to LangChain (it'll be wrapped as a single text block). The original
    // block structure is preserved on read via messageDao.toMessage.
    const lcMessages: BaseMessage[] = historyRows.map((row) => {
      const textContent = rowContentToString(row.content);
      switch (row.role) {
        case 'user':
          return new HumanMessage(textContent);
        case 'assistant':
          return new AIMessage(textContent);
        case 'tool':
          return new ToolMessage({
            content: textContent,
            tool_call_id: row.toolCallId ?? '',
            name: row.toolName ?? '',
          });
        case 'system':
          return new SystemMessage(textContent);
        default:
          return new HumanMessage(textContent);
      }
    });

    const memoryBlock = await memoryService.buildMemoryBlock(sessionId, userId);
    if (memoryBlock) {
      lcMessages.unshift(new SystemMessage(memoryBlock));
    }

    const newMessagesStartAt = lcMessages.length;

    logger.info('Running agent turn', {
      sessionId,
      messageCount: lcMessages.length,
      memoryInjected: !!memoryBlock,
    });

    const runner = await this.getRunner();
    const result = await runner.run(lcMessages);
    const finalMessages: BaseMessage[] = (result.messages ?? []) as BaseMessage[];

    logger.info('Agent run finished', {
      sessionId,
      newMessagesStartAt,
      finalCount: finalMessages.length,
      finalRoles: finalMessages.map((m) => (m as { constructor?: { name?: string } }).constructor?.name),
    });

    return { finalMessages, historyBeforeRun: newMessagesStartAt };
  }

  /**
   * Persist any new assistant / tool messages produced by the agent.
   * Fires memory maintenance in the background.
   */
  private async persistAgentOutputs(
    sessionId: string,
    finalMessages: Array<unknown>,
    historyBeforeRun: number,
    userId: string,
  ) {
    const slice = finalMessages.slice(historyBeforeRun);
    logger.info('Persisting agent outputs', {
      sessionId,
      historyBeforeRun,
      totalMessages: finalMessages.length,
      newMessageCount: slice.length,
      roles: slice.map((m) => (m as { constructor?: { name?: string } }).constructor?.name),
    });

    // First pass: persist messages; remember message ids by LangChain position
    // so tool_result messages can be linked back to their tool_call message.
    const lcIdToRowId = new Map<string, string>();
    for (const msg of slice) {
      const lcMsg = msg as { id?: string[] } & Record<string, unknown>;
      const persisted = baseMessageToMessage(sessionId, msg as never);
      if (persisted) {
        // LangChain messages may carry an id array (BaseMessage.id default).
        // Capture it so we can link tool_result back to tool_call below.
        await messageDao.create(persisted);
        if (Array.isArray(lcMsg.id) && lcMsg.id[0]) {
          lcIdToRowId.set(lcMsg.id[0], persisted.id);
        }
      }
    }

    // Second pass: for any tool_result block, set its parent_message_id to
    // the originating tool_call message. We do this with a separate UPDATE
    // so the codec in baseMessageToMessage stays a pure transform.
    for (const msg of slice) {
      const m = msg as {
        constructor?: { name?: string };
        tool_call_id?: string;
      };
      if (m.constructor?.name !== 'ToolMessage' || !m.tool_call_id) continue;
      // Find the tool_call's row id. LangChain uses tool_call_id to link
      // back, but we want to link the row that produced the tool_call —
      // not the call itself. We do this by walking the slice and finding
      // the AIMessage whose tool_calls contain the matching id.
      const originatingAIMsg = slice.find((s) => {
        const sm = s as { tool_calls?: Array<{ id?: string }> };
        return sm.tool_calls?.some((tc) => tc.id === m.tool_call_id);
      }) as { id?: string[] } | undefined;
      const originLcId = Array.isArray(originatingAIMsg?.id) ? originatingAIMsg!.id[0] : undefined;
      const parentRowId = originLcId ? lcIdToRowId.get(originLcId) : undefined;
      if (parentRowId) {
        await messageDao.updateParent(m.tool_call_id, parentRowId);
      }
    }

    await sessionDao.touch(sessionId);

    this.runMemoryMaintenance(sessionId, userId).catch((err) =>
      logger.error('Memory maintenance failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  private async runMemoryMaintenance(sessionId: string, userId: string): Promise<void> {
    const recent = await messageDao.listRecent(sessionId, 10);
    if (recent.length > 0) {
      await memoryService.extractFromMessages(recent, userId);
    }
    await memoryService.maybeSummarize(sessionId, {
      threshold: SUMMARIZE_THRESHOLD,
      foldCount: SUMMARIZE_FOLD_COUNT,
    });
  }
}

function baseMessageToMessage(
  sessionId: string,
  msg: import('@langchain/core/messages').BaseMessage,
): Omit<MessageRow, 'createdAt'> | null {
  const ctorName = msg.constructor.name;
  // LangChain 1.x may wrap system messages as "SystemMessage2" via MessagesAnnotation.
  // Treat any system-* constructor as a system message → skip persistence (we
  // re-inject the memory block fresh on every turn anyway).
  if (ctorName.startsWith('SystemMessage')) return null;

  let role: Message['role'] = 'assistant';
  if (ctorName === 'HumanMessage') role = 'user';
  else if (ctorName === 'AIMessage') role = 'assistant';
  else if (ctorName === 'ToolMessage') role = 'tool';

  // v2: keep the raw content blocks instead of flattening to a string.
  // LangChain AIMessage.content is already ContentBlock[] (or a string for
  // legacy text-only outputs); we normalise both shapes to ContentBlock[].
  const content: ContentBlock[] = normaliseContent(msg.content);

  // v2: tool_calls are surfaced as a top-level field on the message.
  const toolCalls: ToolCall[] = ((msg as unknown as { tool_calls?: Array<{ id?: string; name?: string; args?: unknown }> }).tool_calls ?? []).map((tc) => ({
    id: tc.id ?? crypto.randomUUID(),
    name: tc.name ?? '',
    args: (typeof tc.args === 'string' ? safeParseJson(tc.args) : tc.args) as Record<string, unknown> ?? {},
  }));

  const toolMsg = msg as unknown as {
    tool_call_id?: string;
    name?: string;
  };

  // v2: metadata. LangChain 1.x exposes usage + finish_reason on
  // response_metadata / usage_metadata; copy them through so the UI can
  // surface token counts and stop reasons.
  const lcMsg = msg as unknown as {
    response_metadata?: { model_name?: string; finish_reason?: string };
    usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  };
  const usage: TokenUsage | null = lcMsg.usage_metadata
    ? {
        inputTokens: lcMsg.usage_metadata.input_tokens ?? 0,
        outputTokens: lcMsg.usage_metadata.output_tokens ?? 0,
        totalTokens: lcMsg.usage_metadata.total_tokens ?? 0,
      }
    : null;

  return {
    id: crypto.randomUUID(),
    sessionId,
    role,
    content,
    toolCallId: toolMsg.tool_call_id ?? null,
    toolName: toolMsg.name ?? null,
    toolCalls: toolCalls.length ? toolCalls : null,
    parentMessageId: toolMsg.tool_call_id ? null : null, // resolved below in service
    status: 'success',
    model: lcMsg.response_metadata?.model_name ?? null,
    usage,
    finishReason: lcMsg.response_metadata?.finish_reason ?? null,
  };
}

/**
 * Normalise LangChain's `content` (string | ContentBlock[] | unknown) into
 * a ContentBlock[] for storage. This is the only place we do the codec
 * between LangChain and our shared types; the rest of the pipeline
 * (DB row → API → frontend) passes the array through unchanged.
 */
function normaliseContent(raw: unknown): ContentBlock[] {
  if (typeof raw === 'string') {
    return [{ type: 'text', text: raw }];
  }
  if (Array.isArray(raw)) {
    return raw.map((block) => normaliseBlock(block)).filter(Boolean) as ContentBlock[];
  }
  if (raw && typeof raw === 'object') {
    return [normaliseBlock(raw)].filter(Boolean) as ContentBlock[];
  }
  return [{ type: 'text', text: '' }];
}

function normaliseBlock(block: any): ContentBlock | null {
  if (!block) return null;
  if (typeof block === 'string') return { type: 'text', text: block };
  if (typeof block !== 'object') return null;

  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text ?? '' };
    case 'reasoning':
      // LangChain 1.2 v1 uses `reasoning`; older / Anthropic uses `thinking`.
      return {
        type: 'reasoning',
        reasoning: block.reasoning ?? block.thinking ?? '',
      };
    case 'thinking':
      return { type: 'reasoning', reasoning: block.thinking ?? '' };
    case 'tool_call':
      return {
        type: 'tool_call',
        name: block.name,
        args:
          typeof block.args === 'string' ? safeParseJson(block.args) ?? {} : block.args ?? {},
        ...(block.id || block.callId
          ? { callId: block.id ?? block.callId }
          : {}),
      } as ContentBlock;
    case 'tool_use':
      // Anthropic: {type:'tool_use', id, name, input}
      return {
        type: 'tool_call',
        name: block.name,
        args: block.input ?? {},
        callId: block.id,
      } as ContentBlock;
    case 'image':
      if (block.source) {
        return { type: 'image', source: block.source } as ContentBlock;
      }
      if (block.image_url) {
        return { type: 'image', url: block.image_url } as ContentBlock;
      }
      return null;
    default:
      // Unknown / provider-specific block — surface as non_standard so the
      // frontend can still render it (or skip if it doesn't understand).
      return { type: 'non_standard', value: block } as ContentBlock;
  }
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { __raw: s };
  }
}

/**
 * Flatten a DB row's `content` (v2: ContentBlock[] | v1: string) to a plain
 * string for LangChain message constructors. Used when re-hydrating history
 * into the agent's input — LangChain itself accepts both shapes on the way
 * in, but normalising here keeps the call sites simple.
 */
function rowContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: { type?: string; text?: string; reasoning?: string; name?: string; args?: unknown }) => {
        if (typeof b === 'string') return b;
        if (b.type === 'text') return b.text ?? '';
        if (b.type === 'reasoning') return b.reasoning ?? '';
        if (b.type === 'tool_call') return `[tool:${b.name}(${JSON.stringify(b.args)})]`;
        if (b.type === 'image') return '[image]';
        return '';
      })
      .join('');
  }
  return String(content ?? '');
}

/**
 * Merge streamed message chunks back into complete messages for persistence.
 *
 * LangChain 1.x's `streamMode: 'messages'` yields AIMessageChunk fragments;
 * each fragment has the *delta* in its `content` field, plus partial
 * `tool_call_chunks` that need to be assembled. We concatenate by content
 * (cumulative) and by `tool_call_chunks` index.
 *
 * ToolMessages come in as full messages (not chunked), so they're returned
 * as-is.
 */
function mergeStreamedChunks(
  chunks: import('@langchain/core/messages').BaseMessage[],
): import('@langchain/core/messages').BaseMessage[] {
  const out: import('@langchain/core/messages').BaseMessage[] = [];
  let currentAccum: {
    content: string;
    toolCalls: Map<number, { id?: string; name?: string; args: string }>;
  } | null = null;

  for (const m of chunks) {
    const ctorName = m.constructor?.name;
    if (ctorName !== 'AIMessageChunk') {
      // ToolMessage (or anything else) — flush the AI accumulator first.
      if (currentAccum) {
        out.push(buildFinalAIMessage(currentAccum));
        currentAccum = null;
      }
      out.push(m);
      continue;
    }

    const chunk = m as import('@langchain/core/messages').AIMessageChunk & {
      content: unknown;
      tool_call_chunks?: Array<{ name?: string; args?: string; id?: string; index?: number }>;
    };

    if (!currentAccum) {
      currentAccum = { content: '', toolCalls: new Map() };
    }

    if (typeof chunk.content === 'string') {
      currentAccum.content += chunk.content;
    } else if (Array.isArray(chunk.content)) {
      // Multi-block content (rare from a single chunk, but possible).
      currentAccum.content += chunk.content
        .map((b: { type?: string; text?: string; reasoning?: string }) => {
          if (b?.type === 'text') return b.text ?? '';
          if (b?.type === 'reasoning') return b.reasoning ?? '';
          return '';
        })
        .join('');
    }

    for (const tcc of chunk.tool_call_chunks ?? []) {
      const idx = tcc.index ?? 0;
      const existing = currentAccum.toolCalls.get(idx) ?? { id: undefined, name: undefined, args: '' };
      if (tcc.id) existing.id = tcc.id;
      if (tcc.name) existing.name = tcc.name;
      if (tcc.args) existing.args = (existing.args ?? '') + tcc.args;
      currentAccum.toolCalls.set(idx, existing);
    }
  }

  if (currentAccum) {
    out.push(buildFinalAIMessage(currentAccum));
  }

  return out;
}

function buildFinalAIMessage(accum: {
  content: string;
  toolCalls: Map<number, { id?: string; name?: string; args: string }>;
}): import('@langchain/core/messages').AIMessage {
  // Local import to avoid circulars.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AIMessage } = require('@langchain/core/messages') as typeof import('@langchain/core/messages');
  const tool_calls = Array.from(accum.toolCalls.entries())
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id ?? crypto.randomUUID(),
      name: tc.name ?? '',
      args: safeParseJson(tc.args || '{}') as Record<string, unknown>,
    }));
  return new AIMessage({
    content: accum.content,
    tool_calls,
  });
}

/**
 * Stateful parser that splits incoming text deltas on `<think>...</think>`
 * boundaries, yielding typed fragments the SSE handler can dispatch.
 *
 * Why stateful: the marker may straddle two chunks. E.g. chunk 1 ends
 * with `...thi` and chunk 2 starts with `nk>...` — only when we see the
 * closing `>` of `<think>` can we decide the tag is open. We also buffer
 * the content INSIDE a thinking tag across chunks until we see `</think>`,
 * so the thinking text doesn't get dropped if it spans multiple deltas.
 */
type ParsedDelta =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string };

class ThinkTagParser {
  private inThinking = false;
  private buffer = '';
  // Full content mirror of the stream — used at end-of-stream to build
  // the persisted ContentBlock[] (so reasoning isn't lost on persist).
  private fullText = '';

  feed(delta: string): ParsedDelta[] {
    this.fullText += delta;
    this.buffer += delta;
    const out: ParsedDelta[] = [];
    let i = 0;

    while (i < this.buffer.length) {
      if (this.inThinking) {
        const close = this.buffer.indexOf('</think>', i);
        if (close === -1) {
          this.buffer = this.buffer.slice(i);
          return out;
        } else {
          out.push({ kind: 'thinking', text: this.buffer.slice(i, close) });
          this.inThinking = false;
          i = close + '</think>'.length;
        }
      } else {
        const open = this.buffer.indexOf('<think>', i);
        if (open === -1) {
          if (i < this.buffer.length) {
            out.push({ kind: 'text', text: this.buffer.slice(i) });
          }
          this.buffer = '';
          return out;
        } else {
          if (open > i) {
            out.push({ kind: 'text', text: this.buffer.slice(i, open) });
          }
          this.inThinking = true;
          i = open + '<think>'.length;
        }
      }
    }

    if (this.inThinking) {
      this.buffer = this.buffer.slice(i);
    } else {
      this.buffer = '';
    }
    return out;
  }

  /** Flush any remaining buffer at end-of-stream (e.g. unclosed <think>). */
  flush(): ParsedDelta[] {
    if (!this.buffer) return [];
    const tail = this.buffer;
    this.buffer = '';
    return [{ kind: this.inThinking ? 'thinking' : 'text', text: tail }];
  }

  /**
   * Build the persisted ContentBlock[] from the full mirror of all
   * content seen so far. Re-parses the full text (not the buffer) so
   * we capture the complete structure regardless of where boundaries
   * landed across chunks.
   */
  toContentBlocks(): ContentBlock[] {
    const out: ContentBlock[] = [];
    let i = 0;
    let inThinking = false;
    let textBuf = '';
    let thinkingBuf = '';
    const flushText = () => {
      if (textBuf) {
        out.push({ type: 'text', text: textBuf });
        textBuf = '';
      }
    };
    const flushThinking = () => {
      if (thinkingBuf) {
        out.push({ type: 'reasoning', reasoning: thinkingBuf });
        thinkingBuf = '';
      }
    };
    while (i < this.fullText.length) {
      if (inThinking) {
        const close = this.fullText.indexOf('</think>', i);
        if (close === -1) {
          thinkingBuf += this.fullText.slice(i);
          i = this.fullText.length;
        } else {
          thinkingBuf += this.fullText.slice(i, close);
          flushThinking();
          inThinking = false;
          i = close + '</think>'.length;
        }
      } else {
        const open = this.fullText.indexOf('<think>', i);
        if (open === -1) {
          textBuf += this.fullText.slice(i);
          i = this.fullText.length;
        } else {
          textBuf += this.fullText.slice(i, open);
          flushText();
          inThinking = true;
          i = open + '<think>'.length;
        }
      }
    }
    if (inThinking) flushThinking();
    else flushText();
    return out;
  }
}

/**
 * Accumulates LangChain `tool_call_chunk` fragments into completed tool
 * calls. A call is "complete" when all three fields (id, name, args) are
 * present (args may be partial JSON that's been fully received).
 */
interface CompletedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

class ToolCallAccumulator {
  private byIndex = new Map<number, { id?: string; name?: string; args: string }>();

  add(tcc: { name?: string; args?: string; id?: string; index?: number }): CompletedToolCall | null {
    const idx = tcc.index ?? 0;
    const cur = this.byIndex.get(idx) ?? { id: undefined, name: undefined, args: '' };
    if (tcc.id) cur.id = tcc.id;
    if (tcc.name) cur.name = tcc.name;
    if (tcc.args !== undefined) cur.args += tcc.args;
    this.byIndex.set(idx, cur);

    // A tool call is "complete" when we have id, name, and args. We use the
    // presence of id as the signal (name is usually before args in practice,
    // and a missing id means we haven't seen the start yet).
    if (cur.id && cur.name !== undefined) {
      const args = safeParseJson(cur.args || '{}') as Record<string, unknown>;
      const completed: CompletedToolCall = { id: cur.id, name: cur.name, args };
      this.byIndex.delete(idx);
      return completed;
    }
    return null;
  }

  /**
   * At end-of-stream, drain any in-progress tool calls (typically the
   * last one whose args stream was cut off by the model's finish_reason).
   * Use only the fields we have; missing args becomes {}.
   */
  drainAll(): CompletedToolCall[] {
    const out: CompletedToolCall[] = [];
    for (const [, tc] of this.byIndex) {
      if (tc.id && tc.name !== undefined) {
        out.push({
          id: tc.id,
          name: tc.name,
          args: safeParseJson(tc.args || '{}') as Record<string, unknown>,
        });
      }
    }
    this.byIndex.clear();
    return out;
  }
}

export const sessionService = new SessionService();