/**
 * MemoryService — long-term and mid-term memory management.
 *
 * Three concerns live here:
 *   1. Extraction   — call the LLM to extract user facts from a message exchange,
 *                     upsert into `memories` keyed by `(userId, keyName)`
 *   2. Summarization — fold a session's older messages into a single summary row,
 *                     then delete the originals so the live context stays small
 *   3. Recall       — load the top-N memories for a user and format them as
 *                     a context block to prepend to the system prompt
 *
 * LLM calls go through the AgentRunner's LLM client so we share one
 * configured provider across the whole server.
 */
// Lazy LangChain imports — see service/session.ts for rationale.
let _lcPrompts: typeof import('@langchain/core/prompts') | null = null;
let _lcRunnables: typeof import('@langchain/core/runnables') | null = null;
let _llmProvider: typeof import('@my-agent/core-agent').llmProvider | null = null;

async function loadLangChainBits() {
  if (!_lcPrompts) _lcPrompts = await import('@langchain/core/prompts');
  if (!_lcRunnables) _lcRunnables = await import('@langchain/core/runnables');
  if (!_llmProvider) {
    const mod = await import('@my-agent/core-agent');
    _llmProvider = mod.llmProvider;
  }
  return { lcPrompts: _lcPrompts, lcRunnables: _lcRunnables, llmProvider: _llmProvider };
}

import { z } from 'zod';
import type { MessageRow } from '../repository/dao/message';
import { memoryDao } from '../repository/dao/memory';
import { sessionSummaryDao } from '../repository/dao/session-summary';
import { messageDao } from '../repository/dao/message';
import { logger } from '../common/utils/logger';
import { DEFAULT_USER } from '../repository/dao/session';

const ExtractionSchema = z.object({
  facts: z.array(
    z.object({
      key: z.string().describe('Short snake_case identifier, e.g. "preferred_language"'),
      value: z.string().describe('The fact or preference value'),
      importance: z
        .number()
        .int()
        .min(1)
        .max(10)
        .describe('1=trivial, 10=core identity'),
    }),
  ),
});

const SummarySchema = z.object({
  summary: z.string().describe('A 2-4 sentence summary of the conversation segment'),
  keyPoints: z.array(z.string()).describe('3-7 bullet-style key points'),
});

class MemoryService {
  // ---------- Extraction ----------

