import express from 'express';
import * as collectorsController from '../../controllers/collectors.controller.js';
import { validate } from '../../middlewares/validate.js';
import { loginCollectorSchema, registerCollectorSchema } from '../../validations/collectors.validation.js';

const router = express.Router();

// Collector registration — create an account (phone/name/area/language)
router.post('/register', validate(registerCollectorSchema), collectorsController.register);

// Collector login — phone-number based for the demo
router.post('/login', validate(loginCollectorSchema), collectorsController.login);

export default router;