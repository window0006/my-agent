import { Drawer, Button, Tooltip } from 'antd';
import { MobileOutlined } from '@ant-design/icons';
import { useChatStore } from '../store/chat';
import { MemoryPanel } from '../components/control/MemoryPanel';
import { ToolsPanel } from '../components/control/ToolsPanel';
import { AgentsPanel } from '../components/control/AgentsPanel';
import { SettingsPanel } from '../components/control/SettingsPanel';
import { useState } from 'react';

type Tab = 'memory' | 'tools' | 'agents' | 'settings';

export function ControlPanel() {
  const { controlPanelOpen, mobilePanelOpen, setMobilePanelOpen } = useChatStore();
  const [tab, setTab] = useState<Tab>('memory');

  const body = (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Tabs current={tab} onChange={setTab} />
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {tab === 'memory' && <MemoryPanel />}
        {tab === 'tools' && <ToolsPanel />}
        {tab === 'agents' && <AgentsPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </div>
      <div className="mobile-only" style={{ padding: 12, borderTop: '1px solid #f1f5f9' }}>
        <Tooltip title="关闭控制面板">
          <Button block icon={<MobileOutlined />} onClick={() => setMobilePanelOpen(false)}>
            收起
          </Button>
        </Tooltip>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent */}
      <aside className="desktop-only control-pane">{body}</aside>

      {/* Mobile drawer */}
      <Drawer
        title="控制面板"
        placement="right"
        open={mobilePanelOpen}
        onClose={() => setMobilePanelOpen(false)}
        width={320}
        styles={{ body: { padding: 0 } }}
      >
        {body}
      </Drawer>
    </>
  );
}

function Tabs({ current, onChange }: { current: Tab; onChange: (t: Tab) => void }) {
  const items: { key: Tab; label: string }[] = [
    { key: 'memory', label: '记忆' },
    { key: 'tools', label: '工具' },
    { key: 'agents', label: 'Agent' },
    { key: 'settings', label: '设置' },
  ];
  return (
    <div
      style={{
        display: 'flex',
        borderBottom: '1px solid #f1f5f9',
        padding: '0 8px',
        gap: 4,
      }}
    >
      {items.map((it) => {
        const active = current === it.key;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            style={{
              flex: 1,
              padding: '12px 8px',
              background: 'transparent',
              border: 'none',
              borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
              color: active ? '#3b82f6' : '#64748b',
              fontWeight: active ? 600 : 500,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}