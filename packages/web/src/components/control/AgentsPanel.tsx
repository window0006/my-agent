import { Avatar } from 'antd';
import { RobotOutlined, CodeOutlined, SearchOutlined, EditOutlined } from '@ant-design/icons';

const AGENTS = [
  { name: 'Orchestrator', desc: '主控 Agent，分派任务', color: '#3b82f6', icon: <RobotOutlined /> },
  { name: 'Coder', desc: '代码编写与重构', color: '#10b981', icon: <CodeOutlined /> },
  { name: 'Researcher', desc: '信息检索与分析', color: '#8b5cf6', icon: <SearchOutlined /> },
  { name: 'Reviewer', desc: '代码评审与改进', color: '#f59e0b', icon: <EditOutlined /> },
];

export function AgentsPanel() {
  return (
    <div>
      <div style={{ marginBottom: 12, color: '#64748b', fontSize: 12, lineHeight: 1.55 }}>
        多 Agent 协作成员。当前版本为简化展示。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {AGENTS.map((a) => (
          <div
            key={a.name}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Avatar size={36} icon={a.icon} style={{ background: a.color, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{a.name}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{a.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}