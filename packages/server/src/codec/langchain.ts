/**
 * Codec between LangChain 1.x BaseMessage and our shared `Message` type.
 *
 * Pure functions — no DB, no network. The only place in the codebase that
 * knows the LangChain v0 / v1 / Anthropic content shapes; everything else
 * sees our normalised `Message` and `ContentBlock[]` types.
 */
import { v4 as uuidv4 } from 'uuid';
import type { ContentBlock, Message, TokenUsage, ToolCall } from '@my-agent/shared';
import { safeParseJson } from './json';

/**
 * Convert a LangChain BaseMessage to a row ready for `messageDao.create()`.
 * Returns null for system messages (we re-inject memory fresh each turn).
 */
export function baseMessageToMessage(
  msg: LangChainMessage,
  sessionId: string,
): MessageRowInput | null {
  const ctorName = msg.constructor?.name ?? '';
  if (ctorName.startsWith('SystemMessage')) return null;

  const role = inferRole(ctorName);
  return {
    id: uuidv4(),
    sessionId,
    role,
    content: normaliseContent(msg.content),
    toolCalls: extractToolCalls(msg.tool_calls),
    toolCallId: msg.tool_call_id ?? null,
    toolName: msg.name ?? null,
    parentMessageId: null,  // resolved in service.persistOutputs second pass
    status: 'success',
    model: msg.response_metadata?.model_name ?? null,
    usage: extractUsage(msg.usage_metadata),
    finishReason: msg.response_metadata?.finish_reason ?? null,
  };
}

function inferRole(ctorName: string): Message['role'] {
  switch (ctorName) {
    case 'HumanMessage':   return 'user';
    case 'AIMessage':      return 'assistant';
    case 'ToolMessage':    return 'tool';
    case 'AIMessageChunk': return 'assistant';
    default: {
      // DB only allows 4 roles; force a type error if a new LC class appears.
      const _exhaustive: never = ctorName as never;
      throw new Error(`Unknown message constructor: ${_exhaustive}`);
    }
  }
}

function extractToolCalls(raw: unknown): ToolCall[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((tc) => {
    const t = tc as { id?: string; name?: string; args?: unknown };
    const args = typeof t.args === 'string' ? safeParseJson(t.args) : t.args;
    return {
      id: t.id ?? uuidv4(),
      name: t.name ?? '',
      args: (args as Record<string, unknown>) ?? {},
    };
  });
}

function extractUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  if (u.input_tokens == null && u.output_tokens == null && u.total_tokens == null) return null;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}

/**
 * Normalise LangChain content (string | ContentBlock[] | unknown) to our
 * ContentBlock[] shape. Called when constructing messages for persistence.
 */
export function normaliseContent(raw: unknown): ContentBlock[] {
  if (typeof raw === 'string') return [{ type: 'text', text: raw }];
  if (Array.isArray(raw)) {
    const out = raw.map(normaliseBlock).filter(Boolean) as ContentBlock[];
    return out.length > 0 ? out : [{ type: 'text', text: '' }];
  }
  if (raw && typeof raw === 'object') {
    const b = normaliseBlock(raw);
    return b ? [b] : [{ type: 'text', text: '' }];
  }
  return [{ type: 'text', text: '' }];
}

function normaliseBlock(block: unknown): ContentBlock | null {
  if (!block) return null;
  if (typeof block === 'string') return { type: 'text', text: block };
  if (typeof block !== 'object') return null;

  const b = block as {
    type?: string;
    text?: string;
    reasoning?: string;
    thinking?: string;
    name?: string;
    args?: unknown;
    input?: unknown;
    id?: string;
    callId?: string;
    source?: unknown;
    image_url?: unknown;
  };

  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text ?? '' };
    case 'reasoning':
      return { type: 'reasoning', reasoning: b.reasoning ?? '' };
    case 'thinking':  // older Anthropic / MiniMax M3 inline form
      return { type: 'reasoning', reasoning: b.thinking ?? '' };
    case 'tool_call':
      return {
        type: 'tool_call',
        name: b.name ?? '',
        args: typeof b.args === 'string'
          ? (safeParseJson(b.args) as Record<string, unknown>) ?? {}
          : b.args ?? {},
        ...(b.id ?? b.callId ? { callId: b.id ?? b.callId! } : {}),
      };
    case 'tool_use':  // Anthropic native
      return {
        type: 'tool_call',
        name: b.name ?? '',
        args: (b.input as Record<string, unknown>) ?? {},
        callId: b.id!,
      };
    case 'image':
      if (b.source) return { type: 'image', source: b.source } as ContentBlock;
      if (b.image_url) return { type: 'image', url: b.image_url } as ContentBlock;
      return null;
    default:
      // Unknown / provider-specific block — keep it as non_standard so the
      // frontend can decide whether to render or skip.
      return { type: 'non_standard', value: block } as ContentBlock;
  }
}

// ---- Types ----

/** Minimal structural type for the LC fields we read. Avoids importing LC
 *  into this codec so the module can be unit-tested without LangChain. */
export interface LangChainMessage {
  constructor?: { name?: string };
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
  response_metadata?: { model_name?: string; finish_reason?: string };
  usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

export interface MessageRowInput {
  id: string;
  sessionId: string;
  role: Message['role'];
  content: ContentBlock[];
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  toolName: string | null;
  parentMessageId: string | null;
  status: Message['status'];
  model: string | null;
  usage: TokenUsage | null;
  finishReason: string | null;
}
