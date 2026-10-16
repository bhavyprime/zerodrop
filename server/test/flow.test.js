import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { WebSocket } from 'ws';

// Configure before the app modules are imported (config.js reads the environment on load).
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tdrop-test-'));
process.env.STORAGE_DIR = path.join(sandbox, 'storage');
process.env.DATA_DIR = path.join(sandbox, 'data');
process.env.MAX_FILE_MB = '1';
process.env.CREATE_LIMIT_PER_HOUR = '1000';
process.env.CLIENT_DIST = path.join(sandbox, 'no-client');

const { FakeDropModel } = await import('../test-support/fakeDrop.js');
const { setDropModel } = await import('../models/registry.js');
const { createApp } = await import('../app.js');
const { attachWebSocket } = await import('../ws.js');
const { ensureStorage, filesDir, sweepOrphans } = await import('../services/storage.js');
const { ipAttempts } = await import('../services/attempts.js');
const { runCleanup } = await import('../jobs/cleanup.job.js');

const fake = new FakeDropModel();
setDropModel(fake);
ensureStorage();

let server;
let wss;
let base;

before(async () => {
  server = http.createServer(createApp());
  wss = attachWebSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  wss.close();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  fake.reset();
  ipAttempts.reset();
  for (const name of fs.readdirSync(filesDir)) fs.rmSync(path.join(filesDir, name));
});

// ------------------------------------------------------------------ helpers

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const storedFiles = () => fs.readdirSync(filesDir);

async function upload(content, { name = 'hello.txt', ...fields } = {}) {
  const form = new FormData();
  form.append('file', new Blob([content]), name);
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const res = await fetch(`${base}/api/drops`, { method: 'POST', body: form });
  return { res, body: await res.json() };
}

async function access(code, password) {
  const res = await fetch(`${base}/api/drops/access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, password }),
  });
  return { res, body: await res.json() };
}

const download = (id, ticket, init) =>
  fetch(`${base}/api/drops/${id}/download?ticket=${encodeURIComponent(ticket)}`, init);

/** Upload + access in one go. */
async function readyDrop(content, fields) {
  const { body: created } = await upload(content, fields);
  const { body: accessed } = await access(created.code);
  return { created, accessed };
}

// ------------------------------------------------------------------ tests

describe('creating a drop', () => {
  it('returns a 6-digit code, a QR code and stores only ciphertext', async () => {
    const plain = Buffer.from('top secret contents '.repeat(50));
    const { res, body } = await upload(plain, { expiresIn: '10m', maxDownloads: 1 });

    assert.equal(res.status, 201);
    assert.match(body.code, /^\d{6}$/);
    assert.match(body.qr, /^data:image\/png;base64,/);
    assert.ok(body.accessUrl.endsWith(`/access#code=${body.code}`));
    assert.ok(body.senderToken);

    const [doc] = fake.docs;
    assert.equal(doc.status, 'ACTIVE');
    assert.notEqual(doc.accessCode, body.code, 'access code must be stored hashed');
    assert.equal(doc.sha256, sha256(plain));
    assert.equal(doc.fileSize, plain.length);

    const onDisk = fs.readFileSync(path.join(filesDir, doc.storedName));
    assert.ok(!onDisk.includes(Buffer.from('top secret')), 'file on disk must be encrypted');
  });

  it('rejects blocked extensions, empty files, bad options and oversized files', async () => {
    assert.equal((await upload('x', { name: 'virus.exe' })).res.status, 400);
    assert.equal((await upload('', { name: 'empty.txt' })).res.status, 400);
    assert.equal((await upload('x', { expiresIn: '7d' })).res.status, 400);
    assert.equal((await upload('x', { maxDownloads: 0 })).res.status, 400);
    assert.equal((await upload('x', { password: 'abc' })).res.status, 400);

    const tooBig = await upload(Buffer.alloc(1024 * 1024 + 10), { name: 'big.bin' });
    assert.equal(tooBig.res.status, 413);

    assert.equal(fake.docs.length, 0);
    assert.equal(storedFiles().length, 0);
    assert.equal(fs.readdirSync(path.join(process.env.STORAGE_DIR, 'tmp')).length, 0, 'temp parts cleaned up');
  });

  it('sanitises path tricks in the file name', async () => {
    await upload('x', { name: '../../etc/passwd' });
    assert.equal(fake.docs[0].fileName, 'passwd');
  });
});

