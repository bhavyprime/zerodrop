import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DropZone from '../components/DropZone.jsx';
import { createDrop, getLimits } from '../lib/api.js';
import { formatBytes } from '../lib/format.js';
import { usePageTitle } from '../lib/hooks.js';
import { sentDrop } from '../lib/session.js';

const EXPIRY = [
  { value: '10m', label: '10 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
];

const fieldLabel = 'mb-2 block text-sm font-semibold';
const radioLabel =
  'cursor-pointer rounded-lg border-2 border-line bg-paper px-4 py-2.5 text-center text-sm font-medium transition-colors hover:border-slate peer-checked:border-signal peer-checked:bg-signal-wash peer-checked:text-signal-deep peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal peer-disabled:opacity-60';

export default function Upload() {
  usePageTitle('Send a file');
  const navigate = useNavigate();

  const [limits, setLimits] = useState(null);
  const [file, setFile] = useState(null);
  const [expiresIn, setExpiresIn] = useState('1h');
  const [limitMode, setLimitMode] = useState('one');
  const [customLimit, setCustomLimit] = useState(3);
  const [passwordOn, setPasswordOn] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    getLimits().then(setLimits).catch(() => {});
  }, []);

  const maxDownloads = limitMode === 'one' ? 1 : Number(customLimit);

  const pickFile = (f) => {
    setError('');
    if (limits && f.size > limits.maxFileMb * 1024 * 1024) {
      setFile(null);
      setError(`${f.name} is ${formatBytes(f.size)}. The limit is ${limits.maxFileMb} MB.`);
      return;
    }
    setFile(f);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!file) return setError('Choose a file to send.');
    if (!Number.isInteger(maxDownloads) || maxDownloads < 1 || (limits && maxDownloads > limits.maxDownloads)) {
      return setError(`Set a download limit between 1 and ${limits?.maxDownloads ?? 100}.`);
    }
    if (passwordOn && password.length < 4) return setError('Use a password of at least 4 characters.');

    setBusy(true);
    setProgress(0);
    try {
      const drop = await createDrop(
        { file, expiresIn, maxDownloads, password: passwordOn ? password : '' },
        setProgress,
      );
      sentDrop.set(drop.dropId, { ...drop, createdAt: Date.now() });
      navigate(`/created/${drop.dropId}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_minmax(0,34rem)] lg:gap-16">
      <section className="lg:pt-6">
        <h1 className="text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
          Share once.
          <br />
          Disappear forever.
        </h1>
        <p className="mt-6 max-w-md text-lg leading-relaxed text-slate">
          Upload a file and get a 6-digit code and a QR code. The person you send it to needs no account.
          When the timer runs out or the last download finishes, the file and the code are deleted.
        </p>
        <ul className="mt-8 max-w-md space-y-2 border-l-2 border-signal pl-4 text-slate">
          <li>The file is encrypted on the server while it waits.</li>
          <li>The code is stored as a hash, never in the clear.</li>
          <li>Five wrong guesses lock the receiver out for a while.</li>
        </ul>
      </section>

      <form
        onSubmit={submit}
        noValidate
        className="space-y-6 rounded-xl border border-line bg-white p-5 sm:p-7"
        aria-busy={busy}
      >
        <DropZone file={file} onFile={pickFile} disabled={busy} maxMb={limits?.maxFileMb} />

        <fieldset disabled={busy}>
          <legend className={fieldLabel}>Delete after</legend>
          <div className="grid grid-cols-3 gap-2">
            {EXPIRY.map((o) => (
              <div key={o.value}>
                <input
                  type="radio"
                  name="expiry"
                  id={`exp-${o.value}`}
                  value={o.value}
                  checked={expiresIn === o.value}
                  onChange={() => setExpiresIn(o.value)}
                  className="peer sr-only"
                />
                <label htmlFor={`exp-${o.value}`} className={`block ${radioLabel}`}>
                  {o.label}
                </label>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={busy}>
          <legend className={fieldLabel}>Allow downloads</legend>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <input
                type="radio"
                name="limit"
                id="limit-one"
                checked={limitMode === 'one'}
                onChange={() => setLimitMode('one')}
                className="peer sr-only"
              />
              <label htmlFor="limit-one" className={`block ${radioLabel}`}>
                One time only
              </label>
            </div>
            <div>
              <input
                type="radio"
                name="limit"
                id="limit-custom"
                checked={limitMode === 'custom'}
                onChange={() => setLimitMode('custom')}
                className="peer sr-only"
              />
              <label htmlFor="limit-custom" className={`block ${radioLabel}`}>
                A set number
              </label>
            </div>
          </div>
          {limitMode === 'custom' && (
            <div className="mt-3 flex items-center gap-3">
              <label htmlFor="custom-limit" className="text-sm text-slate">
                Number of downloads
              </label>
              <input
                id="custom-limit"
                type="number"
                min="1"
                max={limits?.maxDownloads ?? 100}
                value={customLimit}
                onChange={(e) => setCustomLimit(e.target.value)}
                className="w-24 rounded-lg border-2 border-line bg-paper px-3 py-2 font-mono tabular-nums"
              />
            </div>
          )}
        </fieldset>

        <div>
          <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={passwordOn}
              disabled={busy}
              onChange={(e) => setPasswordOn(e.target.checked)}
              className="size-5 accent-signal"
            />
            Also ask for a password
          </label>
          {passwordOn && (
            <div className="mt-3">
              <label htmlFor="password" className="mb-1 block text-sm text-slate">
                Password (share it separately from the code)
              </label>
              <input
                id="password"
                type="text"
                autoComplete="off"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border-2 border-line bg-paper px-3 py-2.5"
              />
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-ember/10 px-4 py-3 text-sm font-medium text-ember">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-signal px-5 py-3.5 text-base font-semibold text-white transition-colors hover:bg-signal-deep disabled:opacity-70"
        >
          {busy ? (progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : 'Encrypting and saving…') : 'Create drop'}
        </button>
      </form>
    </div>
  );
}
