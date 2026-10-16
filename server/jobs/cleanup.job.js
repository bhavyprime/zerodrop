import cron from 'node-cron';
import { Drop } from '../models/registry.js';
import { destroyDrop } from '../services/drop.js';
import { sweepOrphans } from '../services/storage.js';

const STUCK_CREATED_MS = 5 * 60 * 1000;

/**
 * Finds every drop that should no longer exist (expired, download limit reached, or stuck
 * mid-creation) and destroys it: file first, then the record.
 * Returns how many drops were destroyed.
 */
export async function runCleanup(now = new Date()) {
  const stuckBefore = new Date(now.getTime() - STUCK_CREATED_MS);
  const due = await Drop.find({
    $or: [
      { expiresAt: { $lte: now } },
      { status: 'DOWNLOADED' },
      { status: 'DESTROYED' },
      { status: 'CREATED', createdAt: { $lte: stuckBefore } },
    ],
  });

  let destroyed = 0;
  for (const drop of due) {
    try {
      const reason = new Date(drop.expiresAt) <= now ? 'expired' : 'download_limit';
      if (await destroyDrop(drop, reason)) destroyed += 1;
    } catch (err) {
      // Keep the record so the next run retries; never leave a file without its record.
      console.error(`[cleanup] could not destroy ${drop.dropId}:`, err.message);
    }
  }
  return destroyed;
}

export function startCleanupJob({ schedule = '* * * * *' } = {}) {
  let running = false;
  let runs = 0;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const destroyed = await runCleanup();
      if (destroyed) console.log(`[cleanup] destroyed ${destroyed} drop(s)`);
      runs += 1;
      if (runs % 10 === 1) {
        const orphans = await sweepOrphans();
        if (orphans) console.log(`[cleanup] removed ${orphans} orphaned file(s)`);
      }
    } catch (err) {
      console.error('[cleanup] run failed:', err);
    } finally {
      running = false;
    }
  };

  const task = cron.schedule(schedule, tick);
  tick(); // also clean up straight away on startup
  return { stop: () => task.stop(), tick };
}
