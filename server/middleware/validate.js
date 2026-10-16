import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError, sanitizeFileName } from '../utils/errors.js';
import { EXPIRY_OPTIONS } from '../services/drop.js';

// Multer decodes multipart file names as latin1; recover UTF-8 names when that is what was sent.
function fixEncoding(name) {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

/** Validates the create-drop request and leaves clean values on req.dropInput. */
export function validateCreate(req, _res, next) {
  try {
    const body = req.body ?? {};
    if (!req.file) throw new HttpError(400, 'No file uploaded. Send it in a form field named "file".');
    if (req.file.size === 0) throw new HttpError(400, 'The file is empty.');

    const fileName = sanitizeFileName(fixEncoding(req.file.originalname));
    const ext = path.extname(fileName).toLowerCase();
    if (ext && config.blockedExtensions.has(ext)) {
      throw new HttpError(400, `Files of type ${ext} are not allowed.`);
    }

    const expiresIn = body.expiresIn ?? '1h';
    if (!Object.hasOwn(EXPIRY_OPTIONS, expiresIn)) {
      throw new HttpError(400, `expiresIn must be one of: ${Object.keys(EXPIRY_OPTIONS).join(', ')}.`);
    }

    const rawLimit = body.maxDownloads;
    const maxDownloads = rawLimit === undefined || rawLimit === '' ? 1 : Number(rawLimit);
    if (!Number.isInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > config.maxDownloadsLimit) {
      throw new HttpError(400, `maxDownloads must be a whole number from 1 to ${config.maxDownloadsLimit}.`);
    }

    let password = null;
    if (body.password !== undefined && body.password !== '') {
      if (typeof body.password !== 'string' || body.password.length < 4 || body.password.length > 128) {
        throw new HttpError(400, 'The password must be 4 to 128 characters.');
      }
      password = body.password;
    }

    req.dropInput = { tempPath: req.file.path, fileName, expiresIn, maxDownloads, password };
    next();
  } catch (err) {
    if (req.file?.path) fsp.rm(req.file.path, { force: true }).catch(() => {});
    next(err);
  }
}
