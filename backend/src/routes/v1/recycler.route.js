import express from 'express';
import * as recyclerController from '../../controllers/recycler.controller.js';
import * as recyclerCrudController from '../../controllers/recyclerCrud.controller.js';
import { validate } from '../../middlewares/validate.js';
import { matchRecyclersSchema } from '../../validations/recycler.validation.js';
import {
  createRecyclerSchema,
  onboardRecyclerSchema,
  loginRecyclerSchema,
  updateRecyclerSchema,
  getRecyclerSchema,
  listRecyclersSchema,
} from '../../validations/recyclerCrud.validation.js';

const router = express.Router();

// Matching
router.get(
  '/match',
  validate(matchRecyclersSchema),
  recyclerController.getMatchedRecyclers
);

// Nearby authorized recyclers (proximity only — no prices / valuation)
router.get(
  '/nearby',
  recyclerController.getNearbyRecyclers
);

// Recycler self-onboarding — creates an application in 'pending' state
router.post(
  '/onboard',
  validate(onboardRecyclerSchema),
  recyclerCrudController.onboardRecycler
);

// Recycler sign-in — only authorized recyclers gain access to the portal
router.post(
  '/login',
  validate(loginRecyclerSchema),
  recyclerCrudController.loginRecycler
);

// CRUD
router.post(
  '/',
  validate(createRecyclerSchema),
  recyclerCrudController.createRecycler
);

router.get(
  '/',
  validate(listRecyclersSchema),
  recyclerCrudController.listRecyclers
);

router.get(
  '/:id',
  validate(getRecyclerSchema),
  recyclerCrudController.getRecycler
);

router.put(
  '/:id',
  validate(updateRecyclerSchema),
  recyclerCrudController.updateRecycler
);

router.delete(
  '/:id',
  validate(getRecyclerSchema),
  recyclerCrudController.deleteRecycler
);

router.post(
  '/:id/renew',
  validate(getRecyclerSchema),
  recyclerCrudController.renewAuthorization
);

export default router;
