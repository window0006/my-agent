/**
 * Koa app factory — wires middleware and routes.
 */
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import loggerMiddleware from 'koa-logger';
import helmet from 'koa-helmet';
import { errorHandler } from './common/middleware/error-handler';
import { requestId } from './common/middleware/request-id';
import { registerRouters } from './router';

export function createApp() {
  const app = new Koa();

  // Order matters: request-id → error-handler → logger → security → body → routers
  app.use(requestId());
  app.use(errorHandler());
  if (process.env.NODE_ENV !== 'production') {
    app.use(loggerMiddleware());
  }
  app.use(helmet());
  app.use(bodyParser({ jsonLimit: '10mb', enableTypes: ['json', 'form'] }));

  registerRouters(app);

  return app;
}