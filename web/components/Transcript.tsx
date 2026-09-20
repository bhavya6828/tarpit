'use client';

import { useEffect, useRef, useState } from 'react';
import { Panel, Pill } from './ui';
import type { PersonaCard, TranscriptLine } from '@/lib/types';
import { normalizeInjectedText } from '@/lib/sessionView';

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
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines.length, partial, agentLive]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = normalizeInjectedText(draft, live);
    if (!text) return;
    onInject(text);
    setDraft('');
  };

  return (
    <Panel
      title="Conversation"
      right={<Pill tone={live ? 'phos' : 'dim'}>{live ? 'Live transcript' : 'Standing by'}</Pill>}
      className="min-h-[620px] flex-1 xl:min-h-0"
      bodyClass="flex min-h-0 flex-col"
    >
      <div
        ref={scroller}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6"
        aria-live="polite"
      >
        {lines.length === 0 && !partial && !agentLive && (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center py-16 text-center">
            <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-canvas display text-xl text-text">
              T
            </span>
            <h3 className="display text-2xl text-text">Ready when you are</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Start an engagement, speak through the microphone, or type a caller message below.
            </p>
          </div>
        )}

        {lines.map((line) => (
          <Line key={line.id} line={line} persona={persona} />
        ))}

        {partial && (
          <Bubble speaker="scammer" name="Caller" faded>
            {partial}
          </Bubble>
        )}

        {agentLive && (
          <Bubble speaker="persona" name={persona?.name || 'Persona'}>
            <span>{agentLive}</span>
          </Bubble>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-border bg-canvas/70 p-3 sm:p-4">
        <label htmlFor="caller-message" className="mb-2 block text-xs font-semibold text-text">
          Type caller message
        </label>
        <div className="flex gap-2">
          <input
            id="caller-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!live}
            placeholder={live ? 'Enter what the caller says' : 'Start an engagement to type'}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text transition-colors placeholder:text-faint hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-subtle"
          />
          <button
            type="submit"
            disabled={!live || !draft.trim()}
            className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold on-accent transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
          >
            Send
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted">Use this when microphone access is unavailable.</p>
      </form>
    </Panel>
  );
}

function Line({ line, persona }: { line: TranscriptLine; persona: PersonaCard | null }) {
  const caller = line.speaker === 'scammer';
  return (
    <Bubble
      speaker={line.speaker}
      name={caller ? 'Caller' : persona?.name || 'Persona'}
      injected={line.injected}
    >
      {line.text}
    </Bubble>
  );
}

function Bubble({
  speaker,
  name,
  children,
  faded,
  injected,
}: {
  speaker: string;
  name: string;
  children: React.ReactNode;
  faded?: boolean;
  injected?: boolean;
}) {
  const caller = speaker === 'scammer';

  return (
    <div className={`soft-land flex ${caller ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[92%] sm:max-w-[78%] ${faded ? 'opacity-55' : ''}`}>
        <div className={`mb-1.5 flex items-center gap-2 text-[11px] font-semibold ${caller ? '' : 'justify-end'}`}>
          <span className={caller ? 'text-danger' : 'text-positive'}>{name}</span>
          {injected && <span className="font-normal text-faint">Typed input</span>}
        </div>
        <div
          className={`rounded-lg border px-4 py-3 text-[15px] leading-relaxed text-text ${
            caller ? 'border-danger/15 bg-danger-soft' : 'border-positive/15 bg-positive-soft'
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
