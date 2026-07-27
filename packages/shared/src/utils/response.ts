/**
 * Response helper utilities.
 */
import { RetCode } from '../constants/retcode';
import type { ApiSuccessResponse, ApiErrorResponse } from '../types/api';

export const ResponseUtil = {
  success<T>(data?: T, message?: string): ApiSuccessResponse<T> {
    return {
      retcode: RetCode.SUCCESS,
      data,
      message,
    };
  },

  error(
    retcode: RetCode,
    message: string,
    details?: unknown,
  ): ApiErrorResponse {
    return {
      retcode,
      message,
      details,
    };
  },
};