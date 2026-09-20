'use client';

import { LevelMeter, Panel, formatClock } from './ui';
import type { Metrics, PersonaCard } from '@/lib/types';

const TACTIC_COPY: Record<string, string> = {
  exit_intent: 'CALLER DISENGAGING — deploying hook',
  suspicion: 'COVER PROBED — deflecting',
  payment_pressure: 'PAYMENT PUSH — harvesting rail',
  stalled: 'LOOP DETECTED — changing subject',
  long_silence: 'DEAD AIR — filling',
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
  const cost = metrics?.costDestroyed ?? 0;
  const shielded = metrics?.victimsShielded ?? 0;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {/* ── the hero number ── */}
      <Panel title="Scammer time wasted" bodyClass="px-3 py-3">
        <div
          className={`tnum text-[56px] leading-none font-bold tracking-tight ${live ? 'text-phos glow-phos' : 'text-dimmer'}`}
        >
          {formatClock(seconds)}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat
            label="Operating cost destroyed"
            value={`$${cost.toFixed(2)}`}
            tone="text-amber"
          />
          <Stat
            label="Victim calls displaced"
            value={shielded.toFixed(2)}
            tone="text-info"
          />
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <Stat small label="Turns" value={String(metrics?.turns ?? 0)} />
          <Stat small label="Interrupts" value={String(metrics?.interruptions ?? 0)} />
          <Stat small label="Artifacts" value={String(metrics?.intelCount ?? 0)} />
        </div>
      </Panel>

      {/* ── live audio ── */}
      <Panel title="Audio bridge" bodyClass="space-y-2 px-3 py-3">
        <LevelMeter label="in" level={inputLevel} color="var(--color-info)" />
        <LevelMeter label="out" level={outputLevel} color="var(--color-phos)" />
        <div className="flex items-center gap-2 pt-1 text-[11px] text-dim">
          <span
            className={`h-1.5 w-1.5 rounded-full ${agentSpeaking ? 'bg-phos pulse-ring' : 'bg-dimmer'}`}
          />
          {agentSpeaking ? 'persona speaking' : live ? 'listening' : 'idle'}
        </div>
      </Panel>

      {/* ── active persona ── */}
      {persona && (
        <Panel title="Deployed persona" bodyClass="px-3 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold" style={{ color: persona.color }}>
              {persona.name}
            </span>
            <span className="text-[11px] text-dim">{persona.age}</span>
          </div>
          <p className="mt-1 text-[12px] leading-snug text-dim">{persona.tagline}</p>
          <p className="mt-2 text-[10px] tracking-wider text-dimmer uppercase">{persona.accent}</p>
        </Panel>
      )}

      {/* ── live tactic readout ── */}
      <Panel title="Tactical state" bodyClass="px-3 py-3">
        {signals.length === 0 ? (
          <p className="text-[12px] text-dimmer">nominal — maintaining engagement</p>
        ) : (
          <ul className="space-y-1">
            {signals.map((s) => (
              <li key={s} className="flex items-center gap-2 text-[12px] text-amber">
                <span className="blink">▸</span>
                {TACTIC_COPY[s] || s}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'text-ink',
  small = false,
}: {
  label: string;
  value: string;
  tone?: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-sm border border-edge bg-void/50 px-2 py-1.5">
      <div className="label leading-tight">{label}</div>
      <div className={`tnum font-bold ${tone} ${small ? 'text-sm' : 'text-lg'}`}>{value}</div>
    </div>
  );
}
