import { Input, Button, Empty, Dropdown, message as antdMessage } from 'antd';
import { SearchOutlined, PlusOutlined, MoreOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useChatStore } from '../../store/chat';

export function SessionList() {
  const {
    sessions,
    activeSessionId,
    loading,
    selectSession,
    createSession,
    deleteSession,
    setMobileSidebarOpen,
  } = useChatStore();
  const [query, setQuery] = useState('');

  const filtered = sessions.filter((s) =>
    s.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: 12,
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
          placeholder="搜索会话"
          size="middle"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          type="text"
          icon={<PlusOutlined />}
          onClick={async () => {
            const s = await createSession();
            setMobileSidebarOpen(false);
          }}
        />
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && <div style={{ padding: 16, color: '#94a3b8' }}>加载中…</div>}
        {!loading && filtered.length === 0 && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无会话"
            style={{ marginTop: 60 }}
          />
        )}
        {filtered.map((s) => {
          const active = s.id === activeSessionId;
          return (
            <div
              key={s.id}
              onClick={async () => {
                await selectSession(s.id);
                setMobileSidebarOpen(false);
              }}
              style={{
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                background: active ? '#eff6ff' : 'transparent',
                borderLeft: active ? '3px solid #3b82f6' : '3px solid transparent',
                transition: 'background 0.15s',
              }}
            >
              <span style={{ flex: 1, fontSize: 14, color: '#0f172a' }}>{s.title}</span>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'delete',
                      label: '删除',
                      danger: true,
                      onClick: ({ domEvent }) => {
                        domEvent.stopPropagation();
                        void antdMessage.loading({ content: '删除中…', duration: 0 });
                        deleteSession(s.id)
                          .then(() => antdMessage.destroy())
                          .catch((e) => antdMessage.error(e.message));
                      },
                    },
                  ],
                }}
                trigger={['click']}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<MoreOutlined />}
                  onClick={(e) => e.stopPropagation()}
                />
              </Dropdown>
            </div>
          );
        })}
      </div>
    </div>
  );
}