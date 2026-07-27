import { useEffect } from 'react';
import { Button, Empty, List, Popconfirm, Tag, message as antdMessage } from 'antd';
import { DeleteOutlined, FireOutlined } from '@ant-design/icons';
import { useChatStore } from '../../store/chat';

export function MemoryPanel() {
  const { memories, refreshMemories, deleteMemory } = useChatStore();

  useEffect(() => {
    refreshMemories();
  }, [refreshMemories]);

  return (
    <div>
      <div style={{ marginBottom: 12, color: '#64748b', fontSize: 12, lineHeight: 1.55 }}>
        长期记忆由 Agent 在对话过程中自动提取与维护。
      </div>

      <List
        size="small"
        dataSource={memories}
        locale={{ emptyText: <Empty description="暂无记忆" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        renderItem={(m) => (
          <List.Item
            style={{ padding: '10px 0', borderBlockEnd: '1px solid #f1f5f9' }}
            actions={[
              <Popconfirm
                key="del"
                title="确认删除？"
                onConfirm={() => deleteMemory(m.id).catch((e) => antdMessage.error(e.message))}
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>,
            ]}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <code style={{ fontSize: 12, color: '#0369a1' }}>{m.keyName}</code>
                {m.importance >= 4 && (
                  <Tag color="orange" icon={<FireOutlined />} style={{ marginLeft: 0 }}>
                    重要
                  </Tag>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, wordBreak: 'break-word' }}>
                {m.value}
              </div>
            </div>
          </List.Item>
        )}
      />
    </div>
  );
}