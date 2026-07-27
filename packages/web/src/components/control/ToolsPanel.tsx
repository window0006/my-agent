import { Tag } from 'antd';
import { CodeOutlined, ReadOutlined, FolderOpenOutlined } from '@ant-design/icons';

const TOOLS = [
  { name: 'run_shell', desc: '在沙箱中执行白名单命令', icon: <CodeOutlined />, status: 'available' },
  { name: 'read_file', desc: '读取沙箱文件内容', icon: <ReadOutlined />, status: 'available' },
  { name: 'list_directory', desc: '列出沙箱目录', icon: <FolderOpenOutlined />, status: 'available' },
];

export function ToolsPanel() {
  return (
    <div>
      <div style={{ marginBottom: 12, color: '#64748b', fontSize: 12, lineHeight: 1.55 }}>
        Agent 可用的工具。所有工具在沙箱内执行，仅允许白名单命令。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {TOOLS.map((t) => (
          <div
            key={t.name}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: 12,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <div style={{ color: '#3b82f6', fontSize: 18, marginTop: 1 }}>{t.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{t.name}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{t.desc}</div>
            </div>
            <Tag color="green">{t.status}</Tag>
          </div>
        ))}
      </div>
    </div>
  );
}