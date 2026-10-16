import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { getMasterKey } from '../keys.js';
import { HashTap, discard } from './hash.js';
import { pathFor } from './storage.js';

const ALGORITHM = 'aes-256-gcm';

function deriveFileKey(salt) {
  return Buffer.from(crypto.hkdfSync('sha256', getMasterKey(), salt, 'temporary-drop file key', 32));
}

/**
 * Reads a plaintext file, computes its SHA-256 and writes it AES-256-GCM encrypted to destPath.
 * Each file gets its own random salt (-> its own key) and IV.
 */
export async function encryptFile(srcPath, destPath) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveFileKey(salt), iv);
  const tap = new HashTap();

  await pipeline(
    fs.createReadStream(srcPath),
    tap,
    cipher,
    fs.createWriteStream(destPath, { flags: 'wx', mode: 0o600 }),
  );

  return {
    sha256: tap.digest(),
    size: tap.bytes,
    encSalt: salt.toString('hex'),
    encIv: iv.toString('hex'),
    encAuthTag: cipher.getAuthTag().toString('hex'),
  };
}

/** A Transform that turns the stored ciphertext back into the original bytes. */
export function createDecryptStream(drop) {
  const key = deriveFileKey(Buffer.from(drop.encSalt, 'hex'));
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(drop.encIv, 'hex'));
  decipher.setAuthTag(Buffer.from(drop.encAuthTag, 'hex'));
  return decipher;
}

/**
 * Decrypts the whole stored file into a hash and checks both the GCM auth tag and the
 * recorded SHA-256 and size. Resolves true only when the file is intact.
 */
export async function verifyStoredFile(drop) {
  const tap = new HashTap();
  try {
    await pipeline(
      fs.createReadStream(pathFor(drop.storedName)),
      createDecryptStream(drop),
      tap,
      discard(),
    );
  } catch (err) {
    if (err.code === 'ENOENT') throw err;
    return false; // auth tag failure or truncated file
  }
  return tap.bytes === drop.fileSize && tap.digest() === drop.sha256;
}
