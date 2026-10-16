import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { ipAttempts } from '../services/attempts.js';

const json = (message) => ({ error: message });

/** Broad per-IP ceiling for the whole API. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many requests. Slow down.'),
});

/** Limits how many drops one IP can create per hour. */
export const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.createLimitPerHour,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Upload limit reached. Try again later.'),
});

/** Rejects early when this IP has used up its wrong-attempt budget. */
export function guardAccessAttempts(req, res, next) {
  const status = ipAttempts.status(req.ip);
  if (!status.blocked) return next();
  const retryAfterSeconds = Math.max(1, Math.ceil(status.retryAfterMs / 1000));
  res.set('Retry-After', String(retryAfterSeconds));
  res.status(429).json({ error: 'Too many wrong attempts. Try again later.', retryAfterSeconds });
}
