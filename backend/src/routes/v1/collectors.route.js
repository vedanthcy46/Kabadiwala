import express from 'express';
import * as collectorsController from '../../controllers/collectors.controller.js';
import { validate } from '../../middlewares/validate.js';
import { loginCollectorSchema, registerCollectorSchema } from '../../validations/collectors.validation.js';

const router = express.Router();

router.post('/register', validate(registerCollectorSchema), collectorsController.register);
router.post('/login', validate(loginCollectorSchema), collectorsController.login);
router.get('/:id', collectorsController.getProfile);
router.patch('/:id', collectorsController.updateProfile);

export default router;