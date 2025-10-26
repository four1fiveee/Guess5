import { Request, Response, NextFunction } from 'express';
import { checkBotId } from 'botid/server';

/**
 * Middleware to validate BotID for bot protection
 * This replaces ReCaptcha validation
 */
export const validateBotId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Check if the request is from a bot
    const verification = await checkBotId();

    if (verification.isBot) {
      console.log('🚫 Bot detected by BotID:', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        path: req.path,
      });

      res.status(403).json({
        success: false,
        error: 'Bot detected. Access denied.',
      });
      return;
    }

    console.log('✅ BotID verification passed - legitimate user');
    next();
  } catch (error) {
    console.error('❌ BotID validation error:', error);

    // In case of BotID error, allow the request through
    // This prevents blocking legitimate users if BotID service has issues
    console.log('⚠️ Allowing request despite BotID error (fail-open strategy)');
    next();
  }
};
