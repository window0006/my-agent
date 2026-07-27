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

    if (cur.id && cur.name !== undefined) {
      const completed: CompletedToolCall = {
        id: cur.id,
        name: cur.name,
        args: safeParseJson(cur.args || '{}') as Record<string, unknown>,
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
          args: safeParseJson(tc.args || '{}') as Record<string, unknown>,
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

  /** Rebuild the persisted ContentBlock[] from the full stream mirror. */
  toContentBlocks(): ContentBlock[] {
    const out: ContentBlock[] = [];
    let i = 0;
    let inThinking = false;
    let textBuf = '';
    let thinkingBuf = '';

    const flushText = () => { if (textBuf) { out.push({ type: 'text', text: textBuf }); textBuf = ''; } };
    const flushThinking = () => { if (thinkingBuf) { out.push({ type: 'reasoning', reasoning: thinkingBuf }); thinkingBuf = ''; } };

    while (i < this.fullText.length) {
      if (inThinking) {
        const close = this.fullText.indexOf(CLOSE_TAG, i);
        if (close === -1) {
          thinkingBuf += this.fullText.slice(i);
          i = this.fullText.length;
        } else {
          thinkingBuf += this.fullText.slice(i, close);
          flushThinking();
          inThinking = false;
          i = close + CLOSE_TAG.length;
        }
      } else {
        const open = this.fullText.indexOf(OPEN_TAG, i);
        if (open === -1) {
          textBuf += this.fullText.slice(i);
          i = this.fullText.length;
        } else {
          textBuf += this.fullText.slice(i, open);
          flushText();
          inThinking = true;
          i = open + OPEN_TAG.length;
        }
      }
    }
    if (inThinking) flushThinking();
    else flushText();
    return out;
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
      // Tool call chunks — accumulate, emit on completion.
      for (const tcc of chunk.tool_call_chunks ?? []) {
        const done = this.toolAcc.add(tcc);
        if (done) yield { event: 'tool_call', data: { callId: done.id, name: done.name, args: done.args } };
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
      this.toolMessages.push({ tool_call_id: chunk.tool_call_id ?? '', name: chunk.name, content });
      // Also surface as a block on the AI message so persisted history shows
      // call + result together.
      this.aiToolResults.push({ type: 'tool_result', toolCallId: chunk.tool_call_id ?? '', name: chunk.name, content });
      yield {
        event: 'tool_result',
        data: { toolCallId: chunk.tool_call_id, name: chunk.name, content, isError: false },
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

    // Compose the AI message content: text + reasoning + tool_call + tool_result
    const blocks: ContentBlock[] = this.thinkParser.toContentBlocks();
    const completedToolCalls = this.toolAcc.drainAll();
    for (const tc of completedToolCalls) {
      blocks.push({ type: 'tool_call', name: tc.name, args: tc.args, callId: tc.id } as ContentBlock);
    }
    for (const tr of this.aiToolResults) blocks.push(tr);

    const aiMessage = {
      content: blocks,
      tool_calls: completedToolCalls.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args })),
    };

    return { aiMessage, toolMessages: this.toolMessages, chunkCount: this.chunkCount };
  }
}

function stringContent(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map((b) => (b as { text?: string }).text ?? '').join('');
  return String(raw ?? '');
}
