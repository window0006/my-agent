/**
 * LLM provider — wraps MiniMax API in OpenAI-compatible ChatOpenAI client.
 *
 * MiniMax exposes an OpenAI-compatible endpoint at
 *   https://api.minimaxi.com/v1/chat/completions
 * We point ChatOpenAI's `baseURL` at the `/v1` root and use Bearer auth.
 *
 * MiniMax-specific quirks to be aware of:
 *   - Model name is `MiniMax-M3` (the `MiniMax-M3[1m]` alias in the
 *     provider's Anthropic env is rejected by the OpenAI endpoint).
 *   - Reasoning content is returned inline as `<think>...</think>` in the
 *     response content, NOT as a separate `reasoning_content` field like
 *     Anthropic does. The server splits this on `<think>` boundaries
 *     during streaming (see session.service M2 streamAgentTurn).
 *
 * IMPORTANT: `@langchain/openai` (and its openai SDK) is huge and takes
 * 60-120s to require on macOS + pnpm because of file-stat overhead on the
 * deeply nested node_modules. We lazy-load it on first call so the server
 * boots fast and mock provider usage is unaffected.
 */
export const llmProvider = {
  /**
   * Create a chat model instance pointed at MiniMax.
   * ChatOpenAI is only required when this method is called.
   */
  async createChatModel(options?: {
    temperature?: number;
    model?: string;
    maxTokens?: number;
    timeoutMs?: number;
  }) {
    const apiKey = process.env.MINIMAX_API_KEY;
    const baseURL = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1';
    const model = options?.model || process.env.MINIMAX_MODEL || 'MiniMax-M3';
    const timeoutMs =
      options?.timeoutMs ||
      Number(process.env.API_TIMEOUT_MS) ||
      5 * 60_000;

    if (!apiKey) {
      throw new Error(
        '[core-agent] MINIMAX_API_KEY is not set. Please configure .env.development.',
      );
    }

    const { ChatOpenAI } = await import('@langchain/openai');
    return new ChatOpenAI({
      apiKey,
      configuration: { baseURL, timeout: timeoutMs },
      model,
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens,
    });
  },
};
