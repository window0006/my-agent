/**
 * Server config — load from env with sensible defaults.
 */
export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.SERVER_PORT) || 3000,
  host: process.env.SERVER_HOST || '0.0.0.0',
  llm: {
    apiKey: process.env.MINIMAX_API_KEY || '',
    baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1',
    model: process.env.MINIMAX_MODEL || 'abab6.5s-chat',
  },
  db: {
    url: process.env.DATABASE_URL || 'mysql://root:root@localhost:3306/my_agent',
  },
  sandbox: {
    workdir: process.env.SANDBOX_WORKDIR || './sandbox-workdir',
    timeoutMs: Number(process.env.SANDBOX_TIMEOUT_MS) || 30_000,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || './logs',
  },
};