import crypto from 'node:crypto';
import { Transform, Writable } from 'node:stream';
import bcrypt from 'bcryptjs';

export const sha256Hex = (input) => crypto.createHash('sha256').update(input).digest('hex');

/** Passes data through unchanged while computing a SHA-256 and byte count. */
export class HashTap extends Transform {
  constructor() {
    super();
    this._hash = crypto.createHash('sha256');
    this.bytes = 0;
  }
  _transform(chunk, _enc, cb) {
    this._hash.update(chunk);
    this.bytes += chunk.length;
    cb(null, chunk);
  }
  digest() {
    return this._hash.digest('hex');
  }
}

/** A writable that throws everything away (used to drain a stream for verification). */
export const discard = () =>
  new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });

export const hashPassword = (password) => bcrypt.hash(password, 10);
export const checkPassword = (password, hash) => bcrypt.compare(password, hash);

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
