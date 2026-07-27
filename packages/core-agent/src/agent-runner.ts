/**
 * AgentRunner — high-level facade for invoking the Agent.
 *
 * Wraps createAgent with a clean run() API. The "graph" concept from LangGraph
 * is no longer needed at this level since createAgent already handles the loop.
 *
 * The `run` return type is explicitly CompiledAgent.invoke's return shape
 * (a generic state object) so consumers don't need to reason about LangChain's
 * deeply-parameterized message types.
 */
import type { BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { createAgentGraph, type CompiledAgent } from './agent-graph';
import { llmProvider } from './llm-provider';

export interface AgentRunnerOptions {
  temperature?: number;
  model?: string;
  maxIterations?: number;
  systemPrompt?: string;
  additionalTools?: StructuredToolInterface[];
  /**
   * Inject a pre-built chat model. When provided, llmProvider is bypassed.
   * Useful for tests, mocks, or swapping providers without touching this class.
   */
  llm?: BaseChatModel;
}

/**
 * Loose shape of the agent state returned by invoke().
 * Concrete message type varies by node; consumers should narrow before use.
 */
export interface AgentRunResult {
  messages?: BaseMessage[];
  [key: string]: unknown;
}

/**
 * Single stream event. `streamMode: 'messages'` emits `[messageChunk, metadata]`
 * pairs for every message-producing step — AIMessageChunk from the model
 * (with content + tool_call_chunks), and full ToolMessage from the tool node.
 */
export type AgentStreamEvent = [BaseMessage, Record<string, unknown>];

export class AgentRunner {
  private options: AgentRunnerOptions;
  private agent: CompiledAgent | null = null;

  constructor(options: AgentRunnerOptions = {}) {
    this.options = options;
  }

  private async ensureAgent(): Promise<CompiledAgent> {
    if (this.agent) return this.agent;

    const llm =
      this.options.llm ??
      (await llmProvider.createChatModel({
        temperature: this.options.temperature,
        model: this.options.model,
      }));

    this.agent = createAgentGraph({
      llm,
      additionalTools: this.options.additionalTools,
      systemPrompt: this.options.systemPrompt,
    });
    return this.agent;
  }

  /**
   * Run a single conversation turn with the given message history.
   * Messages can be either LangChain BaseMessage instances or plain
   * `{ role, content }` objects — both are accepted by createAgent.invoke().
   */
  async run(
    messages: Array<BaseMessage | { role: string; content: string }>,
  ): Promise<AgentRunResult> {
    const agent = await this.ensureAgent();
    // Cast: createAgent.invoke() returns a fully-parameterized state type
    // that we don't want to expose through this facade.
    return (await agent.invoke({ messages })) as AgentRunResult;
  }

  /**
   * Stream a turn as LangChain message chunks. Yields `[chunk, metadata]`
   * tuples; chunk's `content` is the *delta* text (not cumulative).
   *
   * Note: `agent.stream()` is itself async (returns a Promise of an async
   * iterator), so callers must `for await (const ev of await runner.stream(...))`
   * — we resolve it once inside this method and yield from the resulting iterator.
   */
  async *stream(
    messages: Array<BaseMessage | { role: string; content: string }>,
  ): AsyncGenerator<AgentStreamEvent> {
    const agent = await this.ensureAgent();
    const iter = await agent.stream(
      { messages } as Parameters<typeof agent.stream>[0],
      { streamMode: 'messages' } as Parameters<typeof agent.stream>[1],
    );
    for await (const ev of iter as AsyncIterable<AgentStreamEvent>) {
      yield ev;
    }
  }
}