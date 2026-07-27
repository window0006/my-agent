/**
 * Extract userId from a Koa request. v1: header or default. v4 (auth):
 * swap to a JWT-decoded user.
 */
import type { Context } from 'koa';
import { DEFAULT_USER } from '../repository/dao/session';

export function getUserId(ctx: Context): string {
  const headerId = ctx.headers['x-user-id'];
  if (typeof headerId === 'string' && headerId.length > 0) return headerId;
  return DEFAULT_USER;
}
