/**
 * Session Controller — HTTP handlers for session routes.
 */
import type { Context } from 'koa';
import { ResponseUtil, RetCode } from '@my-agent/shared';
import { ValidationError } from '../common/consts/errors';
import { sessionService } from '../service/session';
import { getUserId } from '../common/auth';
import { logger } from '../common/utils/logger';

class SessionController {
  async create(ctx: Context) {
    const body = (ctx.request.body as { title?: string }) || {};
    const session = await sessionService.createSession(body.title, getUserId(ctx));
    ctx.body = ResponseUtil.success(session, 'Session created');
  }

  async list(ctx: Context) {
    const sessions = await sessionService.listSessions(getUserId(ctx));
    ctx.body = ResponseUtil.success(sessions);
  }

  async get(ctx: Context) {
    const id = ctx.params.id;
    if (!id) throw new ValidationError('Session id is required');
    const session = await sessionService.getSession(id, getUserId(ctx));
    if (!session) {
      ctx.body = ResponseUtil.error(RetCode.RESOURCE_NOT_FOUND, 'Session not found');
      return;
    }
    ctx.body = ResponseUtil.success(session);
  }

  async run(ctx: Context) {
    const id = ctx.params.id;
    const body = (ctx.request.body as { message?: string }) || {};
    if (!id) throw new ValidationError('Session id is required');
    if (!body.message || typeof body.message !== 'string') {
      throw new ValidationError('message is required and must be a string');
    }
    const session = await sessionService.runAgentTurn(id, body.message, getUserId(ctx));
    ctx.body = ResponseUtil.success(session, 'Agent turn completed');
  }

  async delete(ctx: Context) {
    const id = ctx.params.id;
    if (!id) throw new ValidationError('Session id is required');
    const ok = await sessionService.deleteSession(id, getUserId(ctx));
    if (!ok) {
      ctx.body = ResponseUtil.error(RetCode.RESOURCE_NOT_FOUND, 'Session not found');
      return;
    }
    ctx.body = ResponseUtil.success({ id, deleted: true });
  }

  /**
   * SSE endpoint — streams the agent's reply as a series of `chunk` events.
   *
   * Wire format (text/event-stream):
   *   event: start
   *   data: {"sessionId":"...","role":"assistant"}
   *
   *   event: chunk
   *   data: {"content":"hello"}
   *
   *   ... more chunks ...
   *
   *   event: done
   *   data: {"sessionId":"...","totalChunks":N}
   */
  async runStream(ctx: Context) {
    const id = ctx.params.id;
    const body = (ctx.request.body as { message?: string }) || {};
    if (!id) throw new ValidationError('Session id is required');
    if (!body.message || typeof body.message !== 'string') {
      throw new ValidationError('message is required and must be a string');
    }

    const userId = getUserId(ctx);

    // Set SSE response headers. Note: Koa's body must be set BEFORE ctx.res is
    // used for streaming — otherwise Koa will try to JSON-serialize.
    ctx.status = 200;
    ctx.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    ctx.respond = false;
    ctx.res.flushHeaders?.();

    const writeEvent = (event: string, data: unknown) => {
      ctx.res.write(`event: ${event}\n`);
      ctx.res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const ev of sessionService.streamAgentTurn(id, body.message, userId)) {
        writeEvent(ev.event, ev.data);
      }
    } catch (err) {
      logger.error('SSE stream error', {
        sessionId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      writeEvent('error', {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      ctx.res.end();
    }
  }
}

/**
 * Extract userId from the request. v1: stub from header or default.
 * v4 (auth): replaced with JWT-decoded user.
 */

export const sessionController = new SessionController();