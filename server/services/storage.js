import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { Drop } from '../models/registry.js';

export const filesDir = path.join(config.storageDir, 'files');
export const tmpDir = path.join(config.storageDir, 'tmp');

const STORED_NAME = /^[a-f0-9]{48}\.enc$/;

export function ensureStorage() {
  fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
}

export function pathFor(storedName) {
  if (!STORED_NAME.test(storedName)) throw new Error('Invalid stored file name');
  return path.join(filesDir, storedName);
}

/** Deletes an encrypted file. A file that is already gone counts as deleted. */
export async function deleteFile(storedName) {
  try {
    await fsp.unlink(pathFor(storedName));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Safety net: removes encrypted files that no database record points to (for example if a
 * record was removed by the TTL index before the cleanup job reached it), and stale
 * temporary upload parts. Only touches files older than minAgeMs so in-flight uploads are safe.
 */
export async function sweepOrphans(now = Date.now(), minAgeMs = 15 * 60 * 1000) {
  let removed = 0;

  const old = [];
  for (const name of await fsp.readdir(filesDir)) {
    if (!STORED_NAME.test(name)) continue;
    const stat = await fsp.stat(path.join(filesDir, name)).catch(() => null);
    if (stat && now - stat.mtimeMs > minAgeMs) old.push(name);
  }
  if (old.length) {
    const known = new Set((await Drop.find({ storedName: { $in: old } })).map((d) => d.storedName));
    for (const name of old) {
      if (!known.has(name)) {
        await deleteFile(name);
        removed += 1;
      }
    }
  }

  for (const name of await fsp.readdir(tmpDir)) {
    const full = path.join(tmpDir, name);
    const stat = await fsp.stat(full).catch(() => null);
    if (stat && now - stat.mtimeMs > 60 * 60 * 1000) {
      await fsp.rm(full, { force: true });
      removed += 1;
    }
  }
  return removed;
}
