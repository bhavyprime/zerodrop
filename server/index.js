import http from 'node:http';
import mongoose from 'mongoose';
import { config } from './config.js';
import { loadKeys } from './keys.js';
import { ensureStorage } from './services/storage.js';
import { createApp } from './app.js';
import { attachWebSocket } from './ws.js';
import { startCleanupJob } from './jobs/cleanup.job.js';

async function main() {
  loadKeys();
  ensureStorage();

  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
  console.log('[db] connected');

  const server = http.createServer(createApp());
  server.requestTimeout = 30 * 60 * 1000;
  const wss = attachWebSocket(server);
  const cleanup = startCleanupJob();

  server.listen(config.port, () => {
    console.log(`[server] Temporary Drop listening on http://localhost:${config.port}`);
  });

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`[server] ${signal} received, shutting down`);
    cleanup.stop();
    wss.close();
    server.close();
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
