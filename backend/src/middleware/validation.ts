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
  console.log('🔄 ReCaptcha validation started');
  console.log('🔍 Request headers:', Object.keys(req.headers));
  
  const recaptchaToken = req.headers['x-recaptcha-token'] as string;
  
  if (!recaptchaToken) {
    console.error('❌ ReCaptcha validation failed: No token provided');
    console.error('❌ Available headers:', req.headers);
    return res.status(400).json({ error: 'ReCaptcha token required' });
  }

  console.log('✅ ReCaptcha token found in headers');

  try {
    const recaptchaSecret = process.env.RECAPTCHA_SECRET;
    if (!recaptchaSecret) {
      console.warn('⚠️ RECAPTCHA_SECRET not configured, skipping validation');
      return next();
    }

    console.log('🔄 Verifying ReCaptcha token with Google...');
    
    // Verify ReCaptcha token with Google
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${recaptchaSecret}&response=${recaptchaToken}`
    });

    const data = await response.json();
    console.log('📥 ReCaptcha verification response:', data);
    
    if (!data.success) {
      console.error('❌ ReCaptcha validation failed: Invalid token');
      console.error('❌ ReCaptcha error codes:', data['error-codes']);
      return res.status(400).json({ error: 'Invalid ReCaptcha token' });
    }

    console.log('✅ ReCaptcha validation successful');
    next();
  } catch (error) {
    console.error('❌ ReCaptcha validation error:', error);
    console.error('❌ ReCaptcha error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    });
    return res.status(500).json({ error: 'ReCaptcha validation failed' });
  }
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
  console.log('🔍 Validating submit result request:', {
    body: req.body,
    bodyType: typeof req.body,
    bodyKeys: Object.keys(req.body || {})
  });
  
  const { error } = submitResultSchema.validate(req.body);
  if (error) {
    console.error('❌ Submit result validation error:', error.details[0].message);
    console.error('❌ Validation error details:', error.details);
    return res.status(400).json({ 
      error: 'Invalid result data', 
      details: error.details[0].message 
    });
  }
  
  console.log('✅ Submit result validation passed');
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