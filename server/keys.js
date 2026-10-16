import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

let keys = null;

function fromEnv(name) {
  const value = process.env[name];
  if (!value) return null;
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${name} must be 64 hex characters (32 bytes). Generate one with: openssl rand -hex 32`);
  }
  return Buffer.from(value, 'hex');
}

/**
 * MASTER_KEY encrypts files at rest. CODE_SECRET keys the HMAC used to hash access
 * codes and to sign download tickets. Set both in the environment for production.
 * If they are missing they are generated once and saved to DATA_DIR/keys.json (mode 600),
 * which is fine for local development.
 */
export function loadKeys() {
  if (keys) return keys;

  let master = fromEnv('MASTER_KEY');
  let codeSecret = fromEnv('CODE_SECRET');

  if (!master || !codeSecret) {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    const file = path.join(config.dataDir, 'keys.json');
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    let changed = false;

    if (!master) {
      if (!saved.masterKey) {
        saved.masterKey = crypto.randomBytes(32).toString('hex');
        changed = true;
      }
      master = Buffer.from(saved.masterKey, 'hex');
    }
    if (!codeSecret) {
      if (!saved.codeSecret) {
        saved.codeSecret = crypto.randomBytes(32).toString('hex');
        changed = true;
      }
      codeSecret = Buffer.from(saved.codeSecret, 'hex');
    }
    if (changed) {
      fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
      if (config.isProd) {
        console.warn(`[keys] MASTER_KEY/CODE_SECRET not set; generated keys saved to ${file}. Set them in the environment.`);
      }
    }
  }

  keys = { master, codeSecret };
  return keys;
}

export const getMasterKey = () => loadKeys().master;
export const getCodeSecret = () => loadKeys().codeSecret;
