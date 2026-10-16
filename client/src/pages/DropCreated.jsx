import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCard from '../components/QRCard.jsx';
import StatusTrail from '../components/StatusTrail.jsx';
import { Countdown, Fuse } from '../components/Countdown.jsx';
import { copyText, formatBytes, plural } from '../lib/format.js';
import { usePageTitle, useSenderStatus } from '../lib/hooks.js';
import { sentDrop } from '../lib/session.js';

export default function DropCreated() {
  usePageTitle('Your drop');
  const { id } = useParams();
  const drop = useMemo(() => sentDrop.get(id), [id]);
  const [status, markExpired] = useSenderStatus(drop);
  const [copied, setCopied] = useState(false);

  // Once the drop is gone, forget the code and token held in this tab.
  useEffect(() => {
    if (status.destroyed) sentDrop.clear(id);
  }, [status.destroyed, id]);

  if (!drop) {
    return (
      <div className="max-w-xl">
        <h1 className="text-4xl font-semibold tracking-tight">This drop is not available here</h1>
        <p className="mt-3 text-slate">
          The code is only kept in the tab where the drop was created, and it is gone once the drop is
          deleted. Send the file again to get a new code.
        </p>
        <Link to="/" className="mt-6 inline-block font-semibold text-signal underline underline-offset-4">
          Send a file
        </Link>
      </div>
    );
  }

  const totalMs = new Date(drop.expiresAt).getTime() - drop.createdAt;
  const gone = status.destroyed;
  const reasonText = {
    download_limit: 'Every download has been used, so the file and code are deleted.',
    expired: 'The time ran out, so the file and code are deleted.',
  }[status.reason] ?? 'The file and code are deleted.';

  const steps = [
    { label: 'Waiting for the receiver', detail: 'Share the code or QR code below.' },
    { label: 'Receiver entered the code' },
    {
      label: 'Downloaded',
      detail: `${status.downloads} of ${plural(drop.maxDownloads, 'download')} used`,
    },
    { label: 'Deleted', detail: reasonText },
  ];
  const current = gone ? 3 : status.downloads > 0 ? 2 : status.accessed ? 1 : 0;

  const copyCode = async () => {
    if (await copyText(drop.code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_auto] lg:gap-20">
      <section>
        <p className="text-slate">
          <span className="break-all font-semibold text-ink">{drop.fileName}</span> · {formatBytes(drop.fileSize)} ·{' '}
          {plural(drop.maxDownloads, 'download')}
        </p>

        <h1 className="mt-6 text-sm font-semibold text-slate">Access code</h1>
        <div
          className="mt-1 flex gap-1 font-mono text-6xl font-medium tracking-tight sm:text-8xl"
          role="text"
          aria-label={gone ? 'Access code deleted' : `Access code ${drop.code.split('').join(' ')}`}
        >
          {drop.code.split('').map((digit, i) => (
            <span key={i} style={{ '--i': i }} className={gone ? 'digit-gone' : ''} aria-hidden="true">
              {digit}
            </span>
          ))}
        </div>

        <div className="mt-6 max-w-xl">
          <Fuse expiresAt={drop.expiresAt} totalMs={totalMs} gone={gone} />
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-slate">
              {gone ? 'Deleted' : 'Deletes in'}{' '}
              {!gone && <Countdown expiresAt={drop.expiresAt} onExpire={markExpired} className="text-xl font-medium text-ink" />}
            </p>
            {!gone && (
              <button
                type="button"
                onClick={copyCode}
                className="text-sm font-semibold text-signal underline underline-offset-4"
              >
                {copied ? 'Code copied' : 'Copy code'}
              </button>
            )}
          </div>
          {drop.hasPassword && !gone && (
            <p className="mt-3 text-sm text-slate">The receiver also needs the password you set.</p>
          )}
        </div>

        <div className="mt-10 max-w-xl" aria-live="polite">
          <StatusTrail steps={steps} current={current} />
        </div>

        {gone && (
          <Link
            to="/"
            className="mt-10 inline-block rounded-lg bg-signal px-5 py-3 font-semibold text-white transition-colors hover:bg-signal-deep"
          >
            Send another file
          </Link>
        )}
      </section>

      <aside aria-label="QR code" className="lg:pt-10">
        <QRCard qr={drop.qr} accessUrl={drop.accessUrl} disabled={gone} />
      </aside>
    </div>
  );
}
