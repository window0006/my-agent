import { Input, Button, Tooltip } from 'antd';
import { ArrowUpOutlined } from '@ant-design/icons';
import { useState, useRef } from 'react';
import { useChatStore } from '../../store/chat';

export function InputBox() {
  const { activeSessionId, isStreaming, sendMessage } = useChatStore();
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const send = () => {
    if (!text.trim() || !activeSessionId || isStreaming) return;
    sendMessage(text);
    setText('');
    ref.current?.focus();
  };

  const disabled = !activeSessionId;

  return (
    <div className="input-shell">
      <div className="input-wrap">
        <div className="input-card">
          <Input.TextArea
            ref={ref}
            autoSize={{ minRows: 4, maxRows: 16 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={disabled ? '请先选择一个会话…' : '输入消息，回车发送，Shift+回车换行'}
            disabled={disabled}
            variant="borderless"
          />
          <Tooltip title="发送">
            <Button
              type="primary"
              shape="circle"
              size="large"
              icon={<ArrowUpOutlined />}
              onClick={send}
              disabled={disabled || !text.trim() || isStreaming}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}