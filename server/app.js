import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import dropRoutes from './routes/drop.routes.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errors.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null, // TLS is terminated by your reverse proxy
        },
      },
    }),
  );

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', apiLimiter);
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) =>
    res.json({
      ok: true,
      maxFileMb: Math.floor(config.maxFileBytes / 1024 / 1024),
      maxDownloads: config.maxDownloadsLimit,
    }),
  );
  app.use('/api/drops', dropRoutes);
  app.use('/api', notFound);

  // In production the built React app is served by this same server.
  const indexFile = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method) || req.path === '/ws') return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  }

  app.use(errorHandler);
  return app;
}
