import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import { tmpDir } from '../services/storage.js';
import { HttpError } from '../utils/errors.js';

// Uploads land in a temp folder first, then are encrypted into permanent storage.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpDir),
  filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.part`),
});

const uploader = multer({
  storage,
  limits: { fileSize: config.maxFileBytes, files: 1, fields: 8, fieldSize: 1024, parts: 10 },
}).single('file');

export function handleUpload(req, res, next) {
  uploader(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const mb = Math.round(config.maxFileBytes / 1024 / 1024);
        return next(new HttpError(413, `File is too large. The limit is ${mb} MB.`));
      }
      return next(new HttpError(400, 'Invalid upload.'));
    }
    return next(err);
  });
}
