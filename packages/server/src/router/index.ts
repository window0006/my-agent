/**
 * Router registry — composes all sub-routers onto the Koa app.
 */
import type Koa from 'koa';
import { healthRouter } from './health';
import { sessionRouter } from './session';
import { memoryRouter, summaryRouter } from './memory';

export function registerRouters(app: Koa) {
  const routers = [healthRouter, sessionRouter, memoryRouter, summaryRouter];
  for (const r of routers) {
    app.use(r.routes()).use(r.allowedMethods());
  }
}