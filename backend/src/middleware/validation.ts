import { Request, Response } from 'express';
import Joi from 'joi';

// Validation schemas
const matchRequestSchema = Joi.object({
  wallet: Joi.string().pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).required(),
  entryFee: Joi.number().positive().max(100).required()
});

const submitResultSchema = Joi.object({
  matchId: Joi.string().required(),
  wallet: Joi.string().pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).required(),
  result: Joi.object({
    won: Joi.boolean().required(),
    numGuesses: Joi.number().integer().min(1).max(7).required(),
    totalTime: Joi.number().positive().max(300000).required(), // 5 minutes max
    guesses: Joi.array().items(Joi.string().pattern(/^[A-Z]{5}$/)).max(7).required()
  }).required()
});

const submitGuessSchema = Joi.object({
  matchId: Joi.string().required(),
  wallet: Joi.string().pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).required(),
  guess: Joi.string().pattern(/^[A-Z]{5}$/).required()
});

const escrowSchema = Joi.object({
  matchId: Joi.string().required(),
  wallet: Joi.string().pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).required(),
  escrowSignature: Joi.string().required()
});

// Validation middleware
export const validateMatchRequest = (req: Request, res: Response, next: any) => {
  const { error } = matchRequestSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Invalid request data', 
      details: error.details[0].message 
    });
  }
  next();
};

export const validateSubmitResult = (req: Request, res: Response, next: any) => {
  const { error } = submitResultSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Invalid result data', 
      details: error.details[0].message 
    });
  }
  next();
};

export const validateSubmitGuess = (req: Request, res: Response, next: any) => {
  const { error } = submitGuessSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Invalid guess data', 
      details: error.details[0].message 
    });
  }
  next();
};

export const validateEscrow = (req: Request, res: Response, next: any) => {
  const { error } = escrowSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Invalid escrow data', 
      details: error.details[0].message 
    });
  }
  next();
};

// Sanitize input
export const sanitizeInput = (input: string): string => {
  return input.replace(/[<>]/g, '').trim();
};

// Rate limiting helper
export const createRateLimiter = (windowMs: number, max: number, keyGenerator?: (req: Request) => string) => {
  const { rateLimit } = require('express-rate-limit');
  return rateLimit({
    windowMs,
    max,
    keyGenerator: keyGenerator || ((req: Request) => (req as any).ip),
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false
  });
}; 