import express from 'express';
import * as priceController from '../../controllers/price.controller.js';
import { validate } from '../../middlewares/validate.js';
import { getPriceTrendSchema } from '../../validations/price.validation.js';

const router = express.Router();

router.get(
  '/trends',
  validate(getPriceTrendSchema),
  priceController.getPriceTrends
);

router.get(
  '/analytics',
  priceController.getPriceAnalytics
);

router.get(
  '/market-pulse',
  priceController.getMarketPulse
);

router.post(
  '/refresh-market',
  priceController.refreshMarketPrices
);

export default router;
