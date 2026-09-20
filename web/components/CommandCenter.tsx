'use client';

import { useState } from 'react';
import { useTarpit } from '@/lib/useTarpit';
import MetricsRail from './MetricsRail';
import Transcript from './Transcript';
import IntelPanel from './IntelPanel';
import PersonaPicker from './PersonaPicker';
import CaseFile from './CaseFile';
import { Dot, Panel } from './ui';
import { resolveServerUrls } from '@/lib/connection';

const SERVER = process.env.NEXT_PUBLIC_TARPIT_SERVER || 'localhost:8787';
const PAGE_PROTOCOL = typeof window === 'undefined' ? 'http:' : window.location.protocol;
const HTTP = resolveServerUrls(SERVER, PAGE_PROTOCOL).http;

type WorkspaceView = 'conversation' | 'evidence' | 'session';

export default function CommandCenter() {
  const tarpit = useTarpit();
  const [selected, setSelected] = useState('harold');
  const [showCase, setShowCase] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('conversation');

  const live = tarpit.conn === 'live';
  const activeId = tarpit.activePersona?.id ?? selected;
  const activePersona = tarpit.activePersona ?? tarpit.personas.find((persona) => persona.id === selected) ?? null;
  const unavailable = tarpit.conn === 'offline' || tarpit.conn === 'connecting';

  const pick = (id: string) => {
    setSelected(id);
    tarpit.choosePersona(id);
  };

  return (
    <main className="workspace-shell min-h-screen bg-canvas lg:h-screen lg:min-h-0">
      {showCase && tarpit.metrics?.sessionId && (
        <CaseFile
          sessionId={tarpit.metrics.sessionId}
          serverBase={HTTP}
          onClose={() => setShowCase(false)}
        />
      )}

      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col px-3 py-3 sm:px-5 sm:py-4 lg:h-screen lg:min-h-0 lg:px-6">
        <header className="flex shrink-0 flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent font-serif text-lg text-white">
              T
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h1 className="font-serif text-2xl tracking-[-0.04em] text-text">Tarpit</h1>
                <span className="hidden text-xs text-muted md:inline">Scam call defense</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                <Dot on={tarpit.conn !== 'offline'} color={live ? 'var(--color-danger)' : 'var(--color-positive)'} />
                <span>{connectionLabel(tarpit.conn)}</span>
                {tarpit.metrics?.sessionId && <span className="font-mono text-[10px] text-faint">{tarpit.metrics.sessionId}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={() => setShowCase(true)}
              disabled={!tarpit.metrics?.sessionId}
              className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-text transition-colors hover:border-border-strong hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-35"
            >
              Open report
            </button>
            <button
              type="button"
              onClick={() => (live ? tarpit.stop() : tarpit.start(selected))}
              disabled={unavailable}
              className={`flex-1 rounded-md px-4 py-2.5 text-sm font-semibold transition-transform active:scale-[0.98] sm:flex-none ${
                live ? 'bg-danger text-white' : 'bg-accent text-white'
              } disabled:cursor-not-allowed disabled:opacity-35`}
            >
              {live ? 'End engagement' : 'Start engagement'}
            </button>
          </div>
        </header>

        {((tarpit.health && !tarpit.health.ok) || tarpit.errors.length > 0) && (
          <div role="alert" className="mt-3 shrink-0 rounded-lg border border-warning/20 bg-warning-soft px-4 py-3 text-sm text-warning">
            {tarpit.health && !tarpit.health.ok && (
              <span>Missing service keys: {tarpit.health.missing.join(', ')}. </span>
            )}
            {tarpit.errors.slice(-1)[0]}
          </div>
        )}

        <nav aria-label="Workspace views" className="mt-3 grid shrink-0 grid-cols-3 rounded-lg border border-border bg-surface p-1 lg:hidden">
          <MobileTab active={workspaceView === 'conversation'} onClick={() => setWorkspaceView('conversation')}>Conversation</MobileTab>
          <MobileTab active={workspaceView === 'evidence'} onClick={() => setWorkspaceView('evidence')}>Evidence</MobileTab>
          <MobileTab active={workspaceView === 'session'} onClick={() => setWorkspaceView('session')}>Session</MobileTab>
        </nav>

        <div className="mt-3 grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_minmax(420px,1fr)_340px]">
          <aside className={`${workspaceView === 'session' ? 'flex' : 'hidden'} min-h-0 flex-col gap-3 overflow-y-auto pb-4 lg:flex lg:pb-0`} aria-label="Session">
            <Panel title="Session setup" bodyClass="space-y-5 p-4">
              <div>
                <p className="label mb-2">Persona</p>
                {tarpit.personas.length > 0 ? (
                  <PersonaPicker personas={tarpit.personas} activeId={activeId} onPick={pick} live={live} />
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">Personas load when the local server connects.</p>
                )}
              </div>

              <div>
                <p className="label mb-2">Audio behavior</p>
                <div className="space-y-2">
                  <Toggle
                    label="Phone line effect"
                    detail="Adds realistic call-band audio"
                    pressed={tarpit.telephony}
                    onClick={tarpit.toggleTelephony}
                  />
                  <Toggle
                    label="Half-duplex"
                    detail="Mutes the mic while persona speaks"
                    pressed={tarpit.muteWhileSpeaking}
                    onClick={tarpit.toggleMuteWhileSpeaking}
                  />
                </div>
              </div>

              <div>
                <p className="label mb-2">Services</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Service on={!!tarpit.health?.services.deepgram} name="Deepgram" />
                  <Service on={!!tarpit.health?.services.elevenlabs} name="ElevenLabs" />
                  <Service on={!!tarpit.health?.services.openai} name="OpenAI" />
                  <Service on={tarpit.health?.services.elastic === 'elastic'} name="Elastic" />
                </div>
              </div>
            </Panel>

            <MetricsRail
              metrics={tarpit.metrics}
              persona={activePersona}
              live={live}
              agentSpeaking={tarpit.agentSpeaking}
              inputLevel={tarpit.inputLevel}
              outputLevel={tarpit.outputLevel}
              signals={tarpit.signals}
            />
          </aside>

          <section className={`${workspaceView === 'conversation' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`} aria-label="Conversation">
            <Transcript
              lines={tarpit.transcript}
              partial={tarpit.partial}
              agentLive={tarpit.agentLive}
              persona={activePersona}
              live={live}
              onInject={tarpit.inject}
            />
          </section>

          <aside className={`${workspaceView === 'evidence' ? 'flex' : 'hidden'} min-h-0 flex-col overflow-y-auto pb-4 lg:flex lg:pb-0`} aria-label="Evidence">
            <IntelPanel intel={tarpit.intel} enrichment={tarpit.enrichment} serverBase={HTTP} />
          </aside>
        </div>

        <footer className="hidden shrink-0 items-center gap-3 pt-3 text-[11px] text-faint lg:flex">
          <span>Use headphones to prevent the persona from hearing its own voice.</span>
          <span className="ml-auto font-mono">
            {tarpit.health?.models.stt || 'STT'} / {tarpit.health?.models.llm || 'LLM'} / {tarpit.health?.models.tts || 'TTS'}
          </span>
        </footer>
      </div>
    </main>
  );
}

function connectionLabel(conn: string) {
  if (conn === 'live') return 'Engagement live';
  if (conn === 'ready') return 'Ready to start';
  if (conn === 'connecting') return 'Connecting to local server';
  if (conn === 'ended') return 'Engagement ended';
  return 'Server offline';
}

function MobileTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md px-2 py-2 text-xs font-semibold ${active ? 'bg-accent text-white' : 'text-muted'}`}
    >
      {children}
    </button>
  );
}

function Toggle({
  label,
  detail,
  pressed,
  onClick,
}: {
  label: string;
  detail: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-border-strong"
    >
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${pressed ? 'bg-positive' : 'bg-border-strong'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${pressed ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </span>
      <span>
        <span className="block text-xs font-semibold text-text">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-snug text-muted">{detail}</span>
      </span>
    </button>
  );
}

function Service({ on, name }: { on: boolean; name: string }) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <Dot on={on} />
      {name}
    </span>
  );
}
