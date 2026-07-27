/**
 * MemoryService — long-term and mid-term memory.
 *
 * Three concerns:
 *   1. Extract   — call the LLM to extract user facts from a message exchange;
 *                  upsert into `memories` keyed by (userId, keyName).
 *   2. Summarize — fold a session's older messages into a single summary row;
 *                  delete the originals so the live context stays small.
 *   3. Recall    — load top-N memories and recent summaries; format as a
 *                  system-prompt block injected on every turn.
 *
 * `runMaintenance` is the single entry point SessionService calls after a
 * turn completes (in the background).
 */
import { z } from 'zod';
import { memoryDao } from '../repository/dao/memory';
import { sessionSummaryDao } from '../repository/dao/session-summary';
import { messageDao } from '../repository/dao/message';
import { blocksToText } from '../codec/content-block';
import { lazy } from '../common/lazy';
import { logger } from '../common/utils/logger';
import { DEFAULT_USER } from '../repository/dao/session';

const loadLcBits = lazy(async () => {
  const [lcPrompts, lcRunnables, coreAgent] = await Promise.all([
    import('@langchain/core/prompts'),
    import('@langchain/core/runnables'),
    import('@my-agent/core-agent'),
  ]);
  return { lcPrompts, lcRunnables, llmProvider: coreAgent.llmProvider };
});

const ExtractionSchema = z.object({
  facts: z.array(
    z.object({
      key: z.string().describe('Short snake_case identifier, e.g. "preferred_language"'),
      value: z.string().describe('The fact or preference value'),
      importance: z.number().int().min(1).max(10).describe('1=trivial, 10=core identity'),
    }),
  ),
});

const SummarySchema = z.object({
  summary: z.string().describe('A 2-4 sentence summary of the conversation segment'),
  keyPoints: z.array(z.string()).describe('3-7 bullet-style key points'),
});

export interface MaintenanceOptions {
  threshold: number;  // run summarisation when message count exceeds this
  foldCount: number;  // fold this many oldest messages when summarising
}

class MemoryService {
  // ---------- Maintenance (called by session service after each turn) ----------

  /**
   * Run the full post-turn memory maintenance in one call: extract long-term
   * facts from recent messages, then maybe fold older messages into a summary.
   */
  async runMaintenance(sessionId: string, userId = DEFAULT_USER, opts: MaintenanceOptions): Promise<void> {
    const recent = await messageDao.listRecent(sessionId, 10);
    if (recent.length > 0) await this.extractFromMessages(recent, userId);
    await this.maybeSummarize(sessionId, opts);
  }

  // ---------- Extraction ----------

  /** Extract long-term memories from a list of recent messages. */
  async extractFromMessages(
    messages: Array<{ role: string; content: unknown }>,
    userId = DEFAULT_USER,
  ): Promise<number> {
    if (messages.length === 0) return 0;

    const conversationText = messages.map((m) => `${m.role.toUpperCase()}: ${blocksToText(m.content)}`).join('\n');

    try {
      const { lcPrompts, lcRunnables, llmProvider } = await loadLcBits();
      const prompt = lcPrompts.ChatPromptTemplate.fromMessages([
        ['system', MEMORY_EXTRACTOR_SYSTEM],
        ['human', 'Conversation segment:\n\n{conversation}'],
      ]);
      const llm = await llmProvider.createChatModel({ temperature: 0 });
      const chain = lcRunnables.RunnableSequence.from([prompt, llm.withStructuredOutput(ExtractionSchema)]);
      const result = await chain.invoke({ conversation: conversationText });

      let count = 0;
      for (const fact of result.facts) {
        await memoryDao.upsert({ userId, keyName: fact.key, value: fact.value, importance: fact.importance, source: 'extracted' });
        count++;
      }
      logger.info('Extracted memories', { count, userId });
      return count;
    } catch (err) {
      logger.error('Memory extraction failed', { error: err instanceof Error ? err.message : String(err) });
      return 0;
    }
  }

  // ---------- Summarisation ----------

