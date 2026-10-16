/** Where the drop is right now, from the sender's point of view. */
export default function StatusTrail({ steps, current }) {
  return (
    <ol className="space-y-3" aria-label="Drop progress">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={step.label}
            aria-current={active ? 'step' : undefined}
            className={`flex items-start gap-3 ${done || active ? 'text-ink' : 'text-slate/70'}`}
          >
            <span
              aria-hidden="true"
              className={`mt-1.5 size-3 shrink-0 rounded-full border-2 ${
                done ? 'border-signal bg-signal' : active ? 'border-signal bg-signal-wash' : 'border-line'
              }`}
            />
            <span>
              <span className={active ? 'font-semibold' : ''}>{step.label}</span>
              {active && step.detail ? <span className="block text-sm text-slate">{step.detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
