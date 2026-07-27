/**
 * MockChatModel — a fake BaseChatModel implementation for development.
 *
 * Used when `LLM_PROVIDER=mock` is set. Mimics an LLM by:
 *   1. Echoing back the user's message in a friendly wrapper
 *   2. Yielding the reply as a stream of chunks (with small delays) so the
 *      agent harness can exercise its streaming path end-to-end
 *   3. Recognizing a few keywords to produce more interesting responses
 *
 * IMPORTANT: This is a development-only stub. It implements just enough of
 * LangChain's BaseChatModel contract for createAgent + tool calling to work.
 * Replace with a real provider once you have an API key.
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import type { ChatGeneration, ChatResult } from '@langchain/core/outputs';

/**
 * Configurable knobs for the mock.
 */
export interface MockChatModelOptions {
  /** Per-chunk delay in ms — simulates network/processing latency. */
  chunkDelayMs?: number;
  /** Words per chunk — controls how granular streaming looks. */
  wordsPerChunk?: number;
}

/**
 * Built-in canned responses for common prompts. The mock pattern-matches the
 * last user message and produces one of these; otherwise it echoes.
 */
function chooseReply(userText: string): string {
  const text = userText.toLowerCase().trim();

  if (/^(hi|hello|hey|你好|嗨)\b/.test(text)) {
    return `你好！我是 MyAgent 的 mock LLM。当前我没有接真实的 API key，但 Agent Loop、Tool 调用、流式响应这些链路都能跑通。要试一个 shell 命令可以这样问我：「帮我看一下当前目录有哪些文件」。`;
  }

  if (/tool|shell|command|ls|cat|grep/i.test(text)) {
    return `我可以调用 sandboxed shell 工具（run_shell / list_directory / read_file），但所有命令必须命中白名单。比如你可以让我「列出 /Users/windowyang/Desktop 下的目录」试试。`;
  }

  if (/who are you|what are you|你是谁|介绍/i.test(text)) {
    return `我是 MyAgent 的 mock 模型，仅用于本地开发调试。生产环境请把 LLM_PROVIDER 改成 minimax / openai / deepseek 等真实 provider。`;
  }

  // Default: echo with a friendly wrapper.
  return `我收到了你的消息：「${userText}」。Mock LLM 当前不做推理，只是把消息 echo 回来确认链路通了。`;
}

/**
 * Split a string into word-sized chunks for streaming.
 */
function chunkText(text: string, wordsPerChunk: number): string[] {
  const words = text.split(/(\s+)/); // keep whitespace as separate tokens
  const chunks: string[] = [];
  let buffer = '';
  let wordCount = 0;
  for (const token of words) {
    buffer += token;
    if (/\S/.test(token)) wordCount++;
    if (wordCount >= wordsPerChunk) {
      chunks.push(buffer);
      buffer = '';
      wordCount = 0;
    }
  }
  if (buffer.length > 0) chunks.push(buffer);
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastUserText(messages: BaseMessage[]): string {
  // Walk in reverse to find the most recent human turn.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg instanceof HumanMessage) {
      const content = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
      return content;
    }
  }
  return '';
}

export class MockChatModel extends BaseChatModel {
  lc_namespace = ['langchain', 'mock'];

  private chunkDelayMs: number;
  private wordsPerChunk: number;

  constructor(options: MockChatModelOptions = {}) {
    super({});
    this.chunkDelayMs = options.chunkDelayMs ?? 40;
    this.wordsPerChunk = options.wordsPerChunk ?? 2;
  }

  /**
   * Required by BaseChatModel.
   */
  override _llmType(): string {
    return 'mock';
  }

  /**
   * Non-streaming path. Returns the full reply in one shot.
   */
  async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const text = chooseReply(lastUserText(messages));
    const message = new AIMessage(text);
    return {
      generations: [
        {
          text,
          message,
        } as ChatGeneration,
      ],
      llmOutput: {},
    };
  }

  /**
   * Streaming path. Yields the reply as word-sized chunks with small delays.
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const text = chooseReply(lastUserText(messages));
    const chunks = chunkText(text, this.wordsPerChunk);

    for (const piece of chunks) {
      if (this.chunkDelayMs > 0) await delay(this.chunkDelayMs);
      yield new ChatGenerationChunk({
        message: new AIMessageChunk({ content: piece }),
        text: piece,
      });
    }
  }

  /**
   * Used by LangChain to tag requests (e.g. for LangSmith tracing).
   */
  override invocationParams(_options?: this['ParsedCallOptions']): Record<string, unknown> {
    return {
      provider: 'mock',
      chunkDelayMs: this.chunkDelayMs,
      wordsPerChunk: this.wordsPerChunk,
    };
  }

  /**
   * createAgent calls bindTools() before passing the LLM to the agent graph.
   * For the mock, tool calls are unsupported — return a shallow copy with
   * the same configuration. If a real call would have invoked a tool,
   * the mock will just echo a "tool_calls" hint in its reply.
   */
  override bindTools(tools: unknown[]): MockChatModel {
    void tools;
    return new MockChatModel({
      chunkDelayMs: this.chunkDelayMs,
      wordsPerChunk: this.wordsPerChunk,
    });
  }
}