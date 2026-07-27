/**
 * Zustand store for the chat UI.
 * Holds sessions, the currently-active session, in-flight messages, and
 * control panel state (mobile drawer visibility, etc.).
 *
 * v2 + M2: messages hold ContentBlock[] (LangChain 1.2 v1). During a
 * streaming turn, `streamingBlocks` is the in-flight block array the
 * server is sending via typed SSE events. On `done`, the server's
 * persisted message replaces the optimistic one.
 */
import { create } from 'zustand';
import {
  sessionsApi,
  memoriesApi,
  streamAgentTurn,
  type Session,
  type Message,
  type ContentBlock,
  type ToolResultBlock,
} from '../api/client';

interface ChatState {
  // Session list
  sessions: Session[];
  activeSessionId: string | null;

  // Messages in the currently-open session (server-side messages)
  messages: Message[];
  // In-flight content blocks for the streaming assistant message. Lives
  // outside `messages` so the optimistic placeholder doesn't have to
  // be mutated on every chunk.
  streamingBlocks: ContentBlock[];
  isStreaming: boolean;

  // Memories (for the control panel)
  memories: { id: string; keyName: string; value: string; importance: number }[];

  // UI flags
  loading: boolean;
  mobilePanelOpen: boolean;
  mobileSidebarOpen: boolean;
  // Control panel collapsed on PC
  controlPanelOpen: boolean;

  // ----- Actions -----
  refreshSessions: () => Promise<void>;
  createSession: (title?: string) => Promise<Session>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  stopStreaming: () => void;
  refreshMemories: () => Promise<void>;
  upsertMemory: (keyName: string, value: string, importance?: number) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  setMobilePanelOpen: (open: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleControlPanel: () => void;
}

/**
 * Append a delta to the live `streamingBlocks` array. Coalesces with
 * the previous block of the same kind (text + text → append, etc.) so
 * we don't create a new block per chunk.
 */
function appendDelta(blocks: ContentBlock[], delta: { kind: 'text' | 'thinking'; text: string }): ContentBlock[] {
  const last = blocks[blocks.length - 1];
  if (delta.kind === 'text' && last?.type === 'text') {
    const next = blocks.slice(0, -1);
    next.push({ type: 'text', text: (last as { text: string }).text + delta.text });
    return next;
  }
  if (delta.kind === 'thinking' && last?.type === 'reasoning') {
    const next = blocks.slice(0, -1);
    next.push({ type: 'reasoning', reasoning: (last as { reasoning: string }).reasoning + delta.text });
    return next;
  }
  // Different kind or first block — push new.
  if (delta.kind === 'thinking') {
    return [...blocks, { type: 'reasoning', reasoning: delta.text }];
  }
  return [...blocks, { type: 'text', text: delta.text }];
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  streamingBlocks: [],
  isStreaming: false,
  memories: [],
  loading: false,
  mobilePanelOpen: false,
  mobileSidebarOpen: false,
  controlPanelOpen: true,

  refreshSessions: async () => {
    set({ loading: true });
    try {
      const sessions = await sessionsApi.list();
      set({ sessions, loading: false });
    } catch (err) {
      console.error('Failed to load sessions:', err);
      set({ loading: false });
    }
  },

  createSession: async (title?: string) => {
    const session = await sessionsApi.create(title ?? '新会话');
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: session.id,
      messages: [],
      streamingBlocks: [],
    }));
    return session;
  },

  selectSession: async (id: string) => {
    set({ activeSessionId: id, messages: [], streamingBlocks: [] });
    try {
      const data = await sessionsApi.get(id);
      set({ messages: data.messages });
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  },

  deleteSession: async (id: string) => {
    await sessionsApi.delete(id);
    const { activeSessionId } = get();
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      activeSessionId: activeSessionId === id ? null : activeSessionId,
      messages: activeSessionId === id ? [] : s.messages,
    }));
  },

  sendMessage: async (text: string) => {
    const { activeSessionId, messages } = get();
    if (!activeSessionId || !text.trim()) return;

    // Optimistic: append a user message + an empty assistant placeholder.
    const userMsg: Message = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text }],
      status: 'success',
      createdAt: Date.now(),
    };
    const assistantMsg: Message = {
      id: `local-assistant-${Date.now()}`,
      role: 'assistant',
      content: [],
      status: 'streaming',
      createdAt: Date.now(),
    };
    set({
      messages: [...messages, userMsg, assistantMsg],
      streamingBlocks: [],
      isStreaming: true,
    });

    const controller = streamAgentTurn(activeSessionId, text, {
      onStart: () => {
        set({ streamingBlocks: [] });
      },
      onThinkingDelta: (text) => {
        set((s) => ({ streamingBlocks: appendDelta(s.streamingBlocks, { kind: 'thinking', text }) }));
      },
      onTextDelta: (content) => {
        set((s) => ({ streamingBlocks: appendDelta(s.streamingBlocks, { kind: 'text', text: content }) }));
      },
      onToolCall: (callId, name, args) => {
        set((s) => ({
          streamingBlocks: [
            ...s.streamingBlocks,
            { type: 'tool_call', name, args, ...(callId ? { callId } : {}) } as ContentBlock,
          ],
        }));
      },
      onToolResult: (data) => {
        const block: ToolResultBlock = {
          type: 'tool_result',
          toolCallId: data.toolCallId ?? '',
          ...(data.name ? { name: data.name } : {}),
          content: data.content,
          ...(data.isError ? { isError: true } : {}),
        };
        set((s) => ({ streamingBlocks: [...s.streamingBlocks, block] }));
      },
      onDone: async () => {
        set({ isStreaming: false });
        try {
          const data = await sessionsApi.get(activeSessionId);
          set({ messages: data.messages, streamingBlocks: [] });
        } catch (err) {
          console.error('Failed to refresh after stream:', err);
        }
      },
      onError: (msg) => {
        set((s) => ({
          streamingBlocks: [
            ...s.streamingBlocks,
            { type: 'text', text: `\n\n[错误] ${msg}` },
          ],
          isStreaming: false,
        }));
      },
    });

    // Stash the controller on the store for stopStreaming() to find.
    (get() as unknown as { _abort: AbortController | null })._abort = controller;
  },

  stopStreaming: () => {
    const ctrl = (get() as unknown as { _abort?: AbortController })._abort;
    ctrl?.abort();
    set({ isStreaming: false });
  },

  refreshMemories: async () => {
    try {
      const memories = await memoriesApi.list();
      set({ memories });
    } catch (err) {
      console.error('Failed to load memories:', err);
    }
  },

  upsertMemory: async (keyName, value, importance) => {
    await memoriesApi.upsert(keyName, value, importance);
    await get().refreshMemories();
  },

  deleteMemory: async (id) => {
    await memoriesApi.delete(id);
    await get().refreshMemories();
  },

  setMobilePanelOpen: (open) => set({ mobilePanelOpen: open }),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  toggleControlPanel: () => set((s) => ({ controlPanelOpen: !s.controlPanelOpen })),
}));
