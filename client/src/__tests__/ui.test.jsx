import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError } from '../lib/api.js';

vi.mock('../lib/api.js', async (orig) => {
  const real = await orig();
  return {
    ...real,
    getLimits: vi.fn(async () => ({ maxFileMb: 50, maxDownloads: 100 })),
    createDrop: vi.fn(),
    accessDrop: vi.fn(),
    getSenderStatus: vi.fn(async () => new Promise(() => {})), // never resolves; the socket drives tests
  };
});

const api = await import('../lib/api.js');
const { default: Upload } = await import('../pages/Upload.jsx');
const { default: DropCreated } = await import('../pages/DropCreated.jsx');
const { default: Access } = await import('../pages/Access.jsx');
const { default: Download } = await import('../pages/Download.jsx');
const { default: CodeInput } = await import('../components/CodeInput.jsx');
const { sentDrop, receivedDrop } = await import('../lib/session.js');

class FakeWS {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    FakeWS.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  send(d) { this.sent.push(JSON.parse(d)); }
  close() {}
  emit(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;

function app(initial) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/" element={<Upload />} />
        <Route path="/created/:id" element={<DropCreated />} />
        <Route path="/access" element={<Access />} />
        <Route path="/download/:id" element={<Download />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const futureIso = (ms) => new Date(Date.now() + ms).toISOString();
const sent = (over = {}) => ({
  dropId: 'd1d1d1d1-0000-4000-8000-000000000001',
  code: '482915',
  senderToken: 'tok',
  fileName: 'report.pdf',
  fileSize: 2048,
  expiresAt: futureIso(10 * 60_000),
  maxDownloads: 1,
  hasPassword: false,
  qr: 'data:image/png;base64,AAAA',
  accessUrl: 'http://localhost/access#code=482915',
  createdAt: Date.now(),
  ...over,
});

beforeEach(() => {
  sessionStorage.clear();
  FakeWS.instances = [];
  vi.stubGlobal('WebSocket', FakeWS);
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

describe('CodeInput', () => {
  it('fills from a pasted code and deletes with backspace', async () => {
    const user = userEvent.setup();
    let value = '';
    const { rerender } = render(<CodeInput value={value} onChange={(v) => (value = v)} />);
    const boxes = screen.getAllByRole('textbox');
    expect(boxes).toHaveLength(6);

    await user.click(boxes[0]);
    await user.paste('48 29-15');
    expect(value).toBe('482915');

    rerender(<CodeInput value="482915" onChange={(v) => (value = v)} />);
    await user.click(screen.getAllByRole('textbox')[5]);
    await user.keyboard('{Backspace}');
    expect(value).toBe('48291');
  });
});

describe('send flow', () => {
  it('uploads a file and lands on the created page showing the code', async () => {
    const drop = sent();
    api.createDrop.mockResolvedValue(drop);
    const user = userEvent.setup();
    app('/');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Share once\.\s*Disappear forever\./);
    await user.click(screen.getByRole('button', { name: /create drop/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/choose a file/i);

    const file = new File(['hello'], 'report.pdf', { type: 'application/pdf' });
    await user.upload(document.querySelector('input[type=file]'), file);
    await user.click(screen.getByLabelText('24 hours'));
    await user.click(screen.getByLabelText('A set number'));
    await user.clear(screen.getByLabelText('Number of downloads'));
    await user.type(screen.getByLabelText('Number of downloads'), '3');
    await user.click(screen.getByRole('button', { name: /create drop/i }));

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/created/${drop.dropId}`));
    expect(api.createDrop.mock.calls[0][0]).toMatchObject({ expiresIn: '24h', maxDownloads: 3, password: '' });
    expect(screen.getByRole('timer')).toBeTruthy();
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByRole('img', { name: /qr code/i })).toBeTruthy();
  });

  it('rejects files over the size limit before uploading', async () => {
    const user = userEvent.setup();
    app('/');
    await waitFor(() => expect(api.getLimits).toHaveBeenCalled());
    const big = new File([new Uint8Array(10)], 'big.bin');
    Object.defineProperty(big, 'size', { value: 80 * 1024 * 1024 });
    await user.upload(document.querySelector('input[type=file]'), big);
    expect((await screen.findByRole('alert')).textContent).toMatch(/limit is 50 MB/);
    expect(api.createDrop).not.toHaveBeenCalled();
  });

  it('shows server errors from the upload', async () => {
    api.createDrop.mockRejectedValue(new ApiError(400, { error: 'Files of type .exe are not allowed.' }));
    const user = userEvent.setup();
    app('/');
    await user.upload(document.querySelector('input[type=file]'), new File(['x'], 'a.txt'));
    await user.click(screen.getByRole('button', { name: /create drop/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not allowed/);
  });
});

describe('created page', () => {
  it('follows the drop over WebSocket and dissolves the code when it is destroyed', async () => {
    const drop = sent({ maxDownloads: 2 });
    sentDrop.set(drop.dropId, drop);
    app(`/created/${drop.dropId}`);

    await waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    await waitFor(() => expect(FakeWS.instances[0].sent[0]).toEqual({ type: 'auth', dropId: drop.dropId, token: 'tok' }));
    const ws = FakeWS.instances[0];
    const digits = () => [...document.querySelectorAll('[style*="--i"]')];
    expect(digits().map((d) => d.textContent).join('')).toBe('482915');
    expect(digits().some((d) => d.classList.contains('digit-gone'))).toBe(false);

    act(() => ws.emit({ type: 'accessed', dropId: drop.dropId }));
    expect(screen.getByText('Receiver entered the code').closest('li').getAttribute('aria-current')).toBe('step');

    act(() => ws.emit({ type: 'downloaded', dropId: drop.dropId, currentDownloads: 1, maxDownloads: 2 }));
    expect(screen.getByText(/1 of 2 downloads used/)).toBeTruthy();

    act(() => ws.emit({ type: 'destroyed', dropId: drop.dropId, reason: 'download_limit' }));
    expect(digits().every((d) => d.classList.contains('digit-gone'))).toBe(true);
    expect(screen.getByText(/every download has been used/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /send another file/i })).toBeTruthy();
    expect(sentDrop.get(drop.dropId)).toBeNull(); // code forgotten once the drop is gone
  });

  it('explains when the drop is not available in this tab', () => {
    app('/created/unknown-id');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/not available here/i);
  });
});

describe('receive flow', () => {
  const accessResult = {
    dropId: 'd2d2d2d2-0000-4000-8000-000000000002',
    fileName: 'photo.zip',
    fileSize: 5_000_000,
    expiresAt: futureIso(30 * 60_000),
    downloadsLeft: 1,
    ticket: 'abc.def',
    ticketExpiresAt: futureIso(10 * 60_000),
  };

  it('submits a typed code and moves to the download page', async () => {
    api.accessDrop.mockResolvedValue(accessResult);
    const user = userEvent.setup();
    app('/access');
    await user.click(screen.getAllByRole('textbox')[0]);
    await user.keyboard('482915');
    await user.click(screen.getByRole('button', { name: /find file/i }));

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/download/${accessResult.dropId}`));
    expect(api.accessDrop).toHaveBeenCalledWith('482915', '');
    expect(screen.getByText('photo.zip')).toBeTruthy();
    const link = screen.getByRole('link', { name: /download file/i });
    expect(link.getAttribute('href')).toBe(`/api/drops/${accessResult.dropId}/download?ticket=abc.def`);
    expect(screen.getByText(/download this file once/i)).toBeTruthy();

    link.addEventListener('click', (e) => e.preventDefault()); // jsdom cannot navigate
    fireEvent.click(link);
    expect(await screen.findByText(/your download has started/i)).toBeTruthy();
  });

  it('asks for a password when the server requires one', async () => {
    api.accessDrop
      .mockRejectedValueOnce(new ApiError(401, { error: 'This drop is password protected.', passwordRequired: true }))
      .mockResolvedValueOnce(accessResult);
    const user = userEvent.setup();
    app('/access');
    await user.click(screen.getAllByRole('textbox')[0]);
    await user.keyboard('482915');
    await user.click(screen.getByRole('button', { name: /find file/i }));

    const pw = await screen.findByLabelText(/needs a password/i);
    await user.type(pw, 'hunter22');
    await user.click(screen.getByRole('button', { name: /find file/i }));
    await waitFor(() => expect(api.accessDrop).toHaveBeenLastCalledWith('482915', 'hunter22'));
  });

  it('shows rate-limit and not-found errors', async () => {
    api.accessDrop.mockRejectedValue(new ApiError(404, { error: 'That code is invalid or the drop is gone.' }));
    const user = userEvent.setup();
    app('/access');
    await user.click(screen.getAllByRole('textbox')[0]);
    await user.keyboard('111111');
    await user.click(screen.getByRole('button', { name: /find file/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid or the drop is gone/);
  });

  it('requires all six digits', async () => {
    const user = userEvent.setup();
    app('/access');
    await user.click(screen.getAllByRole('textbox')[0]);
    await user.keyboard('123');
    await user.click(screen.getByRole('button', { name: /find file/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/all 6 digits/);
    expect(api.accessDrop).not.toHaveBeenCalled();
  });

  it('uses a code from the URL fragment once and removes it from the address bar', async () => {
    api.accessDrop.mockResolvedValue(accessResult);
    window.history.replaceState(null, '', '/access#code=482915');
    app('/access');
    await waitFor(() => expect(api.accessDrop).toHaveBeenCalledWith('482915', ''));
    expect(window.location.hash).toBe('');
    expect(api.accessDrop).toHaveBeenCalledTimes(1);
  });

  it('download page sends people without a ticket back to the code screen', () => {
    app('/download/never-accessed');
    expect(screen.getByTestId('where').textContent).toBe('/access');
  });

  it('download page offers a fresh code once the ticket has timed out', () => {
    receivedDrop.set(accessResult.dropId, { ...accessResult, ticketExpiresAt: new Date(Date.now() - 1000).toISOString() });
    app(`/download/${accessResult.dropId}`);
    expect(screen.queryByRole('link', { name: /download file/i })).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/timed out/i);
  });
});
