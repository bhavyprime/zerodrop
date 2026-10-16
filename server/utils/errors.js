export class HttpError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} message safe to show to the client
   * @param {object} [extra] extra JSON fields (e.g. { passwordRequired: true })
   */
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.expose = true;
    this.extra = extra;
  }
}

const NAME_BLOCKLIST = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

/** Strip paths and unsafe characters from an uploaded file name. */
export function sanitizeFileName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  let clean = base.replace(NAME_BLOCKLIST, '_').replace(/^\.+/, '').trim();
  if (clean.length > 200) {
    const ext = clean.includes('.') ? clean.slice(clean.lastIndexOf('.')) : '';
    clean = clean.slice(0, 200 - ext.length) + ext;
  }
  return clean || 'file';
}
