'use client';

import { useEffect, useRef, useState } from 'react';
import { Panel, Pill } from './ui';
import type { PersonaCard, TranscriptLine } from '@/lib/types';

export default function Transcript({
  lines,
  partial,
  agentLive,
  persona,
  live,
  onInject,
}: {
  lines: TranscriptLine[];
  partial: string;
  agentLive: string;
  persona: PersonaCard | null;
  live: boolean;
  onInject: (text: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, partial, agentLive]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !live) return;
    onInject(text);
    setDraft('');
  };

  return (
    <Panel
      title="Live engagement transcript"
      right={<Pill tone={live ? 'phos' : 'dim'}>{live ? 'recording' : 'standby'}</Pill>}
      className="min-h-0 flex-1"
      bodyClass="flex min-h-0 flex-col"
    >
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {lines.length === 0 && !partial && !agentLive && (
          <div className="pt-16 text-center">
            <p className="text-[13px] text-dimmer">no active engagement</p>
            <p className="mt-2 text-[11px] text-dimmer">
              arm a persona, then speak — or type below as the caller
            </p>
          </div>
        )}

        {lines.map((l) => (
          <Line key={l.id} line={l} persona={persona} />
        ))}

        {partial && (
          <Bubble speaker="scammer" name="CALLER" color="var(--color-crit)" faded>
            {partial}
          </Bubble>
        )}

        {agentLive && (
          <Bubble
            speaker="persona"
            name={(persona?.name || 'PERSONA').toUpperCase()}
            color={persona?.color || 'var(--color-phos)'}
          >
            <span className="caret">{agentLive}</span>
          </Bubble>
        )}
      </div>

      {/* Type-to-talk: dev convenience, and the demo's mic-failure escape hatch. */}
      <form onSubmit={submit} className="flex gap-2 border-t border-edge px-3 py-2">
        <span className="self-center text-[11px] text-dimmer">caller ▸</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!live}
          placeholder={live ? 'type as the scammer and press enter…' : 'engagement not armed'}
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-dimmer disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!live || !draft.trim()}
          className="rounded-sm border border-edge px-2 py-0.5 text-[10px] tracking-wider text-dim uppercase transition-colors hover:border-phos/50 hover:text-phos disabled:opacity-30 disabled:hover:border-edge disabled:hover:text-dim"
        >
          send
        </button>
      </form>
    </Panel>
  );
}

function Line({ line, persona }: { line: TranscriptLine; persona: PersonaCard | null }) {
  const isScammer = line.speaker === 'scammer';
  return (
    <Bubble
      speaker={line.speaker}
      name={isScammer ? 'CALLER' : (persona?.name || 'PERSONA').toUpperCase()}
      color={isScammer ? 'var(--color-crit)' : persona?.color || 'var(--color-phos)'}
      injected={line.injected}
    >
      {line.text}
    </Bubble>
  );
}

function Bubble({
  speaker,
  name,
  color,
  children,
  faded,
  injected,
}: {
  speaker: string;
  name: string;
  color: string;
  children: React.ReactNode;
  faded?: boolean;
  injected?: boolean;
}) {
  const isScammer = speaker === 'scammer';
  return (
    <div className={`flex ${isScammer ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[82%] ${faded ? 'opacity-55' : ''}`}>
        <div
          className={`mb-1 flex items-center gap-1.5 text-[10px] tracking-[0.16em] ${isScammer ? '' : 'justify-end'}`}
          style={{ color }}
        >
          {name}
          {injected && <span className="text-dimmer">· typed</span>}
        </div>
        <div
          className="rounded-sm border px-3 py-2 text-[13.5px] leading-relaxed"
          style={{
            borderColor: `${color}33`,
            background: isScammer ? 'rgba(255,59,92,0.05)' : 'rgba(0,255,156,0.045)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
