'use client';

import type { PersonaCard } from '@/lib/types';

export default function PersonaPicker({
  personas,
  activeId,
  onPick,
  live,
}: {
  personas: PersonaCard[];
  activeId: string | null;
  onPick: (id: string) => void;
  live: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Choose a persona">
      {personas.map((persona) => {
        const selected = persona.id === activeId;
        return (
          <button
            key={persona.id}
            type="button"
            onClick={() => onPick(persona.id)}
            aria-pressed={selected}
            title={`${persona.name}, age ${persona.age}: ${persona.tagline}`}
            className={`min-h-20 rounded-lg border p-3 text-left transition-colors ${
              selected
                ? 'border-text bg-text text-white'
                : 'border-border bg-surface text-text hover:border-border-strong hover:bg-surface-subtle'
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{persona.name.split(' ')[0]}</span>
              {live && selected && (
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-semibold tracking-wider uppercase">
                  Live
                </span>
              )}
            </span>
            <span className={`mt-1 block text-[11px] leading-snug ${selected ? 'text-white/70' : 'text-muted'}`}>
              {persona.tagline}
            </span>
          </button>
        );
      })}
    </div>
  );
}
