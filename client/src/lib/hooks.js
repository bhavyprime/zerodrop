import { useEffect, useState } from 'react';
import { getSenderStatus } from './api.js';

export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Zero Drop` : 'Zero Drop';
  }, [title]);
}

/** Current time, refreshed every second. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const INITIAL = { accessed: false, downloads: 0, destroyed: false, reason: null };

/**
 * Follows a drop from the sender's side: WebSocket for instant updates, plus a slow poll as a
 * fallback if the socket is blocked or drops. A 404 from the status endpoint means it is gone.
 */
export function useSenderStatus(drop) {
  const [state, setState] = useState(INITIAL);
  const dropId = drop?.dropId;
  const token = drop?.senderToken;

  useEffect(() => {
    if (!dropId || !token) return undefined;

    let stopped = false;
    let socket = null;
    let retryTimer = null;
    let pollTimer = null;

    const apply = (e) =>
      setState((s) => {
        if (s.destroyed) return s;
        switch (e.type) {
          case 'snapshot':
            return {
              ...s,
              accessed: s.accessed || e.status === 'ACCESSED' || e.status === 'DOWNLOADED' || e.currentDownloads > 0,
              downloads: Math.max(s.downloads, e.currentDownloads ?? 0),
            };
          case 'accessed':
            return { ...s, accessed: true };
          case 'downloaded':
            return { ...s, accessed: true, downloads: Math.max(s.downloads, e.currentDownloads) };
          case 'destroyed':
            return { ...s, destroyed: true, reason: e.reason ?? 'unknown' };
          default:
            return s;
        }
      });

    const connect = () => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${window.location.host}/ws`);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', dropId, token }));
      socket.onmessage = (msg) => {
        try {
          apply(JSON.parse(msg.data));
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
        if (!stopped) retryTimer = setTimeout(connect, 3000);
      };
    };

    const poll = async () => {
      try {
        const view = await getSenderStatus(dropId, token);
        apply({ type: 'snapshot', ...view });
      } catch (err) {
        if (err.status === 404) apply({ type: 'destroyed', reason: 'unknown' });
      }
      if (!stopped) pollTimer = setTimeout(poll, 10_000);
    };

    connect();
    pollTimer = setTimeout(poll, 2000);

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(pollTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [dropId, token]);

  return [state, () => setState((s) => (s.destroyed ? s : { ...s, destroyed: true, reason: 'expired' }))];
}
