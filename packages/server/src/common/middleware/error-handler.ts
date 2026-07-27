/**
 * Global error-handler middleware.
 * Catches errors, logs with requestId, returns unified ApiErrorResponse.
 */
import type { Context, Next } from 'koa';
import { RetCode } from '@my-agent/shared';
import { ResponseUtil } from '@my-agent/shared';
import { logger } from '../utils/logger';
import { BusinessError, HttpError, ValidationError, AgentError } from '../consts/errors';

export function errorHandler() {
  return async (ctx: Context, next: Next) => {
    try {
      await next();
    } catch (err: unknown) {
      const requestId = ctx.state.requestId;
      const error = err as Error & { status?: number; code?: string; details?: unknown };

      // Map known error types to RetCode
      let retcode = RetCode.INTERNAL_SERVER_ERROR;
      let message = 'Internal server error';
      let status = 500;
      let details: unknown = undefined;

      if (error instanceof ValidationError) {
        retcode = RetCode.VALIDATION_ERROR;
        message = error.message;
        status = error.status || 422;
        details = error.details;
      } else if (error instanceof BusinessError) {
        retcode = RetCode.UNKNOWN_ERROR;
        message = error.message;
        status = error.status || 400;
        details = error.details;
      } else if (error instanceof HttpError) {
        retcode = RetCode.UNKNOWN_ERROR;
        message = error.message;
        status = error.status;
        details = error.details;
      } else if (error instanceof AgentError) {
        retcode = RetCode.AGENT_LLM_ERROR;
        message = error.message;
        status = error.status || 500;
        details = error.details;
      } else if (error instanceof Error) {
        message = error.message || message;
        // Don't leak internals in production
        details = process.env.NODE_ENV !== 'production' ? error.stack : undefined;
      }

      logger.error('Request failed', {
        requestId,
        path: ctx.path,
        method: ctx.method,
        status,
        message: error.message,
        stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      });

      ctx.status = status;
      ctx.body = ResponseUtil.error(retcode, message, details);
    }
  };
}