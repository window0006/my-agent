import { useState } from 'react';
import { BulbOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';

export function ThinkingCard({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(true);
  if (!text.trim()) return null;
  return (
    <div
      className={
        'embedded-card thinking-card' + (streaming ? ' embedded-card--streaming' : '')
      }
      style={{ background: '#fafafa' }}
    >
      <div
        className="embedded-card-title"
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <BulbOutlined style={{ color: '#a78bfa' }} />
        <span style={{ color: '#7c3aed' }}>Reasoning</span>
        <span
          style={{
            color: '#cbd5e1',
            fontWeight: 400,
            marginLeft: 'auto',
          }}
        >
          {open ? <DownOutlined /> : <RightOutlined />}
        </span>
      </div>
      {open && (
        <div
          className="embedded-card-body"
          style={{
            background: '#f5f3ff',
            padding: '8px 10px',
            borderRadius: 6,
            fontStyle: 'italic',
            color: '#6d28d9',
            fontFamily: 'inherit',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
