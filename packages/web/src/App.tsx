import { useEffect } from 'react';
import { Layout, Button, Tooltip } from 'antd';
import { MenuOutlined, SettingOutlined } from '@ant-design/icons';
import { useChatStore } from './store/chat';
import { Sidebar } from './layout/Sidebar';
import { ChatArea } from './layout/ChatArea';
import { ControlPanel } from './layout/ControlPanel';

const { Header: AntHeader } = Layout;

export default function App() {
  const {
    sessions,
    activeSessionId,
    refreshSessions,
    toggleControlPanel,
    setMobileSidebarOpen,
  } = useChatStore();

  // Auto-select session from URL (?session=<id>) or first in list.
  useEffect(() => {
    refreshSessions().then(() => {
      const params = new URLSearchParams(window.location.search);
      const target = params.get('session');
      const sid =
        target && (useChatStore.getState().sessions.some((s) => s.id === target) ? target : null)
          ? target
          : null;
      if (sid) useChatStore.getState().selectSession(sid);
      // Demo helpers via URL hash: #sidebar / #panel
      const hash = window.location.hash;
      if (hash === '#sidebar') useChatStore.getState().setMobileSidebarOpen(true);
      if (hash === '#panel') useChatStore.getState().setMobilePanelOpen(true);
    });
  }, [refreshSessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <Layout style={{ height: '100vh' }}>
      <AntHeader
        style={{
          height: 56,
          padding: '0 16px',
          background: '#ffffff',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
        className="app-header"
      >
        <Tooltip title="会话列表">
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setMobileSidebarOpen(true)}
            className="mobile-only"
            style={{ fontSize: 18 }}
          />
        </Tooltip>

        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          M
        </div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>MyAgent</div>

        <div
          style={{
            flex: 1,
            textAlign: 'center',
            color: '#64748b',
            fontSize: 13,
          }}
        >
          {activeSession?.title ?? '未选择会话'}
        </div>

        <Tooltip title="控制面板">
          <Button
            type="text"
            icon={<SettingOutlined />}
            onClick={toggleControlPanel}
            className="desktop-only"
            style={{ fontSize: 18 }}
          />
        </Tooltip>
      </AntHeader>

      <Layout className="app-grid" style={{ flex: 1, minHeight: 0 }}>
        <Sidebar />
        <ChatArea />
        <ControlPanel />
      </Layout>
    </Layout>
  );
}