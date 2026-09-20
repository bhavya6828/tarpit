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
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          {right}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Dot({ on, color = 'var(--color-positive)' }: { on: boolean; color?: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: on ? color : 'var(--color-faint)' }}
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
    dim: 'border-border bg-surface-subtle text-muted',
    phos: 'border-positive/20 bg-positive-soft text-positive',
    crit: 'border-danger/20 bg-danger-soft text-danger',
    amber: 'border-warning/20 bg-warning-soft text-warning',
    info: 'border-info/20 bg-info-soft text-info',
  };

  return (
    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.08em] uppercase ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function LevelMeter({ level, color, label }: { level: number; color: string; label: string }) {
  const bars = 12;
  const lit = Math.min(bars, Math.round(Math.pow(Math.min(1, level * 1.6), 0.6) * bars));

  return (
    <div className="flex items-center gap-3">
      <span className="label w-12 shrink-0">{label}</span>
      <div className="flex flex-1 gap-1" aria-label={`${label} audio level`}>
        {Array.from({ length: bars }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors duration-75"
            style={{ background: i < lit ? color : 'var(--color-border)' }}
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
