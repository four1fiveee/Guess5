// @ts-nocheck
const express = require('express');
const { deleteMatchById } = require('../controllers/deleteMatchController');

const router = express.Router();

router.delete('/:matchId', deleteMatchById);

module.exports = router;

