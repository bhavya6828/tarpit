'use client';

import { useEffect, useState } from 'react';
import { useTarpit } from '@/lib/useTarpit';
import MetricsRail from './MetricsRail';
import Transcript from './Transcript';
import IntelPanel from './IntelPanel';
import PersonaPicker from './PersonaPicker';
import CaseFile from './CaseFile';
import { Dot, Pill } from './ui';

const SERVER = process.env.NEXT_PUBLIC_TARPIT_SERVER || 'localhost:8787';
const HTTP = `http://${SERVER}`;

export default function CommandCenter() {
  const t = useTarpit();
  const [selected, setSelected] = useState<string>('harold');
  const [flash, setFlash] = useState(false);
  const [showCase, setShowCase] = useState(false);

  const live = t.conn === 'live';
  const activeId = t.activePersona?.id ?? selected;

  // Screen flash when a critical artifact lands — the moment judges look up.
  useEffect(() => {
    if (!t.intel.length) return;
    if (t.intel[0].severity !== 'critical') return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(id);
  }, [t.lastIntelAt, t.intel]);

  const pick = (id: string) => {
    setSelected(id);
    t.choosePersona(id);
  };

  return (
    <main className="flex h-screen flex-col gap-2 p-2">
      {showCase && t.metrics?.sessionId && (
        <CaseFile sessionId={t.metrics.sessionId} serverBase={HTTP} onClose={() => setShowCase(false)} />
      )}

      {flash && (
        <div className="flash-screen pointer-events-none fixed inset-0 z-[98] bg-crit/12" />
      )}

      {/* ─── header ─────────────────────────────────────────────────────── */}
      <header className="panel flex shrink-0 items-center gap-4 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[17px] font-bold tracking-[0.3em] text-phos glow-phos">TARPIT</span>
          <span className="hidden text-[10px] tracking-wider text-dimmer uppercase lg:inline">
            autonomous scam-baiter
          </span>
        </div>

        <div className="flex items-center gap-1.5 border-l border-edge pl-4">
          <Dot on={live} color={live ? 'var(--color-crit)' : 'var(--color-dimmer)'} />
          <span className={`text-[11px] tracking-wider uppercase ${live ? 'text-crit' : 'text-dimmer'}`}>
            {live ? 'engagement live' : t.conn === 'ended' ? 'engagement closed' : 'standby'}
          </span>
          {t.metrics?.sessionId && live && (
            <span className="ml-1 text-[10px] text-dimmer">#{t.metrics.sessionId}</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <PersonaPicker personas={t.personas} activeId={activeId} onPick={pick} live={live} />

          <div className="hidden items-center gap-1.5 border-l border-edge pl-3 xl:flex">
            <Svc on={!!t.health?.services.deepgram} name="deepgram" />
            <Svc on={!!t.health?.services.elevenlabs} name="11labs" />
            <Svc on={!!t.health?.services.openai} name="openai" />
            <Svc on={t.health?.services.elastic === 'elastic'} name="elastic" />
          </div>

          <button
            onClick={t.toggleTelephony}
            title="Band-limit the persona to 300-3400Hz with line compression and room tone — what the caller actually hears down a phone. Turn it off to hear the raw studio audio."
            className={`rounded-sm border px-2 py-1 text-[10px] tracking-wider uppercase transition-colors ${
              t.telephony ? 'border-phos/50 text-phos' : 'border-edge text-dim hover:text-ink'
            }`}
          >
            phone line {t.telephony ? 'on' : 'off'}
          </button>

          <button
            onClick={t.toggleMuteWhileSpeaking}
            title="Half-duplex: stop sending mic audio while the persona is speaking. Use this when demoing on loudspeakers."
            className={`rounded-sm border px-2 py-1 text-[10px] tracking-wider uppercase transition-colors ${
              t.muteWhileSpeaking ? 'border-amber/50 text-amber' : 'border-edge text-dim hover:text-ink'
            }`}
          >
            half-duplex {t.muteWhileSpeaking ? 'on' : 'off'}
          </button>

          <button
            onClick={() => setShowCase(true)}
            disabled={!t.metrics?.sessionId}
            title="Generate the law-enforcement referral package: case file, STIX 2.1 bundle, and FTC pre-fill."
            className="rounded-sm border border-edge px-2 py-1 text-[10px] tracking-wider text-dim uppercase transition-colors hover:border-amber/50 hover:text-amber disabled:opacity-30"
          >
            referral
          </button>

          <button
            onClick={() => (live ? t.stop() : t.start(selected))}
            disabled={t.conn === 'offline' || t.conn === 'connecting'}
            className={`rounded-sm border px-4 py-1.5 text-[11px] font-bold tracking-[0.18em] uppercase transition-all disabled:opacity-30 ${
              live
                ? 'border-crit text-crit hover:bg-crit/12'
                : 'border-phos text-phos hover:bg-phos/12'
            }`}
          >
            {live ? '■ end call' : '▶ arm tarpit'}
          </button>
        </div>
      </header>

      {/* ─── missing-key / error banner ─────────────────────────────────── */}
      {(t.health && !t.health.ok) || t.errors.length > 0 ? (
        <div className="panel shrink-0 border-amber/30 px-3 py-1.5 text-[11px] text-amber">
          {t.health && !t.health.ok && (
            <span>missing keys in .env: {t.health.missing.join(', ')} — </span>
          )}
          {t.errors.slice(-1)[0]}
        </div>
      ) : null}

      {/* ─── main grid ──────────────────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_370px]">
        <div className="hidden min-h-0 lg:block">
          <MetricsRail
            metrics={t.metrics}
            persona={t.activePersona ?? t.personas.find((p) => p.id === selected) ?? null}
            live={live}
            agentSpeaking={t.agentSpeaking}
            inputLevel={t.inputLevel}
            outputLevel={t.outputLevel}
            signals={t.signals}
          />
        </div>

        <div className="flex min-h-0 flex-col">
          <Transcript
            lines={t.transcript}
            partial={t.partial}
            agentLive={t.agentLive}
            persona={t.activePersona ?? t.personas.find((p) => p.id === selected) ?? null}
            live={live}
            onInject={t.inject}
          />
        </div>

        <div className="hidden min-h-0 xl:block">
          <IntelPanel intel={t.intel} enrichment={t.enrichment} serverBase={HTTP} />
        </div>
      </div>

      {/* ─── footer ─────────────────────────────────────────────────────── */}
      <footer className="flex shrink-0 items-center gap-3 px-1 text-[10px] text-dimmer">
        <span>
          deepgram {t.health?.models.stt} → openai {t.health?.models.llm} → elevenlabs{' '}
          {t.health?.models.tts}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Pill tone={t.conn === 'offline' ? 'crit' : 'dim'}>bridge {t.conn}</Pill>
          <span>headphones recommended — prevents the persona hearing itself</span>
        </span>
      </footer>
    </main>
  );
}

function Svc({ on, name }: { on: boolean; name: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-dim">
      <Dot on={on} />
      {name}
    </span>
  );
}
