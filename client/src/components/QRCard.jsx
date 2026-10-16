import { useState } from 'react';
import { copyText } from '../lib/format.js';

export default function QRCard({ qr, accessUrl, disabled }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (await copyText(accessUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="w-full max-w-60">
      <div className={`rounded-xl border border-line bg-white p-3 ${disabled ? 'opacity-30 grayscale' : ''}`}>
        <img
          src={qr}
          alt="QR code that opens the receive page with the access code filled in"
          width="320"
          height="320"
          className="block h-auto w-full"
        />
      </div>
      <button
        type="button"
        onClick={copy}
        disabled={disabled}
        className="mt-3 text-sm font-semibold text-signal underline underline-offset-4 disabled:pointer-events-none disabled:opacity-40"
      >
        {copied ? 'Link copied' : 'Copy link'}
      </button>
    </div>
  );
}
