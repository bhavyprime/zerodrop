import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { Drop } from '../models/registry.js';
import { config } from '../config.js';
import { HttpError } from '../utils/errors.js';
import { encryptFile } from './crypto.js';
import {
  CODE_PATTERN,
  generateCode,
  generateSenderToken,
  hashCode,
  hashSenderToken,
  makeTicket,
} from './code.js';
import { checkPassword, hashPassword, safeEqual } from './hash.js';
import { deleteFile, pathFor } from './storage.js';
import { ipAttempts } from './attempts.js';
import { emitDropEvent } from './events.js';

export const EXPIRY_OPTIONS = { '10m': 10 * 60_000, '1h': 60 * 60_000, '24h': 24 * 60 * 60_000 };

/** Allowed lifecycle moves: CREATED -> ACTIVE -> ACCESSED -> DOWNLOADED -> DESTROYED. */
const TRANSITIONS = {
  CREATED: ['ACTIVE', 'DESTROYED'],
  ACTIVE: ['ACCESSED', 'DOWNLOADED', 'DESTROYED'],
  ACCESSED: ['DOWNLOADED', 'DESTROYED'],
  DOWNLOADED: ['DESTROYED'],
  DESTROYED: [],
};

const DOWNLOADABLE = ['ACTIVE', 'ACCESSED'];
const NOT_FOUND = 'That code is invalid or the drop is gone.';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Atomically moves a drop to `to`, only if its current status allows that move. */
async function transition(dropId, to, set = {}) {
  const from = Object.keys(TRANSITIONS).filter((s) => TRANSITIONS[s].includes(to));
  return Drop.findOneAndUpdate(
    { dropId, status: { $in: from } },
    { $set: { status: to, ...set } },
    { returnDocument: 'after' },
  );
}

export function isLive(drop, now = new Date()) {
  return (
    !!drop &&
    DOWNLOADABLE.includes(drop.status) &&
    new Date(drop.expiresAt) > now &&
    drop.currentDownloads < drop.maxDownloads
  );
}

/** Deletes the file first, then the record, so a failure never leaves an unreferenced file. */
export async function destroyDrop(drop, reason = 'expired') {
  await deleteFile(drop.storedName);
  const { deletedCount } = await Drop.deleteOne({ dropId: drop.dropId });
  if (deletedCount) emitDropEvent({ type: 'destroyed', dropId: drop.dropId, reason });
  return !!deletedCount;
}

// ---------------------------------------------------------------- create

export async function createDrop({ tempPath, fileName, expiresIn, maxDownloads, password }) {
  const dropId = crypto.randomUUID();
  const storedName = `${crypto.randomBytes(24).toString('hex')}.enc`;
  const destPath = pathFor(storedName);

  let enc;
  try {
    enc = await encryptFile(tempPath, destPath);
  } catch (err) {
    await deleteFile(storedName).catch(() => {});
    throw err;
  } finally {
    await fsp.rm(tempPath, { force: true });
  }

  try {
    const senderToken = generateSenderToken();
    const passwordHash = password ? await hashPassword(password) : null;
    const expiresAt = new Date(Date.now() + EXPIRY_OPTIONS[expiresIn]);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = generateCode();
      try {
        await Drop.create({
          dropId,
          accessCode: hashCode(code),
          senderTokenHash: hashSenderToken(senderToken),
          fileName,
          storedName,
          fileSize: enc.size,
          sha256: enc.sha256,
          encSalt: enc.encSalt,
          encIv: enc.encIv,
          encAuthTag: enc.encAuthTag,
          passwordHash,
          expiresAt,
          maxDownloads,
          status: 'CREATED',
        });
      } catch (err) {
        const isCodeCollision =
          err?.code === 11000 && (err.keyPattern?.accessCode || /accessCode/.test(err.message ?? ''));
        if (isCodeCollision) continue; // another live drop already uses this code; pick a new one
        throw err;
      }

      const active = await transition(dropId, 'ACTIVE');
      if (!active) throw new HttpError(500, 'Could not activate the drop. Please try again.');
      return {
        dropId,
        code,
        senderToken,
        fileName,
        fileSize: enc.size,
        expiresAt,
        maxDownloads,
        hasPassword: !!passwordHash,
      };
    }
    throw new HttpError(503, 'Could not allocate an access code. Please try again.');
  } catch (err) {
    await deleteFile(storedName).catch(() => {});
    await Drop.deleteOne({ dropId }).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------- access

export async function accessDrop({ code, password, ip }) {
  const guard = ipAttempts.status(ip);
  if (guard.blocked) throw tooManyAttempts(guard.retryAfterMs);

  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
    throw new HttpError(400, 'Enter the 6-digit access code.');
  }

  const now = new Date();
  const drop = await Drop.findOne({ accessCode: hashCode(code) });
  if (!isLive(drop, now)) {
    ipAttempts.fail(ip);
    throw new HttpError(404, NOT_FOUND);
  }

  if (drop.lockedUntil && new Date(drop.lockedUntil) > now) {
    throw tooManyAttempts(new Date(drop.lockedUntil) - now);
  }

  if (drop.passwordHash) {
    if (typeof password !== 'string' || password === '') {
      throw new HttpError(401, 'This drop is password protected.', { passwordRequired: true });
    }
    if (!(await checkPassword(password, drop.passwordHash))) {
      ipAttempts.fail(ip);
      const failed = await Drop.findOneAndUpdate(
        { dropId: drop.dropId },
        { $inc: { failedAttempts: 1 } },
        { returnDocument: 'after' },
      );
      if (failed && failed.failedAttempts >= config.maxFailedAttempts) {
        await Drop.updateOne(
          { dropId: drop.dropId },
          { $set: { failedAttempts: 0, lockedUntil: new Date(Date.now() + config.attemptWindowMs) } },
        );
        throw tooManyAttempts(config.attemptWindowMs);
      }
      throw new HttpError(401, 'Wrong password.', {
        passwordRequired: true,
        attemptsLeft: Math.max(0, config.maxFailedAttempts - (failed?.failedAttempts ?? 0)),
      });
    }
  }

  const accessed = await transition(drop.dropId, 'ACCESSED');
  if (accessed) emitDropEvent({ type: 'accessed', dropId: drop.dropId, status: 'ACCESSED' });

  const { ticket, expiresAt: ticketExpiresAt } = makeTicket(drop.dropId);
  return {
    dropId: drop.dropId,
    fileName: drop.fileName,
    fileSize: drop.fileSize,
    expiresAt: drop.expiresAt,
    downloadsLeft: drop.maxDownloads - drop.currentDownloads,
    ticket,
    ticketExpiresAt,
  };
}

