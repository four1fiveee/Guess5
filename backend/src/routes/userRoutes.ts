import { Router } from 'express';
import {
  setUsername,
  getUsername,
  checkUsernameAvailability
} from '../controllers/userController';

const router = Router();

router.post('/username', setUsername);
router.get('/username', getUsername);
router.get('/username/check', checkUsernameAvailability);

export default router;