  /**
   * Extract long-term memories from a list of recent messages.
   * Called periodically after each agent turn.
   */
  async extractFromMessages(
    messages: MessageRow[],
    userId: string = DEFAULT_USER,
  ): Promise<number> {
    if (messages.length === 0) return 0;

    const conversationText = messages
      .map((m) => `${m.role.toUpperCase()}: ${rowContentToString(m.content)}`)
      .join('\n');

    try {
      const { lcPrompts, lcRunnables, llmProvider } = await loadLangChainBits();
      const prompt = lcPrompts.ChatPromptTemplate.fromMessages([
        [
          'system',
          `You are a memory extractor. Read the conversation segment below and identify stable facts, preferences, or context about the USER that would be useful to remember across future conversations.

Rules:
- Only extract things explicitly stated or strongly implied by the user.
- Use snake_case for the key (e.g. "preferred_language", "occupation").
- Skip transient, one-off statements.
- importance: 1 (trivial) to 10 (core identity/preference).
- If there's nothing worth remembering, return an empty array.
- Output JSON matching the schema exactly. No prose.`,
        ],
        ['human', 'Conversation segment:\n\n{conversation}'],
      ]);

      const llm = llmProvider.createChatModel({ temperature: 0 });
      const chain = lcRunnables.RunnableSequence.from([prompt, llm.withStructuredOutput(ExtractionSchema)]);
      const result = await chain.invoke({ conversation: conversationText });

      let count = 0;
      for (const fact of result.facts) {
        await memoryDao.upsert({
          userId,
          keyName: fact.key,
          value: fact.value,
          importance: fact.importance,
          source: 'extracted',
        });
        count++;
      }
      logger.info('Extracted memories', { count, userId });
      return count;
    } catch (err) {
      logger.error('Memory extraction failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  // ---------- Summarization ----------

  /**
   * Fold the oldest `messageCountToFold` messages of a session into a single
   * summary row, then delete those messages. Returns the new summary.
   *
   * Caller is responsible for ensuring there are at least that many messages
   * and that the most recent `keepRecent` should remain in the active window.
   */
  async summarizeAndFold(
    sessionId: string,
    messagesToFold: MessageRow[],
  ): Promise<{ summaryId: string; foldedCount: number } | null> {
    if (messagesToFold.length === 0) return null;

    const conversationText = messagesToFold
      .map((m) => `${m.role.toUpperCase()}: ${rowContentToString(m.content)}`)
      .join('\n');

    try {
      const { lcPrompts, lcRunnables, llmProvider } = await loadLangChainBits();
      const prompt = lcPrompts.ChatPromptTemplate.fromMessages([
        [
          'system',
          `You are a conversation summarizer. Produce a compact summary that preserves the key facts, decisions, and user intents from the segment below. Output JSON matching the schema exactly.`,
        ],
        ['human', 'Conversation segment:\n\n{conversation}'],
      ]);

      const llm = llmProvider.createChatModel({ temperature: 0 });
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

      // Delete the folded messages
      await messageDao.deleteOlderThan(sessionId, rangeEnd + 1);

      logger.info('Folded messages into summary', {
        sessionId,
        foldedCount: messagesToFold.length,
        summaryId: summary.id,
      });
      return { summaryId: summary.id, foldedCount: messagesToFold.length };
    } catch (err) {
      logger.error('Summarization failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Convenience: if a session has more than `threshold` messages, fold the
   * oldest `foldCount` of them. Returns whether summarization ran.
   */
  async maybeSummarize(
    sessionId: string,
    options: { threshold: number; foldCount: number },
  ): Promise<boolean> {
    const total = await messageDao.countBySession(sessionId);
    if (total <= options.threshold) return false;

    // Fetch oldest `foldCount` messages
    const oldest = await messageDao.listBySession(sessionId);
    const toFold = oldest.slice(0, options.foldCount);
    const result = await this.summarizeAndFold(sessionId, toFold);
    return result !== null;
  }

  // ---------- Recall ----------

  /**
   * Build a "memory block" string for injection into the system prompt.
   * Lists top-N memories by importance + key points from prior session summaries.
   */
  async buildMemoryBlock(
    sessionId: string,
    userId: string = DEFAULT_USER,
    options?: { memoryLimit?: number; summaryLimit?: number },
  ): Promise<string> {
    const memoryLimit = options?.memoryLimit ?? 15;
    const summaryLimit = options?.summaryLimit ?? 5;

    const memories = await memoryDao.listByUser(userId, { limit: memoryLimit });
    const summaries = await sessionSummaryDao.listBySession(sessionId);
    const recentSummaries = summaries.slice(-summaryLimit);

    if (memories.length === 0 && recentSummaries.length === 0) return '';

    const lines: string[] = [];
    lines.push('# Memory context for this session\n');

    if (memories.length > 0) {
      lines.push('## Long-term facts about the user');
      for (const m of memories) {
        lines.push(`- **${m.keyName}**: ${m.value} (importance=${m.importance})`);
      }
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

  // ---------- CRUD for the controller ----------

  async listMemories(userId: string = DEFAULT_USER) {
    const rows = await memoryDao.listByUser(userId);
    return rows.map((r) => ({
      id: r.id,
      keyName: r.keyName,
      value: r.value,
      importance: r.importance,
      source: r.source,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async upsertMemory(
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

  async deleteMemory(id: string, userId: string = DEFAULT_USER) {
    return memoryDao.deleteById(id, userId);
  }

  async listSummaries(sessionId: string) {
    const rows = await sessionSummaryDao.listBySession(sessionId);
    return rows.map((r) => ({
      id: r.id,
      summary: r.summary,
      keyPoints: r.keyPoints,
      rangeStart: r.rangeStart,
      rangeEnd: r.rangeEnd,
      messageCount: r.messageCount,
      createdAt: r.createdAt,
    }));
  }
}

export const memoryService = new MemoryService();

/**
 * Flatten a DB row's `content` (v2: ContentBlock[] | v1: string) to a plain
 * string for memory extraction / summarisation prompts. Mirrors the
 * normaliseRowContent in the DAO but tailored for prompt input.
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