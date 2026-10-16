export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found.' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // A download already started streaming; the only option left is to cut the connection.
  if (res.headersSent) {
    res.destroy();
    return;
  }

  const status = Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);

  if (err.extra?.retryAfterSeconds) res.set('Retry-After', String(err.extra.retryAfterSeconds));

  res.status(status).json({
    error: err.expose ? err.message : 'Something went wrong on our side.',
    ...(err.expose ? err.extra : {}),
  });
}
