import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CodeInput from '../components/CodeInput.jsx';
import { accessDrop } from '../lib/api.js';
import { usePageTitle } from '../lib/hooks.js';
import { receivedDrop } from '../lib/session.js';

function readCodeFromHash() {
  const match = /(?:^#|&)code=(\d{6})(?:&|$)/.exec(window.location.hash);
  return match ? match[1] : '';
}

export default function Access() {
  usePageTitle('Receive a file');
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const passwordRef = useRef(null);
  const submitted = useRef(false);

  const submit = async (nextCode = code, nextPassword = password) => {
    setError('');
    if (!/^\d{6}$/.test(nextCode)) return setError('Enter all 6 digits of the code.');
    if (needsPassword && !nextPassword) return setError('Enter the password.');

    setBusy(true);
    try {
      const drop = await accessDrop(nextCode, nextPassword);
      receivedDrop.set(drop.dropId, drop);
      navigate(`/download/${drop.dropId}`, { replace: true });
    } catch (err) {
      setBusy(false);
      if (err.data?.passwordRequired) {
        setNeedsPassword(true);
        setTimeout(() => passwordRef.current?.focus(), 0);
        setError(err.status === 401 && nextPassword ? err.message : '');
      } else {
        setError(err.message);
      }
    }
  };

  // A scanned QR code opens /access#code=123456. Use it once, then take it out of the address bar.
  useEffect(() => {
    const fromHash = readCodeFromHash();
    if (!fromHash || submitted.current) return;
    submitted.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    setCode(fromHash);
    submit(fromHash, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-xl">
      <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Receive a file</h1>
      <p className="mt-4 text-lg text-slate">Enter the 6-digit code you were given, or scan the sender&apos;s QR code.</p>

      <form
        className="mt-8 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <CodeInput
          value={code}
          onChange={(next) => {
            setCode(next);
            if (error) setError('');
          }}
          disabled={busy}
          autoFocus
        />

        {needsPassword && (
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-semibold">
              This drop also needs a password
            </label>
            <input
              id="password"
              ref={passwordRef}
              type="password"
              autoComplete="off"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border-2 border-line bg-paper px-3 py-3"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-ember/10 px-4 py-3 text-sm font-medium text-ember">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-signal px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-signal-deep disabled:opacity-70"
        >
          {busy ? 'Checking…' : 'Find file'}
        </button>
      </form>
    </div>
  );
}
