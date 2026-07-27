import { useState } from 'react';
import {
  CodeOutlined,
  DownOutlined,
  RightOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
} from '@ant-design/icons';
import type { ToolResultBlock } from '../../api/client';
import { extractText } from '../../api/client';

interface Props {
  name: string;
  args: Record<string, unknown>;
  /** Matching tool_result block from the same turn, if it has arrived. */
  result?: ToolResultBlock;
}

/**
 * Renders a tool_call block. If a matching tool_result is supplied, shows
 * its content under the args; otherwise renders a pending spinner.
 */
export function ToolCallCard({ name, args, result }: Props) {
  const [open, setOpen] = useState(true);
  const argsJson = JSON.stringify(args, null, 2);
  const resultText = result ? extractTextFromBlock(result) : undefined;
  const isError = result?.isError === true;
  const isPending = !result;

  return (
    <div className="embedded-card" style={{ background: '#f8fafc' }}>
      <div
        className="embedded-card-title"
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <CodeOutlined style={{ color: '#0ea5e9' }} />
        <span style={{ color: '#0369a1' }}>{name}</span>
        {isPending && (
          <LoadingOutlined style={{ color: '#94a3b8', marginLeft: 4 }} />
        )}
        {!isPending && !isError && (
          <CheckCircleFilled style={{ color: '#10b981', marginLeft: 4 }} />
        )}
        {isError && (
          <CloseCircleFilled style={{ color: '#ef4444', marginLeft: 4 }} />
        )}
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
        <div className="embedded-card-body" style={{ display: 'grid', gap: 8 }}>
          <pre
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '8px 10px',
              margin: 0,
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 12,
              color: '#1e293b',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowX: 'auto',
            }}
          >
            {argsJson}
          </pre>
          {resultText !== undefined && (
            <pre
              style={{
                background: isError ? '#fef2f2' : '#f0fdf4',
                border: `1px solid ${isError ? '#fecaca' : '#bbf7d0'}`,
                borderRadius: 6,
                padding: '8px 10px',
                margin: 0,
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: 12,
                color: isError ? '#991b1b' : '#166534',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowX: 'auto',
                maxHeight: 320,
              }}
            >
              {resultText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function extractTextFromBlock(block: ToolResultBlock): string {
  if (typeof block.content === 'string') return block.content;
  return extractText(block.content);
}
