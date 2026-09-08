import express from 'express';
import * as handoverController from '../../controllers/handover.controller.js';
import { validate } from '../../middlewares/validate.js';
import {
  createLotSchema,
  initiateHandoverSchema,
  confirmHandoverSchema,
  getHandoverSchema,
  getHandoversByLotSchema,
  getLotsByRecyclerSchema,
  cancelLotSchema,
} from '../../validations/handover.validation.js';

const router = express.Router();

// Lot creation
router.post(
  '/lots',
  validate(createLotSchema),
  handoverController.createLot
);

// Static /lots sub-paths first — all must come before /lots/:lotId wildcard
router.get('/lots/collector/:collectorId', handoverController.getLotsByCollector);
router.get('/lots/recycler/:recyclerId', validate(getLotsByRecyclerSchema), handoverController.getLotsByRecycler);

// Wildcard lot sub-routes
router.get('/lots/:lotId/events', handoverController.getLotEvents);
router.get('/lots/:lotId/images', handoverController.getLotImages);
router.post('/lots/:lotId/cancel', validate(cancelLotSchema), handoverController.cancelOrDeleteLot);
router.delete('/lots/:lotId', validate(cancelLotSchema), handoverController.cancelOrDeleteLot);


// Handovers by lot
router.get('/lot/:lotId', validate(getHandoversByLotSchema), handoverController.getHandoversByLot);

// Handover initiation
router.post(
  '/initiate',
  validate(initiateHandoverSchema),
  handoverController.initiateHandover
);

// Recycler confirms handover
router.post(
  '/confirm/:reference',
  validate(confirmHandoverSchema),
  handoverController.confirmHandover
);

// Get handover by reference — wildcard, must be last
router.get(
  '/:reference',
  validate(getHandoverSchema),
  handoverController.getHandover
);

export default router;
