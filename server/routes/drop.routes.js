import { Router } from 'express';
import * as controller from '../controllers/drop.controller.js';
import { handleUpload } from '../middleware/upload.js';
import { validateCreate } from '../middleware/validate.js';
import { createLimiter, guardAccessAttempts } from '../middleware/rateLimit.js';

const router = Router();

router.param('id', (req, res, next, id) => {
  if (/^[0-9a-f-]{36}$/.test(id)) return next();
  res.status(404).json({ error: 'Not found.' });
});

router.post('/', createLimiter, handleUpload, validateCreate, controller.create);
router.post('/access', guardAccessAttempts, controller.access);
router.get('/:id/download', controller.download);
router.get('/:id/status', controller.status);

export default router;
