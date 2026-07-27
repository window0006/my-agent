/**
 * Memory Controller — HTTP handlers for memory management routes.
 */
import type { Context } from 'koa';
import { ResponseUtil, RetCode } from '@my-agent/shared';
import { ValidationError } from '../common/consts/errors';
import { memoryService } from '../service/memory';
import { getUserId } from '../common/auth';

class MemoryController {
  async list(ctx: Context) {
    const memories = await memoryService.listMemories(getUserId(ctx));
    ctx.body = ResponseUtil.success(memories);
  }

  async upsert(ctx: Context) {
    const body = (ctx.request.body as { key?: string; value?: string; importance?: number }) || {};
    if (!body.key || typeof body.key !== 'string') {
      throw new ValidationError('key is required');
    }
    if (!body.value || typeof body.value !== 'string') {
      throw new ValidationError('value is required');
    }
    const row = await memoryService.upsertMemory(body.key, body.value, {
      importance: body.importance,
      userId: getUserId(ctx),
    });
    ctx.body = ResponseUtil.success(row, 'Memory upserted');
  }

  async delete(ctx: Context) {
    const id = ctx.params.id;
    if (!id) throw new ValidationError('Memory id is required');
    const ok = await memoryService.deleteMemory(id, getUserId(ctx));
    if (!ok) {
      ctx.body = ResponseUtil.error(RetCode.RESOURCE_NOT_FOUND, 'Memory not found');
      return;
    }
    ctx.body = ResponseUtil.success({ id, deleted: true });
  }

  async listSummaries(ctx: Context) {
    const sessionId = ctx.params.sessionId;
    if (!sessionId) throw new ValidationError('Session id is required');
    const summaries = await memoryService.listSummaries(sessionId);
    ctx.body = ResponseUtil.success(summaries);
  }
}

export const memoryController = new MemoryController();