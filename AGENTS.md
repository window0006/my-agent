# MyAgent — AGENTS.md

> **Inherits from**:
> - [`.agents/SOUL.md`](./.agents/SOUL.md) — full development philosophy
>   (9 principles, two-checkpoint workflow, break clause). This is the
>   project's own charter; clone the repo and you ship with it.
> - [`~/.agents/AGENTS.md`](file:///Users/windowyang/.agents/AGENTS.md) —
>   operational guide and project AGENTS.md contract (global template).
>
> Read both before any non-trivial task. This file only adds
> project-specific context; the principles live in `.agents/SOUL.md`.

---

## What this project is

A personal Agent platform built for end-to-end learning. Server (Koa +
MySQL) + web UI (React + AntD) + shared types. The point is to *learn
Agent development* by building a real system, not to ship a product.
Production hygiene applies (FK CASCADE, no codec shims, structured SSE)
because clean code is the only way to keep a learning project readable
across long iterations.

---

## Tech stack (and why)

- **Node 22 + pnpm workspaces + TypeScript strict** — monorepo for
  shared types between server and web. Strict mode is non-negotiable;
  it surfaces the kind of subtle bugs that ruin Agent state machines.
- **Koa + Drizzle ORM + MySQL 8** — minimal HTTP layer, type-safe SQL,
  familiar RDBMS. Chose MySQL over Postgres because no vector-search
  need yet (RAG is v3); MySQL keeps the data layer boring.
- **LangChain 1.x + LangGraph 1.4** — `createAgent()` is the entry
  point. Internal `BaseMessage` + LangChain 1.2 v1 `ContentBlock[]` is
  the wire format for messages end-to-end.
- **Vite + React + AntD + AntV** — fast dev loop, opinionated UI
  components. AntV reserved for memory graph viz (later).
- **esbuild single-file bundle for server** — `pnpm + macOS` file-stat
  is slow; bundled server cold-starts in 5s vs 100s+. `tools/build-bundle.cjs`.

---

## Conventions specific to this codebase

1. **No codec layers**. `@my-agent/shared` defines `ContentBlock[]`,
   `Message`, `ToolCall`, `TokenUsage`. Server stores as JSON column,
   frontend consumes directly. If a transform is needed, put it in
   `shared`, not in a server-side adapter.
2. **Sandbox is the only execution surface**. New tools go in
   `packages/sandbox/`, never inline. Whitelist shell (v1) → upgrade
   to Daytona (v4). The sandbox is what makes "Agent can run shell"
   safe to expose.
3. **Memory lives in the DB, not in agent state**.
   - Long-term: `memories` table (LLM-extracted, `importance` ranked)
   - Mid-term: `session_summaries` table (auto-folded when message
     count > 30)
   - Injected as a `SystemMessage2` prefix on every turn
4. **SSE events are structured**. Five types: `thinking_delta`,
   `text_delta`, `tool_call`, `tool_result`, `done` (plus `error`).
   Frontend consumes events, not string parsing — the markdown-tag
   hack is gone.
5. **Mock LLM for dev**. `MockChatModel` (in `packages/server/src/llm/`)
   lets the whole stack run without an API key. Switch to real
   provider via `LLM_PROVIDER=minimax` env + real key.

---

## Workflow

Inherit the two-checkpoint workflow and break clause from SOUL.md. No
project-specific overrides — the global defaults fit this codebase.

Build scripts (e.g. `tools/build-bundle.cjs`) and tests
(`tools/integration-test.ts`) live in `tools/`, not in any package.
