/**
 * Agent factory — wraps LangChain 1.x's createAgent with our tools.
 *
 * createAgent is the new (1.x) high-level abstraction that replaces the old
 * StateGraph + ToolNode manual setup. It handles the full agent loop
 * (model invocation → tool dispatch → loop back to model) and exposes
 * middleware hooks (before_model / wrap_model_call / wrap_tool_call / after_model).
 *
 * NOTE on the explicit return type: we annotate the return as a generic
 * CompiledStateGraph<...> with `any` placeholders. Without this annotation,
 * TypeScript tries to inline the full inferred type from createAgent (which
 * drills into each tool's zod schema) into our emitted .d.ts. When running in
 * --noEmit mode (e.g. inside an IDE), TS can't resolve the deeply-nested zod
 * paths and reports TS2742 "type cannot be named without a reference to
 * packages/sandbox/node_modules/zod/index.cjs". The explicit annotation
 * cuts the inference chain at the function boundary.
 */
import { createAgent } from 'langchain';
import type { CompiledStateGraph } from '@langchain/langgraph';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { sandboxTools } from '@my-agent/sandbox';

export interface AgentFactoryOptions {
  llm: BaseChatModel;
  additionalTools?: StructuredToolInterface[];
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are MyAgent, a helpful personal AI assistant with access to sandboxed shell tools.

When the user asks you to inspect files, run commands, or fetch URLs:
1. Choose the most appropriate tool from those available.
2. If a tool fails or returns unexpected output, explain what happened and try a different approach.
3. Never attempt commands outside the whitelist — if you need a capability you don't have, tell the user.

When you don't need a tool, just answer directly and concisely.`;

/**
 * Compiled agent runtime. The concrete state/update/input/output types are
 * left as `any` because they derive from the tool schemas and are not useful
 * to consumers — they only need .invoke() / .stream() on the returned graph.
 */
export type CompiledAgent = CompiledStateGraph<any, any, any, any, any, any>;

/**
 * Create a compiled Agent using LangChain 1.x's createAgent.
 */
export function createAgentGraph({
  llm,
  additionalTools = [],
  systemPrompt,
}: AgentFactoryOptions): CompiledAgent {
  const tools = [...sandboxTools, ...additionalTools];

  // The cast is safe: createAgent returns a CompiledStateGraph; the generic
  // parameters we drop don't affect runtime behavior, only type-level details.
  return createAgent({
    model: llm,
    tools,
    systemPrompt: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  }) as unknown as CompiledAgent;
}