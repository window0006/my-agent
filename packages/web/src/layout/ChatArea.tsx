import { useChatStore } from '../store/chat';
import { MessageStream } from '../components/chat/MessageStream';
import { InputBox } from '../components/chat/InputBox';

export function ChatArea() {
  const { activeSessionId, streamingBlocks, isStreaming, messages, stopStreaming } =
    useChatStore();

  return (
    <main className="chat-pane">
      <div className="chat-scroll">
        {activeSessionId ? (
          <MessageStream
            messages={messages}
            streamingBlocks={streamingBlocks}
            isStreaming={isStreaming}
          />
        ) : (
          <EmptyState />
        )}
      </div>
      <InputBox />
      {isStreaming && (
        <div style={{ textAlign: 'center', marginTop: -8, marginBottom: 8 }}>
          <a onClick={stopStreaming} style={{ color: '#94a3b8', fontSize: 12 }}>
            停止生成
          </a>
        </div>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#94a3b8',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 56, marginBottom: 16, opacity: 0.4 }}>💬</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
        开始一个新会话
      </div>
      <div style={{ maxWidth: 360, lineHeight: 1.55 }}>
        选择左侧已有会话，或者点击右上角"新建会话"开始与 MyAgent 协作。
      </div>
    </div>
  );
}