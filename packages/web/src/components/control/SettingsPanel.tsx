import { Form, Select, Input, Switch, Tag } from 'antd';
import { ApiOutlined } from '@ant-design/icons';

export function SettingsPanel() {
  return (
    <Form layout="vertical" size="small">
      <Form.Item label="模型提供方">
        <Select
          defaultValue="mock"
          options={[
            { value: 'mock', label: 'Mock (开发)' },
            { value: 'minimax', label: 'MiniMax' },
            { value: 'openai', label: 'OpenAI 兼容' },
          ]}
        />
      </Form.Item>
      <Form.Item label="模型">
        <Select
          defaultValue="mock-large"
          options={[
            { value: 'mock-large', label: 'mock-large' },
            { value: 'minimax-m2', label: 'minimax-M2' },
            { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
          ]}
        />
      </Form.Item>
      <Form.Item label="Temperature">
        <Input type="number" defaultValue={0.7} step={0.1} min={0} max={2} />
      </Form.Item>
      <Form.Item label="流式响应">
        <Switch defaultChecked />
      </Form.Item>
      <div
        style={{
          marginTop: 16,
          padding: 10,
          background: '#f8fafc',
          borderRadius: 8,
          fontSize: 12,
          color: '#64748b',
          lineHeight: 1.55,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <ApiOutlined /> API 状态
        </div>
        <Tag color="green">connected</Tag>
        <span style={{ marginLeft: 6 }}>localhost:3001</span>
      </div>
    </Form>
  );
}