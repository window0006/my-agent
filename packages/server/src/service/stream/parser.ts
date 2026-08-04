/**
 * Stream state machine — owns the two accumulators that turn LangChain's
 * streamed chunks into typed events and a final persisted shape.
 *
 *   ThinkTagParser  — splits text deltas on <think>...</think> boundaries
 *                     (MiniMax M3 wire format for inline reasoning).
 *   ToolCallAccumulator — assembles tool_call_chunk fragments into complete
 *                     tool calls.
 *
 * Both are stateful because stream boundaries can straddle chunks.
 */
import { v4 as uuidv4 } from 'uuid';
import type { ContentBlock } from '@my-agent/shared';
import { safeParseJson } from '../../codec/json';
import { parseThinkTags } from '../../codec/content-block';

// ============================================================
// ToolCallAccumulator
// ============================================================

interface AccEntry { id?: string; name?: string; args: string }

export interface CompletedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export class ToolCallAccumulator {
  private byIndex = new Map<number, AccEntry>();

  /** Returns the completed call when id+name+args are all present, else null. */
  add(tcc: { name?: string; args?: string; id?: string; index?: number }): CompletedToolCall | null {
    const idx = tcc.index ?? 0;
    const cur = this.byIndex.get(idx) ?? { id: undefined, name: undefined, args: '' };
    if (tcc.id) cur.id = tcc.id;
    if (tcc.name) cur.name = tcc.name;
    if (tcc.args !== undefined) cur.args += tcc.args;
    this.byIndex.set(idx, cur);

    // Complete when all three fields have been seen. `args` being non-empty
    // is the signal that the LLM has started streaming the JSON; we still
    // parse lazily at completion time, so a truncated stream just gets
    // parsed as `{}` rather than dropped.
    if (cur.id && cur.name !== undefined && cur.args) {
      const completed: CompletedToolCall = {
        id: cur.id,
        name: cur.name,
        args: safeParseJson(cur.args) as Record<string, unknown>,
      };
      this.byIndex.delete(idx);
      return completed;
    }
    return null;
  }

  /** End-of-stream: emit any in-progress calls (whose args stream was cut off). */
  drainAll(): CompletedToolCall[] {
    const out: CompletedToolCall[] = [];
    for (const [, tc] of this.byIndex) {
      if (tc.id && tc.name !== undefined) {
        out.push({
          id: tc.id,
          name: tc.name,
          args: tc.args ? (safeParseJson(tc.args) as Record<string, unknown>) : {},
        });
      }
    }
    this.byIndex.clear();
    return out;
  }
}

// ============================================================
// ThinkTagParser
// ============================================================

export type ParsedDelta = { kind: 'text' | 'thinking'; text: string };

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/** Splits text deltas on <think>...</think> boundaries; mirrors the full
 *  stream so `toContentBlocks()` can rebuild the persisted block array. */
export class ThinkTagParser {
  private inThinking = false;
  private buffer = '';
  private fullText = '';

  feed(delta: string): ParsedDelta[] {
    this.fullText += delta;
    this.buffer += delta;
    const out: ParsedDelta[] = [];
    let i = 0;

    while (i < this.buffer.length) {
      if (this.inThinking) {
        const close = this.buffer.indexOf(CLOSE_TAG, i);
        if (close === -1) {
          this.buffer = this.buffer.slice(i);
          return out;
        }
        out.push({ kind: 'thinking', text: this.buffer.slice(i, close) });
        this.inThinking = false;
        i = close + CLOSE_TAG.length;
      } else {
        const open = this.buffer.indexOf(OPEN_TAG, i);
        if (open === -1) {
          if (i < this.buffer.length) out.push({ kind: 'text', text: this.buffer.slice(i) });
          this.buffer = '';
          return out;
        }
        if (open > i) out.push({ kind: 'text', text: this.buffer.slice(i, open) });
        this.inThinking = true;
        i = open + OPEN_TAG.length;
      }
    }

    this.buffer = this.inThinking ? this.buffer.slice(i) : '';
    return out;
  }

  /** Flush any unclosed tail (e.g. stream ended mid-<think>). */
  flush(): ParsedDelta[] {
    if (!this.buffer) return [];
    const tail = this.buffer;
    this.buffer = '';
    return [{ kind: this.inThinking ? 'thinking' : 'text', text: tail }];
  }

  /** Rebuild the persisted ContentBlock[] from the full stream mirror.
   *  Delegates to the shared codec so streaming and non-streaming produce
   *  the exact same shape (no duplicate parsing logic to drift). */
  toContentBlocks(): ContentBlock[] {
    return parseThinkTags(this.fullText);
  }
}

// ============================================================
// StreamParser — top-level state machine for a streaming turn
// ============================================================

