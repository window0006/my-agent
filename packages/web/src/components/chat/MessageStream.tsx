/**
 * MessageStream — v2 + M2:
 *   - Builds a tool_call_id → tool_result block map across all messages,
 *     so each ToolCallCard can render its result inline.
 *   - Passes live `streamingBlocks` to the in-flight assistant message.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Message, ToolResultBlock, ContentBlock } from '../../api/client';
import { MessageBubble } from './MessageBubble';

interface Props {
  messages: Message[];
  /** Live content blocks for the in-flight assistant turn. */
  streamingBlocks: ContentBlock[];
  isStreaming: boolean;
}

export function MessageStream({ messages, streamingBlocks, isStreaming }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build tool_call_id → result map from all tool-role messages so each
  // ToolCallCard can find its matching result. Also includes in-flight
  // tool_result blocks from streamingBlocks so the UI updates during a turn.
  const toolResultsByCallId = useMemo(() => {
    const map = new Map<string, ToolResultBlock>();
    const ingest = (m: Message) => {
      if (m.role !== 'tool') return;
      if (!m.toolCallId) return;
      const first = m.content[0];
      if (first && first.type === 'text') {
        map.set(m.toolCallId, {
          type: 'tool_result',
          toolCallId: m.toolCallId,
          name: m.toolName ?? undefined,
          content: first.text,
        });
      }
    };
    for (const m of messages) ingest(m);
    // Also include any in-flight tool_result blocks.
    for (const b of streamingBlocks) {
      if (b.type === 'tool_result') {
        map.set(b.toolCallId, b);
      }
    }
    return map;
  }, [messages, streamingBlocks]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingBlocks]);

  return (
    <div
      ref={scrollRef}
      style={{ height: '100%', overflow: 'auto', padding: '24px 24px 16px' }}
    >
      {messages.map((m, idx) => {
        const isLast = idx === messages.length - 1;
        const isStreamingMsg = isLast && isStreaming && m.role === 'assistant';
        return (
          <MessageBubble
            key={m.id}
            message={m}
            streamingBlocks={isStreamingMsg ? streamingBlocks : undefined}
            streaming={isStreamingMsg}
            toolResultsByCallId={toolResultsByCallId}
          />
        );
      })}
    </div>
  );
}
