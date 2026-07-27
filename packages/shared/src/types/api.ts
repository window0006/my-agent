/**
 * Standard API response envelope.
 */
export interface ApiSuccessResponse<T = unknown> {
  retcode: number; // RetCode.SUCCESS
  data?: T;
  message?: string;
}

export interface ApiErrorResponse {
  retcode: number;
  message: string;
  details?: unknown;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;