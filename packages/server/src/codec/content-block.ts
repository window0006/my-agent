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
