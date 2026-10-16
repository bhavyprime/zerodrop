import mongoose from 'mongoose';
import { config } from '../config.js';

export const STATUSES = ['CREATED', 'ACTIVE', 'ACCESSED', 'DOWNLOADED', 'DESTROYED'];

const dropSchema = new mongoose.Schema(
  {
    dropId: { type: String, required: true, unique: true },

    // HMAC-SHA256 of the 6-digit code. The plain code is never stored.
    accessCode: { type: String, required: true, unique: true },

    // SHA-256 of the sender token that authorises status checks / WebSocket updates.
    senderTokenHash: { type: String, required: true },

    fileName: { type: String, required: true },
    storedName: { type: String, required: true, unique: true }, // random name on disk
    fileSize: { type: Number, required: true },
    sha256: { type: String, required: true }, // of the plaintext file

    // AES-256-GCM parameters (the key itself is derived from the master key + salt).
    encSalt: { type: String, required: true },
    encIv: { type: String, required: true },
    encAuthTag: { type: String, required: true },

    passwordHash: { type: String, default: null },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    maxDownloads: { type: Number, required: true, min: 1 },
    currentDownloads: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: STATUSES, default: 'CREATED' },
  },
  { versionKey: false },
);

// Backup deletion only: removes stale records some time after expiry. It cannot delete the
// encrypted file, so the cleanup job remains the primary mechanism and deletes files first.
dropSchema.index({ expiresAt: 1 }, { expireAfterSeconds: config.ttlGraceSeconds });
dropSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model('Drop', dropSchema);
