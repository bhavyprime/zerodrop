import fsp from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { HttpError } from '../utils/errors.js';
import * as drops from '../services/drop.js';
import { verifyTicket } from '../services/code.js';
import { createDecryptStream, verifyStoredFile } from '../services/crypto.js';
import { pathFor } from '../services/storage.js';

const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

export async function create(req, res) {
  const drop = await drops.createDrop(req.dropInput);

  // The code goes in the URL fragment so it is never sent to a server or written to access logs.
  const accessUrl = `${baseUrl(req)}/access#code=${drop.code}`;
  const qr = await QRCode.toDataURL(accessUrl, { margin: 1, width: 320, errorCorrectionLevel: 'M' });

  res.status(201).json({ ...drop, qr, accessUrl });
}

export async function access(req, res) {
  const { code, password } = req.body ?? {};
  res.json(await drops.accessDrop({ code, password, ip: req.ip }));
}

export async function status(req, res) {
  const view = await drops.getSenderView(req.params.id, req.get('x-sender-token'));
  if (!view) throw new HttpError(404, 'Drop not found. It may have expired or been downloaded.', { status: 'DESTROYED' });
  res.json(view);
}

export async function download(req, res, next) {
  let handle = null;
  let claimed = null;
  try {
    // HEAD would otherwise be served by the GET route and burn a download.
    if (req.method !== 'GET') throw new HttpError(405, 'Use GET to download.');

    const { id } = req.params;
    if (!verifyTicket(id, req.query.ticket)) {
      throw new HttpError(401, 'Your download link expired. Enter the access code again.');
    }

    const drop = await drops.getDownloadable(id);

    try {
      handle = await fsp.open(pathFor(drop.storedName), 'r');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await drops.destroyDrop(drop, 'file_missing');
      throw new HttpError(410, 'This drop is no longer available.');
    }

    // Check integrity before spending a download slot, so a damaged file never consumes one.
    if (!(await verifyStoredFile(drop))) {
      await drops.destroyDrop(drop, 'integrity_failure');
      throw new HttpError(422, 'This file failed its integrity check and was destroyed.');
    }

    claimed = await drops.claimDownload(id);

    res.status(200);
    res.attachment(drop.fileName); // forces download; no inline preview
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(drop.fileSize),
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'none',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-SHA256': drop.sha256,
    });

    const source = handle.createReadStream(); // takes over the handle and closes it when done
    handle = null;
    await pipeline(source, createDecryptStream(drop), res);

    await drops.afterDownload(claimed);
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    if (claimed) {
      // The slot is spent even if the transfer broke; destroy the drop if that was the last one.
      await drops.afterDownload(claimed, { completed: false }).catch(() => {});
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    next(err);
  }
}