describe('access and download', () => {
  it('delivers the exact bytes once, then destroys the drop', async () => {
    const plain = crypto.randomBytes(200_000);
    const { created, accessed } = await readyDrop(plain, { name: 'data.bin', maxDownloads: 1 });

    assert.equal(accessed.fileName, 'data.bin');
    assert.equal(accessed.fileSize, plain.length);
    assert.equal(fake.docs[0].status, 'ACCESSED');

    const res = await download(accessed.dropId, accessed.ticket);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /^attachment;/);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const got = Buffer.from(await res.arrayBuffer());
    assert.equal(sha256(got), sha256(plain));

    // Destroyed: record, file and code are all gone.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(fake.docs.length, 0);
    assert.equal(storedFiles().length, 0);
    assert.equal((await access(created.code)).res.status, 404);
    assert.equal((await download(accessed.dropId, accessed.ticket)).status, 410);
  });

  it('honours a custom download limit', async () => {
    const { accessed } = await readyDrop('hello', { maxDownloads: 3 });
    for (let i = 0; i < 3; i += 1) {
      const res = await download(accessed.dropId, accessed.ticket);
      assert.equal(res.status, 200, `download ${i + 1}`);
      await res.arrayBuffer();
    }
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await download(accessed.dropId, accessed.ticket)).status, 410);
    assert.equal(fake.docs.length, 0);
  });

  it('lets exactly one of many simultaneous requests take the last download', async () => {
    const { accessed } = await readyDrop(crypto.randomBytes(50_000), { maxDownloads: 1 });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => download(accessed.dropId, accessed.ticket).then(async (r) => {
        await r.arrayBuffer();
        return r.status;
      })),
    );
    assert.equal(results.filter((s) => s === 200).length, 1, `statuses: ${results}`);
    assert.ok(results.every((s) => s === 200 || s === 410));
  });

  it('does not use up a download on HEAD requests', async () => {
    const { accessed } = await readyDrop('hello', { maxDownloads: 1 });
    const head = await download(accessed.dropId, accessed.ticket, { method: 'HEAD' });
    assert.equal(head.status, 405);
    assert.equal(fake.docs[0].currentDownloads, 0);
    assert.equal((await download(accessed.dropId, accessed.ticket)).status, 200);
  });

  it('rejects downloads without a valid ticket', async () => {
    const { accessed } = await readyDrop('hello');
    assert.equal((await download(accessed.dropId, 'nope')).status, 401);
    assert.equal((await download(accessed.dropId, accessed.ticket + 'x')).status, 401);
    assert.equal((await fetch(`${base}/api/drops/not-a-uuid/download`)).status, 404);
  });

  it('destroys a drop whose stored file was tampered with, without spending a download', async () => {
    const { accessed } = await readyDrop(crypto.randomBytes(5000), { maxDownloads: 2 });
    const file = path.join(filesDir, fake.docs[0].storedName);
    const bytes = fs.readFileSync(file);
    bytes[100] ^= 0xff;
    fs.writeFileSync(file, bytes);

    const res = await download(accessed.dropId, accessed.ticket);
    assert.equal(res.status, 422);
    assert.equal(fake.docs.length, 0);
    assert.equal(storedFiles().length, 0);
  });
});

describe('expiry and cleanup', () => {
  it('treats an expired drop as gone even before the cleanup job runs', async () => {
    const { created, accessed } = await readyDrop('hello');
    fake.docs[0].expiresAt = new Date(Date.now() - 1000);

    assert.equal((await download(accessed.dropId, accessed.ticket)).status, 410);
    assert.equal((await access(created.code)).res.status, 404);
    assert.equal(fake.docs.length, 1, 'still present until the cleanup job runs');
  });

  it('cleanup deletes the file and the record for expired and exhausted drops', async () => {
    await upload('one');
    await upload('two');
    await upload('three');
    fake.docs[0].expiresAt = new Date(Date.now() - 1000); // expired
    fake.docs[1].status = 'DOWNLOADED'; // limit reached
    assert.equal(storedFiles().length, 3);

    const destroyed = await runCleanup();
    assert.equal(destroyed, 2);
    assert.equal(fake.docs.length, 1);
    assert.equal(storedFiles().length, 1);
  });

  it('cleanup removes drops stuck in CREATED', async () => {
    await upload('x');
    fake.docs[0].status = 'CREATED';
    fake.docs[0].createdAt = new Date(Date.now() - 10 * 60_000);
    assert.equal(await runCleanup(), 1);
    assert.equal(storedFiles().length, 0);
  });

  it('sweeps encrypted files that no record points to', async () => {
    const orphan = path.join(filesDir, `${'a'.repeat(48)}.enc`);
    const fresh = path.join(filesDir, `${'b'.repeat(48)}.enc`);
    fs.writeFileSync(orphan, 'x');
    fs.writeFileSync(fresh, 'x');
    const old = new Date(Date.now() - 60 * 60_000);
    fs.utimesSync(orphan, old, old);

    assert.equal(await sweepOrphans(), 1);
    assert.ok(!fs.existsSync(orphan));
    assert.ok(fs.existsSync(fresh), 'recent files may belong to an in-flight upload');
  });
});

