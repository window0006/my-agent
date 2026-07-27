/**
 * Lightweight logger. Will be upgraded to pino/winston in v1.1.
 * For now: stderr-only with timestamp + level + requestId.
 */
import { config } from '../../config';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: Level): boolean {
  const configured = (config.logging.level as Level) || 'info';
  return LEVEL_RANK[level] >= LEVEL_RANK[configured];
}

function format(level: Level, msg: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}

export const logger = {
  debug(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('debug')) console.error(format('debug', msg, meta));
  },
  info(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('info')) console.error(format('info', msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('warn')) console.error(format('warn', msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('error')) console.error(format('error', msg, meta));
  },
};