import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const DEFAULT_BLOCKED = '.exe,.msi,.bat,.cmd,.com,.scr,.pif,.vbs,.vbe,.jar,.dll,.lnk,.apk';

export const config = {
  isProd: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/temporary-drop',

  // Public base URL used inside QR codes. Empty = derive from the request Host header.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),

  // "true"/"false", a hop count ("1"), or an Express trust-proxy string.
  trustProxy: (() => {
    const v = process.env.TRUST_PROXY;
    if (v === undefined || v === '' || v === 'false') return false;
    if (v === 'true') return true;
    return /^\d+$/.test(v) ? parseInt(v, 10) : v;
  })(),

  storageDir: path.resolve(process.env.STORAGE_DIR || path.join(__dirname, 'storage')),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '.data')),
  clientDist: path.resolve(process.env.CLIENT_DIST || path.join(__dirname, '..', 'client', 'dist')),

  maxFileBytes: int(process.env.MAX_FILE_MB, 50) * 1024 * 1024,
  maxDownloadsLimit: int(process.env.MAX_DOWNLOADS_LIMIT, 100),
  blockedExtensions: new Set(
    (process.env.BLOCKED_EXTENSIONS ?? DEFAULT_BLOCKED)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ),

  // Brute-force protection: wrong attempts allowed per IP (and per drop for passwords).
  maxFailedAttempts: int(process.env.MAX_FAILED_ATTEMPTS, 5),
  attemptWindowMs: int(process.env.ATTEMPT_WINDOW_MIN, 15) * 60 * 1000,

  // Uploads per IP per hour.
  createLimitPerHour: int(process.env.CREATE_LIMIT_PER_HOUR, 30),

  // A download ticket (issued after a successful access) stays valid this long.
  ticketTtlMs: 10 * 60 * 1000,

  // MongoDB TTL index grace: records are only removed by TTL this long after expiry,
  // leaving the cleanup job time to delete the file first.
  ttlGraceSeconds: 600,
};
