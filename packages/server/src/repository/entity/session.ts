/**
 * Session entity — represents an Agent conversation session.
 * v1: in-memory only. Will be persisted to DB in v1.1.
 */
export interface SessionEntity {
  id: string;
  title: string;
  messages: import('@my-agent/shared').Message[];
  createdAt: number;
  updatedAt: number;
}