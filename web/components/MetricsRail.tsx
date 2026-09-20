'use client';

import { LevelMeter, Panel, formatClock } from './ui';
import type { Metrics, PersonaCard } from '@/lib/types';

const TACTIC_COPY: Record<string, string> = {
  exit_intent: 'Caller may leave. Deploying a stronger hook.',
  suspicion: 'Caller questioned the cover. Deflecting.',
  payment_pressure: 'Payment pressure detected. Confirming the rail.',
  stalled: 'Conversation stalled. Changing subject.',
  long_silence: 'Long silence detected. Filling the gap.',
};

export default function MetricsRail({
  metrics,
  persona,
  live,
  agentSpeaking,
  inputLevel,
  outputLevel,
  signals,
}: {
  metrics: Metrics | null;
  persona: PersonaCard | null;
  live: boolean;
  agentSpeaking: boolean;
  inputLevel: number;
  outputLevel: number;
  signals: string[];
}) {
  const seconds = metrics?.secondsWasted ?? 0;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* The one number a judge should be able to read from across the room. */}
      <Panel title="Engagement" bodyClass="p-4">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-danger live-ring' : 'bg-faint'}`} />
          <p className="label">{live ? 'Scammer time occupied' : 'Standing by'}</p>
        </div>
        <p className={`hero-metric mt-3 ${live ? 'text-accent glow-accent' : 'text-faint'}`}>
          {formatClock(seconds)}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="Cost disrupted" value={`$${(metrics?.costDestroyed ?? 0).toFixed(2)}`} tone="text-warning" />
          <Stat label="Calls displaced" value={(metrics?.victimsShielded ?? 0).toFixed(2)} tone="text-info" />
          <Stat label="Turns" value={String(metrics?.turns ?? 0)} />
          <Stat label="Evidence" value={String(metrics?.intelCount ?? 0)} tone="text-accent" />
        </div>
      </Panel>

      <Panel title="Audio" bodyClass="space-y-3 p-4">
        <LevelMeter label="Caller" level={inputLevel} color="var(--color-info)" />
        <LevelMeter label="Persona" level={outputLevel} color="var(--color-positive)" />
        <div className="flex items-center gap-2 border-t border-border pt-3 text-xs text-muted">
          <span className={`h-2 w-2 rounded-full ${agentSpeaking ? 'bg-positive quiet-pulse' : 'bg-faint'}`} />
          {agentSpeaking ? 'Persona is speaking' : live ? 'Listening for caller' : 'Audio is idle'}
        </div>
      </Panel>

      {persona && (
        <Panel title="Active persona" bodyClass="p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold" style={{ color: persona.color || 'var(--color-text)' }}>
              {persona.name}
            </span>
            <span className="text-xs text-muted">Age {persona.age}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">{persona.tagline}</p>
          <p className="mt-3 text-xs text-faint">{persona.accent}</p>
        </Panel>
      )}

      <Panel title="Tactic" bodyClass="p-4">
        {signals.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted">Maintaining the current conversation strategy.</p>
        ) : (
          <ul className="space-y-2">
            {signals.map((signal) => (
              <li key={signal} className="rounded-lg bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning">
                {TACTIC_COPY[signal] || signal}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Stat({ label, value, tone = 'text-text' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-canvas/60 px-3 py-2">
      <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">{label}</div>
      <div className={`tnum mt-1 text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
