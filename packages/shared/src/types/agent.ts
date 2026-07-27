/**
 * Agent domain types shared between server and web.
 *
 * Design note: ContentBlock field names follow LangChain 1.2 v1 standard
 * (outputVersion: "v1"). The backend stores the raw LangChain structure;
 * the frontend consumes it directly. This keeps a 1:1 mapping so we can
 * swap a custom type for `import type { ContentBlock } from "@langchain/core"`
 * in the future without a codec layer.
 */
import type { ContentBlock } from '@langchain/core/messages';

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export type { ContentBlock };

/**
 * Standard content blocks, narrowed to the union we care about.
 * LangChain defines a wider union (citation / non_standard / audio / etc.)
 * but we surface the core five: text / reasoning / tool_call / tool_result / image.
 *
 * - `reasoning` is LangChain 1.2's name for "thinking" (Anthropic: thinking,
 *   OpenAI: reasoning_content, LangChain 1.2: reasoning).
 * - `tool_call` carries the call itself; the corresponding result is on the
 *   ToolMessage (linked via `toolCallId` on the message, not in content).
 */
export type StandardContentBlock = Extract<
  ContentBlock,
  { type: 'text' | 'reasoning' | 'tool_call' | 'image' }
> | ToolResultBlock;

/**
 * Tool result is a first-class block (not a separate message role) so a single
 * AI message can carry interleaved text + tool_call + tool_result. LangChain
 * keeps tool result on the ToolMessage level; we surface both views.
 */
export interface ToolResultBlock {
  type: 'tool_result';
  toolCallId: string;
  name?: string;
  content: string | StandardContentBlock[];
  isError?: boolean;
  durationMs?: number;
}

export type MessageStatus =
  | 'pending'     // message row created, not yet persisted/streamed
  | 'streaming'   // currently receiving chunks
  | 'success'     // finished successfully
  | 'error'       // failed; can be retried
  | 'aborted';    // user-cancelled mid-stream

/**
 * Mirrors LangChain's `InvalidToolCall` block but with our narrowed type.
 */
export interface InvalidToolCallBlock {
  type: 'invalid_tool_call';
  name?: string;
  args?: string;
  error?: string;
}

/**
 * Canonical tool call. Mirrors LangChain's ToolCall block field names.
 */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * The unified message envelope. The `content` field is always a ContentBlock
 * array — never a raw string — so the frontend can render each block type
 * (text, reasoning, tool_call, tool_result, image) with its own component.
 *
 * For assistant messages, `toolCalls` may also live at the top level (the
 * LangChain `tool_calls` field on AIMessage). Tool results are always
 * inside `content` as `tool_result` blocks; their `toolCallId` links back
 * to the originating tool call.
 */
export interface Message {
  id: string;
  role: Role;
  content: ContentBlock[];
  /** Assistant: top-level tool calls (mirrors AIMessage.tool_calls). */
  toolCalls?: ToolCall[];
  /** Tool message: links to the originating tool_call id. */
  toolCallId?: string | null;
  toolName?: string | null;
  /** For tool_result blocks: which tool_call they satisfy. */
  parentId?: string | null;
  status: MessageStatus;
  model?: string | null;
  usage?: TokenUsage | null;
  finishReason?: string | null;
  createdAt: number;
}

export interface Session {
  id: string;
  title: string;
  userId?: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentRunRequest {
  sessionId: string;
  userMessage: string;
  stream?: boolean;
}

export interface AgentRunResponse {
  sessionId: string;
  message: Message;
  toolCalls?: ToolCall[];
  toolResults?: ToolCall[];
}

/**
 * Helper: extract plain text from a message's content blocks.
 * Used by search, summaries, and any consumer that doesn't need structure.
 */
export function extractText(content: ContentBlock[]): string {
  return content
    .map((b) => {
      switch (b.type) {
        case 'text':
          return b.text;
        case 'reasoning':
          return b.reasoning;
        case 'tool_call':
          return `[${b.name}(${JSON.stringify(b.args)})]`;
        case 'image':
          return '[image]';
        default:
          return '';
      }
    })
    .join('');
}
