import { useId, useState } from 'react';
import { formatBytes } from '../lib/format.js';

export default function DropZone({ file, onFile, disabled, maxMb }) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  const take = (files) => {
    if (disabled || !files?.length) return;
    onFile(files[0]);
  };

  return (
    <div>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files);
        }}
        className={`flex min-h-44 cursor-pointer flex-col justify-center rounded-xl border-2 border-dashed px-6 py-8 transition-colors focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-signal ${
          dragging ? 'border-signal bg-signal-wash' : file ? 'border-signal bg-paper' : 'border-line bg-paper hover:border-slate'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <input
          id={inputId}
          type="file"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
        />
        {file ? (
          <>
            <span className="break-all text-xl font-semibold leading-snug">{file.name}</span>
            <span className="mt-1 text-slate">{formatBytes(file.size)}</span>
            <span className="mt-4 text-sm font-semibold text-signal underline underline-offset-4">
              Choose a different file
            </span>
          </>
        ) : (
          <>
            <span className="text-xl font-semibold leading-snug">Drop a file here, or choose one</span>
            <span className="mt-1 text-slate">
              Documents, images, ZIP archives and more{maxMb ? `, up to ${maxMb} MB` : ''}.
            </span>
          </>
        )}
      </label>
    </div>
  );
}
