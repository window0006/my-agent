/**
 * MessageBubble — v2 + M2: renders a message by switching on each content block's
 * `type`. No more regex parsing of streamed text — the server gives us
 * structured ContentBlock[] either from the persisted message or from
 * the live `streamingBlocks` during a turn.
 */
import { Avatar } from 'antd';
import { UserOutlined, RobotOutlined } from '@ant-design/icons';
import type { ContentBlock, Message, ToolResultBlock } from '../../api/client';
import { ThinkingCard } from '../cards/ThinkingCard';
import { ToolCallCard } from '../cards/ToolCallCard';
import { MarkdownContent } from './MarkdownContent';
import { extractText } from '../../api/client';

interface Props {
  message: Message;
  /** Live content blocks accumulating during the current turn. Only used for the streaming assistant msg. */
  streamingBlocks?: ContentBlock[];
  /** True while this message is the in-flight one (sets streaming styling + cursor). */
  streaming?: boolean;
  /** Map from tool_call id → matching tool_result block (for the same assistant turn). */
  toolResultsByCallId?: Map<string, ToolResultBlock>;
}

export function MessageBubble({
  message,
  streamingBlocks,
  streaming,
  toolResultsByCallId,
}: Props) {
  const isUser = message.role === 'user';

  // While streaming, the live blocks are passed in from the store; otherwise
  // we render the persisted message's content array.
  const blocks: ContentBlock[] =
    streaming && streamingBlocks ? streamingBlocks : message.content;

  return (
    <div className={`message-row ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && (
        <Avatar icon={<RobotOutlined />} className="message-avatar" size={32} />
      )}
      <div className="message-content">
        {blocks.length === 0 && !streaming && (
          <div className="message-bubble message-bubble--empty" />
        )}
        {blocks.map((block, i) => (
          <BlockView
            key={i}
            block={block}
            streaming={streaming}
            isUser={isUser}
            isLast={i === blocks.length - 1}
            toolResultsByCallId={toolResultsByCallId}
          />
        ))}
        {isUser && (
          <Avatar icon={<UserOutlined />} className="message-avatar" size={32} />
        )}
      </div>
    </div>
  );
}

function BlockView({
  block,
  streaming,
  isUser,
  isLast,
  toolResultsByCallId,
}: {
  block: ContentBlock;
  streaming?: boolean;
  isUser: boolean;
  isLast: boolean;
  toolResultsByCallId?: Map<string, ToolResultBlock>;
}) {
  switch (block.type) {
    case 'text': {
      const empty = !block.text.trim();
      if (empty && !streaming) return null;
      // User messages are plain text; assistant messages get Markdown.
      if (isUser) {
        return <div className="message-bubble">{block.text}</div>;
      }
      // Last block + streaming → keep bubble at full width (no jitter).
      const useStreamingClass = streaming && isLast;
      return (
        <div
          className={
            'message-bubble' +
            (useStreamingClass ? ' message-bubble--streaming cursor-blink' : '')
          }
        >
          <MarkdownContent text={block.text} streaming={!!useStreamingClass} />
        </div>
      );
    }
    case 'reasoning':
      return (
        <ThinkingCard text={block.reasoning} streaming={streaming && isLast} />
      );
    case 'tool_call': {
      const result = block.callId
        ? toolResultsByCallId?.get(block.callId)
        : undefined;
      return (
        <ToolCallCard
          name={block.name}
          args={(block.args as Record<string, unknown>) ?? {}}
          result={result}
        />
      );
    }
    case 'tool_result': {
      // Tool results that arrive as content blocks (e.g. inline with tool_call
      // on the same message). Show as a result card with status.
      return (
        <ToolCallCard
          name={block.name ?? 'tool_result'}
          args={{}}
          result={block}
        />
      );
    }
    case 'image':
      return (
        <div className="message-bubble">
          <img
            src={typeof block.url === 'string' ? block.url : ''}
            alt={block.alt ?? 'image'}
            style={{ maxWidth: '100%', borderRadius: 6 }}
          />
        </div>
      );
    default: {
      // NonStandard / unknown — fall back to extractText so we never
      // render raw [object Object] in the UI.
      const text = extractText([block]);
      if (!text) return null;
      return <div className="message-bubble">{text}</div>;
    }
  }
}
