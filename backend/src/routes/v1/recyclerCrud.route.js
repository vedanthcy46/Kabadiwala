import express from 'express';
import * as recyclerCrudController from '../../controllers/recyclerCrud.controller.js';
import { validate } from '../../middlewares/validate.js';
import {
  createRecyclerSchema,
  updateRecyclerSchema,
  getRecyclerSchema,
  listRecyclersSchema,
} from '../../validations/recyclerCrud.validation.js';

const router = express.Router();

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

router.post(
  '/:id/renew',
  validate(getRecyclerSchema),
  recyclerCrudController.renewAuthorization
);

export default router;
