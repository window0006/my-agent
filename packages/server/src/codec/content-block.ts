/**
 * Codec for ContentBlock[] — the wire format shared between server and web.
 *
 * This module owns the *flatten* / *unflatten* transforms between the
 * structured block array and plain strings. Use it whenever a downstream
 * consumer (LLM prompt, log line, search index) doesn't need the block
 * structure.
 */
import type { ContentBlock } from '@my-agent/shared';

/** Flatten a v2 ContentBlock[] (or legacy v1 string) to plain text. */
export function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(blockToText).join('');
  return String(content ?? '');
}

function blockToText(b: unknown): string {
  if (typeof b === 'string') return b;
  if (!b || typeof b !== 'object') return '';
  const block = b as { type?: string; text?: string; reasoning?: string; name?: string; args?: unknown };
  switch (block.type) {
    case 'text':      return block.text ?? '';
    case 'reasoning': return block.reasoning ?? '';
    case 'tool_call': return `[tool:${block.name}(${JSON.stringify(block.args)})]`;
    case 'tool_result': return '[tool_result]';
    case 'image':     return '[image]';
    default:          return '';
  }
}

/** Wrap a plain string as a single text block. */
export function textToBlocks(text: string): ContentBlock[] {
  return [{ type: 'text', text }];
}

/**
 * Parse MiniMax M3's inline `<think>...</think>` wire format into ContentBlocks.
 * Content outside the tags becomes `text` blocks; content inside becomes
 * `reasoning` blocks. Empty fragments are dropped.
 *
 * **Why this lives here, not in the stream parser**: M3 returns reasoning
 * inline as `<think>...</think>` within the content string, not as a
 * separate `reasoning_content` field (OpenAI o1) or a separate content block
 * (Anthropic). The same model produces this format whether the response
 * came from a streaming turn or a non-streaming turn, so the parser must
 * live at the LangChain → shared-type boundary (here), not in either
 * transport path. Both the codec (`normaliseContent`) and the stream
 * parser (`ThinkTagParser.toContentBlocks`) call this same function so
 * the two paths can't drift.
 *
 * **Lenient on unclosed `<think>`**: the rest of the input is treated as
 * a text block, not silently dropped. The streaming parser's `flush()`
 * has a different lenience (it returns the tail as whatever kind we were
 * in) — that asymmetry is fine because streaming sees partial data, while
 * this function sees the final complete text.
 */
export function parseThinkTags(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let i = 0;

  while (i < text.length) {
    const open = text.indexOf('<think>', i);
    if (open === -1) {
      // No more think tags — remainder is text.
      const tail = text.slice(i);
      if (tail) blocks.push({ type: 'text', text: tail });
      break;
    }
    if (open > i) blocks.push({ type: 'text', text: text.slice(i, open) });
    const close = text.indexOf('</think>', open + '<think>'.length);
    if (close === -1) {
      // Unclosed — treat the rest as text (don't drop data on the floor).
      const tail = text.slice(open);
      if (tail) blocks.push({ type: 'text', text: tail });
      break;
    }
    const reasoning = text.slice(open + '<think>'.length, close);
    if (reasoning) blocks.push({ type: 'reasoning', reasoning });
    i = close + '</think>'.length;
  }

  return blocks;
}