describe('brute-force protection', () => {
  it('blocks an IP after 5 wrong codes, even for the right code', async () => {
    const { body: created } = await upload('hello');
    const wrong = created.code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i += 1) assert.equal((await access(wrong)).res.status, 404);
    const blocked = await access(created.code);
    assert.equal(blocked.res.status, 429);
    assert.ok(blocked.body.retryAfterSeconds > 0);
    assert.ok(blocked.res.headers.get('retry-after'));
  });

  it('rejects malformed codes without crashing', async () => {
    assert.equal((await access('12ab56')).res.status, 400);
    assert.equal((await access(undefined)).res.status, 400);
  });
});

describe('password protection', () => {
  it('requires the password and locks the drop after repeated failures', async () => {
    const { body: created } = await upload('hello', { password: 'hunter22' });
    assert.equal(created.hasPassword, true);
    assert.notEqual(fake.docs[0].passwordHash, 'hunter22');

    const missing = await access(created.code);
    assert.equal(missing.res.status, 401);
    assert.equal(missing.body.passwordRequired, true);

    const wrong = await access(created.code, 'wrong-pass');
    assert.equal(wrong.res.status, 401);
    assert.equal(wrong.body.attemptsLeft, 4);

    const ok = await access(created.code, 'hunter22');
    assert.equal(ok.res.status, 200);
    assert.ok(ok.body.ticket);
  });

  it('locks the drop after too many wrong passwords', async () => {
    const { body: created } = await upload('hello', { password: 'hunter22' });
    for (let i = 0; i < 4; i += 1) assert.equal((await access(created.code, 'bad-pass')).res.status, 401);
    assert.equal((await access(created.code, 'bad-pass')).res.status, 429);

    ipAttempts.reset(); // a different IP still hits the per-drop lock
    assert.equal((await access(created.code, 'hunter22')).res.status, 429);
  });
});

describe('sender status and live updates', () => {
  it('status needs the sender token', async () => {
    const { body: created } = await upload('hello', { maxDownloads: 2 });
    const url = `${base}/api/drops/${created.dropId}/status`;

    assert.equal((await fetch(url)).status, 404);
    assert.equal((await fetch(url, { headers: { 'x-sender-token': 'wrong' } })).status, 404);

    const ok = await fetch(url, { headers: { 'x-sender-token': created.senderToken } });
    assert.equal(ok.status, 200);
    const view = await ok.json();
    assert.equal(view.status, 'ACTIVE');
    assert.equal(view.maxDownloads, 2);
  });

  it('pushes accessed, downloaded and destroyed events over WebSocket', async () => {
    const { body: created } = await upload('hello', { maxDownloads: 1 });
    const events = [];
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
    const waitFor = (type) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 3000);
        const check = () => {
          const found = events.find((e) => e.type === type);
          if (found) { clearTimeout(timer); resolve(found); } else setTimeout(check, 10);
        };
        check();
      });
    socket.on('message', (raw) => events.push(JSON.parse(raw.toString())));
    await new Promise((resolve) => socket.on('open', resolve));
    socket.send(JSON.stringify({ type: 'auth', dropId: created.dropId, token: created.senderToken }));

    const snapshot = await waitFor('snapshot');
    assert.equal(snapshot.status, 'ACTIVE');

    const { body: accessed } = await access(created.code);
    await waitFor('accessed');

    const res = await download(accessed.dropId, accessed.ticket);
    await res.arrayBuffer();
    const downloaded = await waitFor('downloaded');
    assert.equal(downloaded.currentDownloads, 1);
    const destroyed = await waitFor('destroyed');
    assert.equal(destroyed.reason, 'download_limit');
    socket.close();
  });

  it('closes sockets that present a wrong token', async () => {
    const { body: created } = await upload('hello');
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
    await new Promise((resolve) => socket.on('open', resolve));
    socket.send(JSON.stringify({ type: 'auth', dropId: created.dropId, token: 'nope' }));
    const code = await new Promise((resolve) => socket.on('close', resolve));
    assert.equal(code, 4401);
  });
});
