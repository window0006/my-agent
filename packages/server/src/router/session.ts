/**
 * Session router.
 */
import Router from '@koa/router';
import { sessionController } from '../controller/session';

const router = new Router({ prefix: '/api/sessions' });

router
  .post('/', sessionController.create)
  .get('/', sessionController.list)
  .get('/:id', sessionController.get)
  .delete('/:id', sessionController.delete)
  .post('/:id/run', sessionController.run)
  .post('/:id/run/stream', sessionController.runStream);

export { router as sessionRouter };