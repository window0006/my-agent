/**
 * Core Agent — pure logic layer built on LangChain 1.x's createAgent.
 * No HTTP framework dependencies. Importable by server, tests, scripts.
 */
export { AgentRunner } from './agent-runner';
export type { AgentRunnerOptions, AgentRunResult } from './agent-runner';
export { createAgentGraph } from './agent-graph';
export type { AgentFactoryOptions, CompiledAgent } from './agent-graph';
export { llmProvider } from './llm-provider';
export type { BaseChatModel } from '@langchain/core/language_models/chat_models';