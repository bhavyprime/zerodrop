import { useRef } from 'react';

const LENGTH = 6;

/** Six single-digit boxes that behave like one field: typing, backspace, arrows and paste. */
export default function CodeInput({ value, onChange, disabled, autoFocus }) {
  const refs = useRef([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '');

  const setValue = (next) => onChange(next.replace(/\D/g, '').slice(0, LENGTH));
  const focus = (i) => refs.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();

  const handleInput = (i, e) => {
    const typed = e.target.value.replace(/\D/g, '');
    if (!typed) return;
    const next = digits.slice();
    // Several characters at once (autofill, fast typing) fill the following boxes.
    typed.split('').forEach((d, k) => {
      if (i + k < LENGTH) next[i + k] = d;
    });
    setValue(next.join(''));
    focus(i + typed.length);
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = digits.slice();
      if (next[i]) {
        next[i] = '';
        setValue(next.join(''));
      } else if (i > 0) {
        next[i - 1] = '';
        setValue(next.join(''));
        focus(i - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focus(i + 1);
    }
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    if (!pasted) return;
    e.preventDefault();
    setValue(pasted);
    focus(pasted.length >= LENGTH ? LENGTH - 1 : pasted.length);
  };

  return (
    <div role="group" aria-label="6-digit access code" className="flex gap-2 sm:gap-3">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digit}
          onChange={(e) => handleInput(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && i === 0}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${LENGTH}`}
          className="h-16 w-full min-w-0 rounded-lg border-2 border-line bg-paper text-center font-mono text-3xl font-medium text-ink transition-colors focus:border-signal focus:outline-none focus-visible:ring-4 focus-visible:ring-signal/25 disabled:opacity-60 sm:h-20 sm:text-4xl"
        />
      ))}
    </div>
  );
}
