/**
 * Health router — readiness/liveness probes.
 */
import Router from '@koa/router';
import { ResponseUtil } from '@my-agent/shared';
import { config } from '../config';

const router = new Router({ prefix: '/api/health' });

router.get('/', (ctx) => {
  ctx.body = ResponseUtil.success({
    status: 'ok',
    env: config.env,
    timestamp: Date.now(),
  });
});

export { router as healthRouter };