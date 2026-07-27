# MyAgent

个人学习项目：从基础 Agent 内核起步，逐步接入 MCP、Skill、知识库（RAG）与沙箱。

## 当前进度

- ✅ **v0**：monorepo 骨架（pnpm workspaces + TypeScript + Node 22）
- ✅ **v1**：基础 Agent 内核（LangChain 1.x `createAgent` + LangGraph 1.4 + 白名单 shell 沙箱）
- ✅ **v1**：会话管理 + 记忆管理（MySQL + Drizzle ORM + FK CASCADE）
  - 长期记忆：LLM 提取用户偏好/事实，按 `importance` 排序注入
  - 中短期摘要：消息数 > 30 时自动 fold 早期消息
- ✅ **v1**：SSE 流式响应（结构化事件：thinking / tool_call / tool_result / text_delta）
- ✅ **v1**：前端聊天界面（Vite + React + AntD + AntV，支持 PC / 移动端）
- 🚧 **v2**：MCP 接入 / Skill 系统
- 🚧 **v3**：知识库 + RAG
- 🚧 **v4**：沙箱安全升级（Daytona 或自建容器）

## 项目结构

```
MyAgent/
├── packages/
│   ├── core-agent/     # Agent 内核（LangGraph Agent Loop + MockChatModel）
│   ├── server/         # 后端 API 服务（Koa + TS + Drizzle + MySQL）
│   ├── web/            # 前端聊天界面（Vite + React + AntD + AntV）
│   ├── sandbox/        # 沙箱执行模块（白名单 shell + 1MB 输出截断）
│   └── shared/         # 共享类型（LangChain 1.2 v1 ContentBlock 协议）
├── tools/              # 工具脚本
├── .env.example        # 环境变量示例
├── pnpm-workspace.yaml # monorepo 配置
├── docker-compose.yml  # 一键起 MySQL
└── tsconfig.base.json  # 共享 TS 配置
```

## 技术栈

- **语言**：TypeScript
- **运行时**：Node.js >= 20
- **包管理**：pnpm workspaces
- **后端**：Koa + Drizzle ORM + MySQL 8
- **Agent 内核**：LangChain 1.5 + LangGraph 1.4
- **LLM**：MiniMax API（OpenAI 兼容 /v1/chat/completions）
- **前端**：Vite + React + AntD + AntV
- **流式**：Server-Sent Events (SSE)

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 启动 MySQL
docker compose up -d

# 3. 配置环境变量
cp .env.example packages/server/.env.development
# 编辑 packages/server/.env.development 填入你的 LLM_PROVIDER / API Key

# 4. 启动后端
cd packages/server
node --env-file=.env.development dist/bundle.cjs
# → http://localhost:3000/api/health

# 5. 启动前端
cd packages/web
pnpm dev
# → http://localhost:5173
```

## 消息格式（LangChain 1.2 v1 标准）

前后端共享 `@my-agent/shared` 的 `ContentBlock[]` 协议，零 codec 转换：

```ts
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; reasoning: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; callId: string }
  | { type: 'image'; url?: string; base64?: string; mediaType?: string };
```

DB 直接以 JSON 列存 `ContentBlock[]`（`messages.content` 字段），前端直接消费。

## 沙箱安全

当前为白名单 shell 方案（v1.0）：
- ✅ 白名单命令（`ls` / `cat` / `grep` / `jq` / `curl` 等）
- ✅ 1MB 输出上限（超出立即 `SIGKILL`）
- ✅ 30s 超时
- ✅ 进程级隔离
- 🚧 后续升级到 Daytona（容器级，90ms 启动）

## 开发路线

- [x] v0: monorepo 初始化
- [x] v1: 基础 Agent 内核
- [x] v1: 会话管理 + 记忆管理持久化
- [x] v1: SSE 流式响应
- [x] v1: 前端聊天界面 MVP
- [x] v1: ContentBlock v1 协议升级（前后端零转换）
- [ ] v2: MCP 接入
- [ ] v2: Skill 系统
- [ ] v3: 知识库 + RAG
- [ ] v4: 沙箱安全升级
