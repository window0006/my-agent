/**
 * API client for MyAgent server.
 * All endpoints are proxied via vite dev server during local dev.
 *
 * v2: Message.content is ContentBlock[] (LangChain 1.2 v1 standard),
 * not a raw string. SSE chunks are still text-only for now (M2 will
 * upgrade the wire to structured events).
 */
import type {
  ContentBlock,
  Message,
  ToolCall,
  TokenUsage,
  MessageStatus,
  Role,
} from '@my-agent/shared';
// Import the runtime helper from the source path (Vite resolves
// `@my-agent/shared` to `dist/index.js`, a CJS file whose `__exportStar`
// re-exports Rollup can't statically analyze).
import { extractText } from '@my-agent/shared/src/types/agent';

export type { ContentBlock, Message, ToolCall, TokenUsage, MessageStatus, Role };
export { extractText };

const BASE = '/api';

export interface ApiSuccess<T = unknown> {
  retcode: number;
  data?: T;
  message?: string;
}

export interface ApiError {
  retcode: number;
  message: string;
  details?: unknown;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

function isError(r: ApiResponse): r is ApiError {
  return r.retcode !== 0;
}

async function request<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (isError(json)) {
    throw new Error(json.message || `API error ${json.retcode}`);
  }
  return json.data as T;
}

// ---------- Sessions ----------

export interface Session {
  id: string;
  title: string;
  userId: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface SessionWithMessages extends Session {
  messages: Message[];
}

export const sessionsApi = {
  list: () => request<Session[]>('/sessions'),
  get: (id: string) => request<SessionWithMessages>(`/sessions/${id}`),
  create: (title?: string) =>
    request<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  delete: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
};

// ---------- Memories ----------

export interface Memory {
  id: string;
  keyName: string;
  value: string;
  importance: number;
  source: string;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export const memoriesApi = {
  list: () => request<Memory[]>('/memories'),
  upsert: (keyName: string, value: string, importance?: number) =>
    request<Memory>('/memories', {
      method: 'POST',
      body: JSON.stringify({ key: keyName, value, importance }),
    }),
  delete: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/memories/${id}`, { method: 'DELETE' }),
};

// ---------- SSE Streaming (M2) ----------

/**
 * M2 wire format — structured events for each block type as the model
 * produces them. Replaces the v1 `chunk: string` wire.
 *
 * The server splits `<think>...</think>` markers from the model output
 * (MiniMax M3 returns reasoning inline in `content`); reasoning and
 * plain text are emitted as separate deltas. Tool calls and tool
 * results come through as full structured events.
 */
export type StreamEvent =
  | { event: 'start'; data: { sessionId: string; role: string } }
  | { event: 'thinking_delta'; data: { text: string } }
  | { event: 'text_delta'; data: { content: string } }
  | { event: 'tool_call'; data: { callId?: string; name: string; args: Record<string, unknown> } }
  | { event: 'tool_result'; data: { toolCallId?: string; name?: string; content: string; isError?: boolean } }
  | { event: 'done'; data: { sessionId: string; totalChunks: number } }
  | { event: 'error'; data: { message: string } };

export interface StreamHandlers {
  onStart?: (data: { sessionId: string; role: string }) => void;
  onThinkingDelta?: (text: string) => void;
  onTextDelta?: (content: string) => void;
  onToolCall?: (callId: string | undefined, name: string, args: Record<string, unknown>) => void;
  onToolResult?: (data: { toolCallId?: string; name?: string; content: string; isError?: boolean }) => void;
  onDone?: (data: { sessionId: string; totalChunks: number }) => void;
  onError?: (message: string) => void;
}

/**
 * Stream an agent turn. Calls handlers for each typed event as the model
 * produces output. Returns an AbortController to cancel mid-stream.
 */
export function streamAgentTurn(
  sessionId: string,
  message: string,
  handlers: StreamHandlers,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/sessions/${sessionId}/run/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        handlers.onError?.(`HTTP ${res.status}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE format: events separated by blank line (\n\n).
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const lines = part.split('\n');
          let eventName = 'message';
          let dataLine = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataLine += line.slice(6);
          }
          if (!dataLine) continue;
          try {
            const data = JSON.parse(dataLine);
            switch (eventName) {
              case 'start':
                handlers.onStart?.(data);
                break;
              case 'thinking_delta':
                handlers.onThinkingDelta?.(data.text ?? '');
                break;
              case 'text_delta':
                handlers.onTextDelta?.(data.content ?? '');
                break;
              case 'tool_call':
                handlers.onToolCall?.(data.callId, data.name, data.args ?? {});
                break;
              case 'tool_result':
                handlers.onToolResult?.(data);
                break;
              case 'done':
                handlers.onDone?.(data);
                break;
              case 'error':
                handlers.onError?.(data.message ?? 'stream error');
                break;
            }
          } catch {
            // ignore malformed events
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        handlers.onError?.((err as Error).message);
      }
    }
  })();

  return controller;
}
