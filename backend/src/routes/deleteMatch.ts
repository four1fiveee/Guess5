import express from 'express';
import { deleteMatchById } from '../controllers/deleteMatchController';

const router = express.Router();

router.delete('/:matchId', deleteMatchById);

export default router;