  /** Fold the oldest `messagesToFold` messages of a session into a summary. */
  async summarizeAndFold(
    sessionId: string,
    messagesToFold: Array<{ role: string; content: unknown; createdAt: number }>,
  ): Promise<{ summaryId: string; foldedCount: number } | null> {
    if (messagesToFold.length === 0) return null;

    const conversationText = messagesToFold.map((m) => `${m.role.toUpperCase()}: ${blocksToText(m.content)}`).join('\n');

    try {
      const { lcPrompts, lcRunnables, llmProvider } = await loadLcBits();
      const prompt = lcPrompts.ChatPromptTemplate.fromMessages([
        ['system', SUMMARIZER_SYSTEM],
        ['human', 'Conversation segment:\n\n{conversation}'],
      ]);
      const llm = await llmProvider.createChatModel({ temperature: 0 });
      const chain = lcRunnables.RunnableSequence.from([prompt, llm.withStructuredOutput(SummarySchema)]);
      const result = await chain.invoke({ conversation: conversationText });

      const rangeStart = messagesToFold[0].createdAt;
      const rangeEnd = messagesToFold[messagesToFold.length - 1].createdAt;

      const summary = await sessionSummaryDao.create({
        sessionId,
        summary: result.summary,
        keyPoints: result.keyPoints,
        rangeStart,
        rangeEnd,
        messageCount: messagesToFold.length,
      });
      await messageDao.deleteOlderThan(sessionId, rangeEnd + 1);

      logger.info('Folded messages into summary', { sessionId, foldedCount: messagesToFold.length, summaryId: summary.id });
      return { summaryId: summary.id, foldedCount: messagesToFold.length };
    } catch (err) {
      logger.error('Summarization failed', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /** If a session has more than `threshold` messages, fold the oldest `foldCount`. */
  async maybeSummarize(sessionId: string, options: MaintenanceOptions): Promise<boolean> {
    const total = await messageDao.countBySession(sessionId);
    if (total <= options.threshold) return false;
    const oldest = await messageDao.listBySession(sessionId);
    const toFold = oldest.slice(0, options.foldCount);
    const result = await this.summarizeAndFold(sessionId, toFold);
    return result !== null;
  }

  // ---------- Recall (injected as SystemMessage every turn) ----------

  /**
   * Build a memory block string for injection into the system prompt.
   * Lists top-N memories by importance + key points from prior summaries.
   */
  async buildMemoryBlock(
    sessionId: string,
    userId = DEFAULT_USER,
    options?: { memoryLimit?: number; summaryLimit?: number },
  ): Promise<string> {
    const memoryLimit = options?.memoryLimit ?? 15;
    const summaryLimit = options?.summaryLimit ?? 5;

    const memories = await memoryDao.listByUser(userId, { limit: memoryLimit });
    const summaries = await sessionSummaryDao.listBySession(sessionId);
    const recentSummaries = summaries.slice(-summaryLimit);

    if (memories.length === 0 && recentSummaries.length === 0) return '';

    const lines: string[] = ['# Memory context for this session\n'];
    if (memories.length > 0) {
      lines.push('## Long-term facts about the user');
      for (const m of memories) lines.push(`- **${m.keyName}**: ${m.value} (importance=${m.importance})`);
      lines.push('');
    }
    if (recentSummaries.length > 0) {
      lines.push('## Earlier in this session (rolled-up summaries)');
      for (const s of recentSummaries) {
        lines.push(`- ${s.summary}`);
        if (s.keyPoints && s.keyPoints.length > 0) {
          for (const kp of s.keyPoints) lines.push(`    - ${kp}`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // ---------- Controller-facing CRUD ----------

  listMemories(userId = DEFAULT_USER) {
    return memoryDao.listByUser(userId).then((rows) => rows.map((r) => ({
      id: r.id,
      keyName: r.keyName,
      value: r.value,
      importance: r.importance,
      source: r.source,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })));
  }

  upsertMemory(
    keyName: string,
    value: string,
    options?: { userId?: string; importance?: number },
  ) {
    return memoryDao.upsert({
      keyName,
      value,
      importance: options?.importance,
      userId: options?.userId,
      source: 'manual',
    });
  }

  deleteMemory(id: string, userId = DEFAULT_USER) {
    return memoryDao.deleteById(id, userId);
  }

  listSummaries(sessionId: string) {
    return sessionSummaryDao.listBySession(sessionId).then((rows) => rows.map((r) => ({
      id: r.id,
      summary: r.summary,
      keyPoints: r.keyPoints,
      rangeStart: r.rangeStart,
      rangeEnd: r.rangeEnd,
      messageCount: r.messageCount,
      createdAt: r.createdAt,
    })));
  }
}

const MEMORY_EXTRACTOR_SYSTEM = `You are a memory extractor. Read the conversation segment below and identify stable facts, preferences, or context about the USER that would be useful to remember across future conversations.

Rules:
- Only extract things explicitly stated or strongly implied by the user.
- Use snake_case for the key (e.g. "preferred_language", "occupation").
- Skip transient, one-off statements.
- importance: 1 (trivial) to 10 (core identity/preference).
- If there's nothing worth remembering, return an empty array.
- Output JSON matching the schema exactly. No prose.`;

const SUMMARIZER_SYSTEM = `You are a conversation summarizer. Produce a compact summary that preserves the key facts, decisions, and user intents from the segment below. Output JSON matching the schema exactly.`;

export const memoryService = new MemoryService();
