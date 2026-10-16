import crypto from 'node:crypto';
import { getCodeSecret } from '../keys.js';
import { config } from '../config.js';
import { safeEqual, sha256Hex } from './hash.js';

export const CODE_PATTERN = /^\d{6}$/;

export const generateCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

const hmac = (label, value) =>
  crypto.createHmac('sha256', getCodeSecret()).update(`${label}|${value}`).digest('base64url');

/** Deterministic keyed hash so a submitted code can be looked up without storing it. */
export const hashCode = (code) => hmac('code', code);

export const generateSenderToken = () => crypto.randomBytes(24).toString('base64url');
export const hashSenderToken = (token) => sha256Hex(String(token));

/** Short-lived, stateless proof that the holder passed the code (and password) check. */
export function makeTicket(dropId, now = Date.now()) {
  const exp = now + config.ticketTtlMs;
  return { ticket: `${exp}.${hmac('ticket', `${dropId}.${exp}`)}`, expiresAt: new Date(exp) };
}

export function verifyTicket(dropId, ticket, now = Date.now()) {
  if (typeof ticket !== 'string') return false;
  const [expStr, sig, ...rest] = ticket.split('.');
  const exp = Number(expStr);
  if (rest.length || !sig || !Number.isFinite(exp) || exp < now) return false;
  return safeEqual(sig, hmac('ticket', `${dropId}.${exp}`));
}
