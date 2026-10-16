// Starts the real server with the in-memory model instead of MongoDB.
// For smoke-testing the UI and API without a database:  node test-support/serve-fake.js
import http from 'node:http';
import { setDropModel } from '../models/registry.js';
import { FakeDropModel } from './fakeDrop.js';
import { config } from '../config.js';
import { loadKeys } from '../keys.js';
import { ensureStorage } from '../services/storage.js';
import { createApp } from '../app.js';
import { attachWebSocket } from '../ws.js';
import { startCleanupJob } from '../jobs/cleanup.job.js';

setDropModel(new FakeDropModel());
loadKeys();
ensureStorage();
const server = http.createServer(createApp());
attachWebSocket(server);
startCleanupJob();
server.listen(config.port, () => console.log(`fake-db server on http://localhost:${config.port}`));
