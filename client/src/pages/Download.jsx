import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Countdown, Fuse } from '../components/Countdown.jsx';
import { downloadUrl } from '../lib/api.js';
import { formatBytes, plural } from '../lib/format.js';
import { useNow, usePageTitle } from '../lib/hooks.js';
import { receivedDrop } from '../lib/session.js';

export default function Download() {
  usePageTitle('Download');
  const { id } = useParams();
  const drop = useMemo(() => receivedDrop.get(id), [id]);
  const now = useNow();
  const [started, setStarted] = useState(false);
  const [expired, setExpired] = useState(false);
  // The receiver does not know the original duration, so the fuse starts full when this page opens.
  const [totalMs] = useState(() => Math.max(1, new Date(drop?.expiresAt ?? 0).getTime() - Date.now()));

  // The page was reloaded or opened directly: the download ticket lives only in this tab.
  if (!drop) return <Navigate to="/access" replace />;

  const ticketExpired = new Date(drop.ticketExpiresAt).getTime() <= now;
  const unavailable = expired || ticketExpired;
  const onlyOne = drop.downloadsLeft === 1;

  return (
    <div className="max-w-xl">
      <h1 className="text-sm font-semibold text-slate">File ready</h1>
      <p className="mt-2 break-all text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{drop.fileName}</p>
      <p className="mt-3 text-lg text-slate">
        {formatBytes(drop.fileSize)} · {plural(drop.downloadsLeft, 'download')} left
      </p>

      <div className="mt-8">
        <Fuse expiresAt={drop.expiresAt} totalMs={totalMs} gone={expired} />
        <p className="mt-3 text-slate">
          Deletes in{' '}
          <Countdown expiresAt={drop.expiresAt} onExpire={() => setExpired(true)} className="text-xl font-medium text-ink" />
        </p>
      </div>

      {unavailable ? (
        <div className="mt-10" role="alert">
          <p className="font-semibold">
            {expired ? 'This drop has expired and the file is deleted.' : 'Your download link timed out.'}
          </p>
          {!expired && <p className="mt-1 text-slate">Enter the code again to get a fresh link.</p>}
          <Link
            to="/access"
            className="mt-5 inline-block rounded-lg bg-signal px-5 py-3 font-semibold text-white transition-colors hover:bg-signal-deep"
          >
            Enter a code
          </Link>
        </div>
      ) : (
        <div className="mt-10">
          <a
            href={downloadUrl(drop.dropId, drop.ticket)}
            download={drop.fileName}
            onClick={() => setStarted(true)}
            className="inline-block rounded-lg bg-signal px-7 py-4 text-lg font-semibold text-white transition-colors hover:bg-signal-deep"
          >
            Download file
          </a>
          <p className="mt-4 text-sm text-slate" aria-live="polite">
            {started
              ? onlyOne
                ? 'Your download has started. It was the only one allowed, so the file is deleted as soon as the transfer finishes.'
                : 'Your download has started. If nothing arrives, check your browser’s downloads list before trying again.'
              : onlyOne
                ? 'You can download this file once. It is deleted as soon as the transfer finishes.'
                : 'The file is deleted when the time runs out or the last download finishes.'}
          </p>
        </div>
      )}
    </div>
  );
}
