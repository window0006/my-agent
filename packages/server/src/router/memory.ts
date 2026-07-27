/**
 * Memory router.
 */
import Router from '@koa/router';
import { memoryController } from '../controller/memory';

const router = new Router({ prefix: '/api/memories' });

router
  .get('/', memoryController.list)
  .post('/', memoryController.upsert)
  .delete('/:id', memoryController.delete);

export { router as memoryRouter };

// Separate router for session-scoped summaries (nested under sessions).
import { memoryController as mc } from '../controller/memory';
const summaryRouter = new Router({ prefix: '/api/sessions/:sessionId/summaries' });
summaryRouter.get('/', mc.listSummaries);
export { summaryRouter };