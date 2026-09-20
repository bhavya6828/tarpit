'use client';

import React from 'react';

export function Panel({
  title,
  right,
  className = '',
  bodyClass = '',
  children,
}: {
  title?: string;
  right?: React.ReactNode;
  className?: string;
  bodyClass?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel flex min-h-0 flex-col ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-edge px-3 py-2">
          <h2 className="label">{title}</h2>
          {right}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Dot({ on, color = 'var(--color-phos)' }: { on: boolean; color?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{
        background: on ? color : 'var(--color-dimmer)',
        boxShadow: on ? `0 0 8px ${color}` : 'none',
      }}
    />
  );
}

export function Pill({
  children,
  tone = 'dim',
}: {
  children: React.ReactNode;
  tone?: 'dim' | 'phos' | 'crit' | 'amber' | 'info';
}) {
  const tones: Record<string, string> = {
    dim: 'border-edge text-dim',
    phos: 'border-phos/40 text-phos',
    crit: 'border-crit/40 text-crit',
    amber: 'border-amber/40 text-amber',
    info: 'border-info/40 text-info',
  };
  return (
    <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] tracking-wider uppercase ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Vertical bar meter — mic input and agent output. */
export function LevelMeter({ level, color, label }: { level: number; color: string; label: string }) {
  const bars = 22;
  const lit = Math.min(bars, Math.round(Math.pow(Math.min(1, level * 1.6), 0.6) * bars));
  return (
    <div className="flex items-center gap-2">
      <span className="label w-10 shrink-0">{label}</span>
      <div className="flex flex-1 gap-[2px]">
        {Array.from({ length: bars }).map((_, i) => (
          <span
            key={i}
            className="h-2.5 flex-1 rounded-[1px] transition-colors duration-75"
            style={{
              background: i < lit ? color : 'var(--color-edge)',
              boxShadow: i < lit ? `0 0 6px ${color}66` : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