export interface ToolResultEvent {
  toolCallId?: string;
  name?: string;
  content: string;
  isError: boolean;
}

export interface FinalisedTurn {
  /** A single AIMessage holding text + reasoning + tool_call blocks. */
  aiMessage: { content: ContentBlock[]; tool_calls: Array<{ id: string; name: string; args: Record<string, unknown> }> };
  /** Standalone ToolMessages to persist alongside the AIMessage. */
  toolMessages: Array<{ tool_call_id: string; name?: string; content: string }>;
  chunkCount: number;
}

export interface StreamChunk {
  constructor?: { name?: string };
  content?: unknown;
  tool_call_chunks?: Array<{ name?: string; args?: string; id?: string; index?: number }>;
  tool_call_id?: string;
  name?: string;
}

export class StreamParser {
  private thinkParser = new ThinkTagParser();
  private toolAcc = new ToolCallAccumulator();
  private completedToolCalls: CompletedToolCall[] = [];  // tracks what was emitted as events
  private inProgressToolCalls: CompletedToolCall[] = []; // tracks truncated-by-stream-end
  private aiToolResults: ContentBlock[] = [];
  private toolMessages: FinalisedTurn['toolMessages'] = [];
  private chunkCount = 0;
  private textBuf = '';
  private reasoningBuf = '';
  private hasEmittedStart = false;

  /** Process one chunk; returns SSE events to emit. */
  *feed(chunk: StreamChunk): Generator<{ event: string; data: unknown }> {
    this.chunkCount++;

    if (!this.hasEmittedStart) {
      yield { event: 'start', data: { role: 'assistant' } };
      this.hasEmittedStart = true;
    }

    const ctorName = chunk.constructor?.name;
    if (ctorName === 'AIMessageChunk' || ctorName === 'AIMessage') {
      // Tool call chunks — accumulate, emit on completion, remember for finalize.
      for (const tcc of chunk.tool_call_chunks ?? []) {
        const done = this.toolAcc.add(tcc);
        if (done) {
          this.completedToolCalls.push(done);
          yield { event: 'tool_call', data: { callId: done.id, name: done.name, args: done.args } };
        }
      }
      // Text deltas — split on <think> boundaries.
      if (typeof chunk.content === 'string' && chunk.content.length > 0) {
        for (const d of this.thinkParser.feed(chunk.content)) {
          if (d.kind === 'thinking') {
            this.reasoningBuf += d.text;
            yield { event: 'thinking_delta', data: { text: d.text } };
          } else {
            this.textBuf += d.text;
            yield { event: 'text_delta', data: { content: d.text } };
          }
        }
      }
    } else if (ctorName === 'ToolMessage') {
      const content = stringContent(chunk.content);
      // Tool error is signalled by the sandbox via a `[ERROR]` (or `[sandbox]`)
      // prefix in the result string — `formatShellResult` is the only producer.
      // The sniff lives here at the SSE boundary so the entire downstream chain
      // (UI, DB) can rely on a typed boolean instead of regex-ing prefixes.
      const isError = content.startsWith('[ERROR]') || content.startsWith('[sandbox]');
      this.toolMessages.push({ tool_call_id: chunk.tool_call_id ?? '', name: chunk.name, content });
      this.aiToolResults.push({
        type: 'tool_result',
        toolCallId: chunk.tool_call_id ?? '',
        name: chunk.name,
        content,
        ...(isError ? { isError: true } : {}),
      });
      yield {
        event: 'tool_result',
        data: { toolCallId: chunk.tool_call_id, name: chunk.name, content, isError },
      };
    }
  }

  /** End-of-stream: flush parser tail, build the persisted message shape. */
  finalize(): FinalisedTurn {
    // Flush any unclosed <think> tail.
    for (const d of this.thinkParser.flush()) {
      if (d.kind === 'thinking') this.reasoningBuf += d.text;
      else this.textBuf += d.text;
    }

    // Drain any in-progress tool calls whose args stream was cut off.
    this.inProgressToolCalls = this.toolAcc.drainAll();

    // Compose the AI message content: text + reasoning + tool_call + tool_result
    const blocks: ContentBlock[] = this.thinkParser.toContentBlocks();
    const allToolCalls = [...this.completedToolCalls, ...this.inProgressToolCalls];
    for (const tc of allToolCalls) {
      blocks.push({ type: 'tool_call', name: tc.name, args: tc.args, callId: tc.id } as ContentBlock);
    }
    for (const tr of this.aiToolResults) blocks.push(tr);

    const aiMessage = {
      content: blocks,
      tool_calls: allToolCalls.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args })),
    };

    return { aiMessage, toolMessages: this.toolMessages, chunkCount: this.chunkCount };
  }
}

function stringContent(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map((b) => (b as { text?: string }).text ?? '').join('');
  return String(raw ?? '');
}
