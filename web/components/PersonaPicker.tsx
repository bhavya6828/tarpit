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
    <div className="flex items-center gap-1.5">
      {personas.map((p) => {
        const on = p.id === activeId;
        return (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            title={`${p.name}, ${p.age} — ${p.tagline}`}
            className="group rounded-sm border px-2.5 py-1 text-[11px] transition-all"
            style={{
              borderColor: on ? p.color : 'var(--color-edge)',
              color: on ? p.color : 'var(--color-dim)',
              background: on ? `${p.color}14` : 'transparent',
              boxShadow: on ? `0 0 16px -4px ${p.color}` : 'none',
            }}
          >
            {p.name.split(' ')[0]}
            {live && on && <span className="ml-1.5 text-[9px] opacity-70">▸ on air</span>}
          </button>
        );
      })}
    </div>
  );
}
