/**
 * Custom error types — aligned with reference project.
 */

export interface BaseError extends Error {
  code?: string;
  status?: number;
  details?: unknown;
}

export class HttpError extends Error implements BaseError {
  code = 'HTTP_ERROR';
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export class BusinessError extends Error implements BaseError {
  code = 'BUSINESS_ERROR';
  status = 400;
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'BusinessError';
    this.details = details;
  }
}

export class ValidationError extends Error implements BaseError {
  code = 'VALIDATION_ERROR';
  status = 422;
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class AgentError extends Error implements BaseError {
  code = 'AGENT_ERROR';
  status = 500;
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'AgentError';
    this.details = details;
  }
}