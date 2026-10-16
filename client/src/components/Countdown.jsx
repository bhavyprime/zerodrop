import { useEffect } from 'react';
import { formatClock } from '../lib/format.js';
import { useNow } from '../lib/hooks.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function Countdown({ expiresAt, onExpire, className = '' }) {
  const now = useNow();
  const left = Math.max(0, new Date(expiresAt).getTime() - now);

  useEffect(() => {
    if (left === 0) onExpire?.();
  }, [left, onExpire]);

  const tone = left < 60_000 ? 'text-ember' : left < 5 * 60_000 ? 'text-amber' : '';
  return (
    <time role="timer" className={`font-mono tabular-nums ${tone} ${className}`}>
      {formatClock(left)}
    </time>
  );
}

/** A thin line that burns down as the drop's time runs out. */
export function Fuse({ expiresAt, totalMs, gone = false }) {
  const now = useNow();
  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  const fraction = gone ? 0 : clamp(left / totalMs, 0, 1);
  const color = fraction < 0.1 ? 'bg-ember' : fraction < 0.25 ? 'bg-amber' : 'bg-signal';

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
      <div
        className={`h-full rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none ${color}`}
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  );
}
