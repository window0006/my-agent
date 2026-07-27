/**
 * Request-ID middleware — assigns a UUID to each request and propagates it to logs/responses.
 */
import type { Context, Next } from 'koa';
import { v4 as uuidv4 } from 'uuid';

export function requestId() {
  return async (ctx: Context, next: Next) => {
    const id = (ctx.headers['x-request-id'] as string) || uuidv4();
    ctx.state.requestId = id;
    ctx.set('X-Request-Id', id);
    await next();
  };
}