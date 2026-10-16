# Temporary Drop

> Share once. Disappear forever.

Accountless file sharing. The sender uploads a file and gets a 6-digit code and a QR code. The receiver enters the code (or scans the QR code) and downloads. The file is permanently deleted when the timer runs out or the download limit is reached. This is not cloud storage; it is a temporary, controlled file-delivery system.

Stack: React + Tailwind + React Router, Node.js + Express, MongoDB (Mongoose), encrypted files on server disk.

## Run it

You need Node 20+ and a MongoDB server.

```bash
docker compose up -d          # MongoDB on localhost:27017 (or point MONGODB_URI at your own)
npm install                   # root tooling (concurrently)
npm run setup                 # installs server/ and client/
cp server/.env.example server/.env
npm run dev                   # API on :4000, app on http://localhost:5173
```

Production: `npm run build` then `npm start`. Express serves the built app and the API together on one port (default 4000). Put it behind HTTPS (Caddy, nginx, or your host) and set `TRUST_PROXY=1`.

Before production, set `MASTER_KEY` and `CODE_SECRET` (`openssl rand -hex 32` each) in the environment. Without them, keys are generated into `server/.data/keys.json`, which is fine for local use only.

Tests: `npm test` (server: 20 tests over real HTTP and WebSocket; client: 13 UI tests).

## How it works

```
CREATED -> ACTIVE -> ACCESSED -> DOWNLOADED -> DESTROYED
```

Every transition is enforced on the server with a conditional database update; nothing is trusted from the client.

| Step | What happens |
|------|--------------|
| Upload | File goes to a temp folder, is streamed through SHA-256 and AES-256-GCM into `server/storage/files/<random>.enc`, the temp copy is removed, and the record is saved. The 6-digit code is returned once and stored only as an HMAC. |
| Access | The receiver submits the code (and password, if set). The server returns file name, size, time left and a 10-minute download ticket. |
| Download | The server verifies the stored file (GCM tag + SHA-256), takes a download slot, streams the decrypted file as a forced download, and destroys the drop if that was the last slot. |
| Cleanup | A cron job runs every minute: it deletes the file first, then the record, for every expired, exhausted or stuck drop. A MongoDB TTL index (10 minutes after expiry) is only a backup; every 10th run also sweeps encrypted files that no record points to. |

Design details worth knowing:

- **Atomic download counting.** A slot is taken with `findOneAndUpdate` whose filter includes the `currentDownloads` value just read, so two simultaneous requests can never both take the last slot (tested with 10 parallel requests).
- **File before record.** A failed delete never leaves an unreferenced file; the record stays and the next run retries.
- **Expiry is checked on every request**, not only by the cleanup job, so a drop is unusable the moment it expires.
- **QR codes carry the code in the URL fragment** (`/access#code=123456`), so it is never sent to a server or written to access logs. The page uses it once and removes it from the address bar.
- **Sender updates** arrive over WebSocket (`/ws`, authenticated with a per-drop sender token), with a 10-second poll as fallback.
- **No preview.** Downloads are always `Content-Disposition: attachment`, `application/octet-stream`, `nosniff`, with a sandboxed CSP.

## API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/drops` | Create a drop. Multipart: `file`, `expiresIn` (`10m`/`1h`/`24h`), `maxDownloads`, optional `password`. |
| POST | `/api/drops/access` | JSON `{ code, password? }`. Returns metadata and a download `ticket`. |
| GET | `/api/drops/:id/download?ticket=` | Streams the file and updates counters. |
| GET | `/api/drops/:id/status` | Sender status; needs the `x-sender-token` header. 404 means the drop is gone. |
| GET | `/api/health` | Limits used by the UI. |

## Configuration (`server/.env`)

See `server/.env.example`. Main settings: `MONGODB_URI`, `PORT`, `MASTER_KEY`, `CODE_SECRET`, `PUBLIC_URL`, `TRUST_PROXY`, `MAX_FILE_MB` (50), `MAX_DOWNLOADS_LIMIT` (100), `MAX_FAILED_ATTEMPTS` (5), `ATTEMPT_WINDOW_MIN` (15), `CREATE_LIMIT_PER_HOUR` (30), `BLOCKED_EXTENSIONS`.

## Security notes and limits

Be accurate about what this does and does not protect:

- **Encryption is at rest, with a key held by the server.** It protects files on disk and in backups. It is not end-to-end: anyone with access to both the server process and `MASTER_KEY` can read files. The app does not claim to be anonymous either; the server sees IP addresses and file contents while handling a request.
- **A 6-digit code has 1,000,000 combinations.** Five wrong guesses per IP lock that IP out for 15 minutes, and five wrong passwords lock a drop. That stops casual guessing, but an attacker with many IP addresses could still enumerate over time. Use a password for sensitive files and short expiries. The IP limiter is in memory, so it is per server process; use a shared store such as Redis if you run several instances.
- **A broken transfer still uses a download slot.** Refunding it would let someone abort at 99% and download repeatedly. If the last slot is lost to a network failure, the sender needs to send the file again.
- **Chat apps and link scanners** that fetch URLs can open the access page but cannot download: a download needs a ticket that only a successful code check issues, and `HEAD` requests never use a slot.
- **Storage is local disk** (v1). For several servers, move files to S3 or similar and keep the same encrypt-then-store flow.
- Files over `MAX_FILE_MB` and common Windows executable types are rejected; adjust `BLOCKED_EXTENSIONS` to taste. No antivirus scanning is included.

## Project structure

```
client/
  src/pages/        Upload, DropCreated, Access, Download
  src/components/   DropZone, QRCard, Countdown (+ Fuse), CodeInput, StatusTrail
  src/lib/          api, hooks (live status), session, format
server/
  routes/ controllers/ middleware/ models/ jobs/ services/ (code, crypto, hash, storage, attempts, drop)
  storage/          encrypted files (created at runtime, outside any public folder)
  test/             flow tests (HTTP + WebSocket)
  test-support/     in-memory model for tests; serve-fake.js runs the app without MongoDB
```

`node test-support/serve-fake.js` (from `server/`) runs the whole app against an in-memory model instead of MongoDB, handy for looking at the UI without a database. Data is lost on restart.
