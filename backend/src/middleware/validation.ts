import { Request, Response } from 'express';
import Joi from 'joi';

// Extend Request interface to include headers
interface RequestWithHeaders extends Request {
  headers: {
    [key: string]: string | string[] | undefined;
  };
}

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
    numGuesses: Joi.number().integer().min(0).max(7).required(),
    totalTime: Joi.number().positive().max(300000).required(), // 5 minutes max
    guesses: Joi.array().items(Joi.string().pattern(/^[A-Z]{5}$/)).max(7).required(),
    reason: Joi.string().optional() // Allow reason field for game completion tracking
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

const confirmPaymentSchema = Joi.object({
  matchId: Joi.string().required(),
  wallet: Joi.string().pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).required(),
  paymentSignature: Joi.string().required()
});

// ReCaptcha3 validation middleware
export const validateReCaptcha = async (req: RequestWithHeaders, res: Response, next: any) => {
  // Temporarily skip ReCaptcha validation for testing
  console.log('🔓 Temporarily skipping ReCaptcha validation for testing');
  return next();

  // TODO: Re-enable ReCaptcha validation once testing is complete
  /*
  // Skip ReCaptcha in development for easier testing
  if (process.env.NODE_ENV === 'development') {
    console.log('🔓 Skipping ReCaptcha validation in development mode');
    return next();
  }

  const token = req.headers['x-recaptcha-token'] as string;
  if (!token) {
    return res.status(400).json({ error: 'ReCaptcha token required' });
  }

  try {
    // Verify token with Google (only in production)
    const verification = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${process.env.RECAPTCHA_SECRET}&response=${token}`
    });

    const result = await verification.json();
    if (!result.success) {
      console.log('❌ ReCaptcha verification failed:', result);
      return res.status(400).json({ error: 'ReCaptcha verification failed' });
    }

    console.log('✅ ReCaptcha verification successful');
    next();
  } catch (error) {
    console.error('❌ ReCaptcha verification error:', error);
    return res.status(500).json({ error: 'ReCaptcha verification error' });
  }
  */
};

// Validation middleware
export const validateMatchRequest = (req: Request, res: Response, next: any) => {
  console.log('🔍 Validating match request:', {
    body: req.body,
    bodyType: typeof req.body,
    bodyKeys: Object.keys(req.body || {})
  });
  
  const { error } = matchRequestSchema.validate(req.body);
  if (error) {
    console.log('❌ Validation error:', error.details[0].message);
    return res.status(400).json({ 
      error: 'Invalid request data', 
      details: error.details[0].message 
    });
  }
  
  console.log('✅ Match request validation passed');
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

export const validateConfirmPayment = (req: Request, res: Response, next: any) => {
  console.log('🔍 Validating confirm payment:', {
    body: req.body,
    bodyType: typeof req.body,
    bodyKeys: Object.keys(req.body || {})
  });
  
  const { error } = confirmPaymentSchema.validate(req.body);
  if (error) {
    console.log('❌ Confirm payment validation error:', error.details[0].message);
    return res.status(400).json({ 
      error: 'Invalid payment confirmation data', 
      details: error.details[0].message 
    });
  }
  
  console.log('✅ Confirm payment validation passed');
  next();
};

// Sanitize input
export const sanitizeInput = (input: string): string => {
  return input.replace(/[<>]/g, '').trim();
};

// Rate limiting helper with wallet-based limiting (commented out - using ReCaptcha instead)
export const createRateLimiter = (windowMs: number, max: number, keyGenerator?: (req: RequestWithHeaders) => string) => {
  // Rate limiting disabled - using ReCaptcha for protection
  return (req: RequestWithHeaders, res: Response, next: any) => {
    next();
  };
}; 