function tooManyAttempts(retryAfterMs) {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new HttpError(429, 'Too many wrong attempts. Try again later.', { retryAfterSeconds });
}

// ---------------------------------------------------------------- download

/** Returns the drop if it can still be downloaded, otherwise throws 410. */
export async function getDownloadable(dropId) {
  const drop = await Drop.findOne({ dropId });
  if (!isLive(drop)) throw new HttpError(410, 'This drop has expired or was already downloaded.');
  return drop;
}

/**
 * Takes one download slot. The update only succeeds if currentDownloads still has the value we
 * just read, so two simultaneous requests can never both take the last slot.
 */
export async function claimDownload(dropId) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const drop = await Drop.findOne({ dropId });
    if (!isLive(drop)) throw new HttpError(410, 'This drop has expired or was already downloaded.');

    const next = drop.currentDownloads + 1;
    const claimed = await Drop.findOneAndUpdate(
      {
        dropId,
        currentDownloads: drop.currentDownloads,
        status: { $in: DOWNLOADABLE },
        expiresAt: { $gt: new Date() },
      },
      {
        $inc: { currentDownloads: 1 },
        $set: { status: next >= drop.maxDownloads ? 'DOWNLOADED' : 'ACCESSED' },
      },
      { returnDocument: 'after' },
    );
    if (claimed) return claimed;
    await sleep(Math.random() * 20); // lost a race; re-read and try again
  }
  throw new HttpError(503, 'The server is busy. Please try again.');
}

/** Called after the response finished (or failed). Notifies the sender; destroys when exhausted. */
export async function afterDownload(claimed, { completed = true } = {}) {
  if (completed) {
    emitDropEvent({
      type: 'downloaded',
      dropId: claimed.dropId,
      currentDownloads: claimed.currentDownloads,
      maxDownloads: claimed.maxDownloads,
    });
  }
  if (claimed.currentDownloads >= claimed.maxDownloads) {
    await destroyDrop(claimed, 'download_limit');
  }
}

// ---------------------------------------------------------------- sender

export async function getSenderView(dropId, token) {
  const drop = await Drop.findOne({ dropId });
  if (!drop || typeof token !== 'string' || !safeEqual(hashSenderToken(token), drop.senderTokenHash)) {
    return null;
  }
  return {
    dropId: drop.dropId,
    status: drop.status,
    fileName: drop.fileName,
    fileSize: drop.fileSize,
    expiresAt: drop.expiresAt,
    currentDownloads: drop.currentDownloads,
    maxDownloads: drop.maxDownloads,
  };
}
