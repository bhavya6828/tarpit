'use client';

import { useState } from 'react';
import { useHoneypot } from '@/lib/useHoneypot';
import MetricsRail from './MetricsRail';
import Transcript from './Transcript';
import IntelPanel from './IntelPanel';
import PersonaPicker from './PersonaPicker';
import CaseFile from './CaseFile';
import { Dot, Panel } from './ui';
import { resolveServerUrls } from '@/lib/connection';

const SERVER = process.env.NEXT_PUBLIC_HONEYPOT_SERVER || 'localhost:8787';
const PAGE_PROTOCOL = typeof window === 'undefined' ? 'http:' : window.location.protocol;
const HTTP = resolveServerUrls(SERVER, PAGE_PROTOCOL).http;

type WorkspaceView = 'conversation' | 'evidence' | 'session';
const workspaceViews: WorkspaceView[] = ['conversation', 'evidence', 'session'];

export default function CommandCenter() {
  const honeypot = useHoneypot();
  const [selected, setSelected] = useState('harold');
  const [showCase, setShowCase] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('conversation');

  const live = honeypot.conn === 'live';
  const activeId = honeypot.activePersona?.id ?? selected;
  const activePersona = honeypot.activePersona ?? honeypot.personas.find((persona) => persona.id === selected) ?? null;
  const unavailable = honeypot.conn === 'offline' || honeypot.conn === 'connecting';

  const pick = (id: string) => {
    setSelected(id);
    honeypot.choosePersona(id);
  };

  const moveWorkspaceFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    const currentIndex = workspaceViews.indexOf(workspaceView);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % workspaceViews.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + workspaceViews.length) % workspaceViews.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = workspaceViews.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextView = workspaceViews[nextIndex];
    setWorkspaceView(nextView);
    document.getElementById(`${nextView}-tab`)?.focus();
  };

  return (
    <main className="workspace-shell min-h-screen bg-canvas xl:h-screen xl:min-h-0">
      {showCase && honeypot.metrics?.sessionId && (
        <CaseFile
          sessionId={honeypot.metrics.sessionId}
          serverBase={HTTP}
          onClose={() => setShowCase(false)}
        />
      )}

      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col px-4 py-4 sm:px-5 xl:h-screen xl:min-h-0 xl:px-6">
        <header className="flex shrink-0 flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-lg font-bold on-accent">
              H
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h1 className="display text-2xl text-text">Honeypot AI</h1>
                <span className="hidden text-xs text-muted md:inline">Scam call defense</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                <Dot on={honeypot.conn !== 'offline'} color={live ? 'var(--color-danger)' : 'var(--color-positive)'} />
                <span>{connectionLabel(honeypot.conn)}</span>
                {honeypot.metrics?.sessionId && <span className="font-mono text-[10px] text-faint">{honeypot.metrics.sessionId}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={() => setShowCase(true)}
              disabled={!honeypot.metrics?.sessionId}
              className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-text transition-colors hover:border-border-strong hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-35"
            >
              Open report
            </button>
            <button
              type="button"
              onClick={() => (live ? honeypot.stop() : honeypot.start(selected))}
              disabled={unavailable}
              className={`flex-1 rounded-md px-4 py-2.5 text-sm font-semibold transition-transform active:scale-[0.98] sm:flex-none ${
                live ? 'bg-danger text-white' : 'bg-accent on-accent'
              } disabled:cursor-not-allowed disabled:opacity-35`}
            >
              {live ? 'End engagement' : 'Start engagement'}
            </button>
          </div>
        </header>

        {((honeypot.health && !honeypot.health.ok) || honeypot.errors.length > 0) && (
          <div role="alert" className="mt-3 shrink-0 rounded-lg border border-warning/20 bg-warning-soft px-4 py-3 text-sm text-warning">
            {honeypot.health && !honeypot.health.ok && (
              <span>Missing service keys: {honeypot.health.missing.join(', ')}. </span>
            )}
            {honeypot.errors.slice(-1)[0]}
          </div>
        )}

        <nav role="tablist" aria-label="Workspace views" onKeyDown={moveWorkspaceFocus} className="mt-4 grid shrink-0 grid-cols-3 rounded-lg border border-border bg-surface p-1 xl:hidden">
          <MobileTab id="conversation-tab" controls="conversation-panel" active={workspaceView === 'conversation'} onClick={() => setWorkspaceView('conversation')}>Conversation</MobileTab>
          <MobileTab id="evidence-tab" controls="evidence-panel" active={workspaceView === 'evidence'} onClick={() => setWorkspaceView('evidence')}>Evidence</MobileTab>
          <MobileTab id="session-tab" controls="session-panel" active={workspaceView === 'session'} onClick={() => setWorkspaceView('session')}>Session</MobileTab>
        </nav>

        <div className="mt-4 grid min-h-0 flex-1 gap-4 xl:grid-cols-[280px_minmax(420px,1fr)_340px]">
          <aside
            id="session-panel"
            role="tabpanel"
            aria-labelledby="session-tab"
            className={`${workspaceView === 'session' ? 'flex' : 'hidden'} min-h-0 flex-col gap-4 overflow-y-auto pb-4 xl:flex xl:pb-0`}
          >
            <Panel title="Session setup" bodyClass="space-y-5 p-4">
              <div>
                <p className="label mb-2">Persona</p>
                {honeypot.personas.length > 0 ? (
                  <PersonaPicker personas={honeypot.personas} activeId={activeId} onPick={pick} live={live} />
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
                    pressed={honeypot.telephony}
                    onClick={honeypot.toggleTelephony}
                  />
                  <Toggle
                    label="Half-duplex"
                    detail="Mutes the mic while persona speaks"
                    pressed={honeypot.muteWhileSpeaking}
                    onClick={honeypot.toggleMuteWhileSpeaking}
                  />
                </div>
              </div>

              <div>
                <p className="label mb-2">Services</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Service on={!!honeypot.health?.services.deepgram} name="Deepgram" />
                  <Service on={!!honeypot.health?.services.elevenlabs} name="ElevenLabs" />
                  <Service on={!!honeypot.health?.services.openai} name="OpenAI" />
                  <Service on={honeypot.health?.services.elastic === 'elastic'} name="Elastic" />
                </div>
              </div>
            </Panel>

            <MetricsRail
              metrics={honeypot.metrics}
              persona={activePersona}
              live={live}
              agentSpeaking={honeypot.agentSpeaking}
              inputLevel={honeypot.inputLevel}
              outputLevel={honeypot.outputLevel}
              signals={honeypot.signals}
            />
          </aside>

          <section
            id="conversation-panel"
            role="tabpanel"
            aria-labelledby="conversation-tab"
            className={`${workspaceView === 'conversation' ? 'flex' : 'hidden'} min-h-0 flex-col xl:flex`}
          >
            <Transcript
              lines={honeypot.transcript}
              partial={honeypot.partial}
              agentLive={honeypot.agentLive}
              persona={activePersona}
              live={live}
              onInject={honeypot.inject}
            />
          </section>

          <aside
            id="evidence-panel"
            role="tabpanel"
            aria-labelledby="evidence-tab"
            className={`${workspaceView === 'evidence' ? 'flex' : 'hidden'} min-h-0 flex-col overflow-y-auto pb-4 xl:flex xl:pb-0`}
          >
            <IntelPanel intel={honeypot.intel} enrichment={honeypot.enrichment} serverBase={HTTP} />
          </aside>
        </div>

        <footer className="hidden shrink-0 items-center gap-3 pt-4 text-[11px] text-faint xl:flex">
          <span>Use headphones to prevent the persona from hearing its own voice.</span>
          <span className="ml-auto font-mono">
            {honeypot.health?.models.stt || 'STT'} / {honeypot.health?.models.llm || 'LLM'} / {honeypot.health?.models.tts || 'TTS'}
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
  id,
  controls,
  active,
  onClick,
  children,
}: {
  id: string;
  controls: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      role="tab"
      type="button"
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`min-h-10 rounded-md px-3 py-2 text-xs font-semibold ${active ? 'bg-accent on-accent' : 'text-muted hover:text-text'}`}
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
