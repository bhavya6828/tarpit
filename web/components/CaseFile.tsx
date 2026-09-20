'use client';

import { useEffect, useState } from 'react';
import { Pill } from './ui';

interface CaseFileData {
  case_id: string;
  generated_at: string;
  engagement: { duration_seconds: number; transport: string; persona_deployed: string; turns: number };
  classification: { scam_type: string; impersonated_entity: string | null; payment_rail: string | null };
  caller: { number: string | null; carrier: string | null; caller_id_attestation: string | null; note: string };
  artifacts: {
    total: number;
    critical: number;
    validated: number;
    items: { type: string; label: string; value: string; severity: string; validation: string | null }[];
  };
  correlation: { repeats: { value: string; label: string; also_seen_in: string[] }[] };
  transcript: { speaker: string; text: string }[];
  disclosure: { ai_disclosure: string; consent_basis: string };
}

export default function CaseFile({
  sessionId,
  serverBase,
  onClose,
}: {
  sessionId: string;
  serverBase: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<CaseFileData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dispatched, setDispatched] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${serverBase}/api/report/${sessionId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(setData)
      .catch((e) => setErr(String(e.message)));
  }, [sessionId, serverBase]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const dispatchReport = async () => {
    setDispatched('sending…');
    try {
      const r = await fetch(`${serverBase}/api/report/${sessionId}/dispatch`, { method: 'POST' });
      const j = await r.json();
      setDispatched(j.dispatched ? `delivered (HTTP ${j.status})` : `not sent — ${j.reason}`);
    } catch (e) {
      setDispatched(`failed — ${(e as Error).message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-void/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="panel flex max-h-[88vh] w-full max-w-4xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
          <div>
            <h2 className="text-[15px] font-bold tracking-wider text-phos glow-phos">
              {data?.case_id || 'REFERRAL PACKAGE'}
            </h2>
            <p className="mt-0.5 text-[10px] tracking-wider text-dimmer uppercase">
              law-enforcement referral · machine-readable threat intel
            </p>
          </div>
          <button onClick={onClose} className="rounded-sm border border-edge px-2 py-1 text-[10px] text-dim uppercase hover:text-ink">
            close · esc
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {err && <p className="text-[12px] text-crit">could not load case file: {err}</p>}
          {!data && !err && <p className="text-[12px] text-dimmer">building case file…</p>}

          {data && (
            <div className="space-y-5">
              <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Cell k="Scam class" v={data.classification.scam_type.replace(/_/g, ' ')} accent />
                <Cell k="Impersonating" v={data.classification.impersonated_entity || '—'} />
                <Cell k="Artifacts" v={`${data.artifacts.total} (${data.artifacts.validated} verified)`} />
                <Cell k="Duration" v={`${Math.round(data.engagement.duration_seconds)}s`} />
              </section>

              {/* Caller forensics — the honest replacement for "we got their IP". */}
              <section>
                <h3 className="label mb-2">Originating network</h3>
                <div className="grid grid-cols-3 gap-3">
                  <Cell k="Number" v={data.caller.number || '—'} />
                  <Cell k="Carrier" v={data.caller.carrier || '—'} />
                  <Cell k="Caller ID attestation" v={data.caller.caller_id_attestation || '—'} />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-dimmer">{data.caller.note}</p>
              </section>

              {data.correlation.repeats.length > 0 && (
                <section>
                  <h3 className="label mb-2">Cross-engagement correlation</h3>
                  <ul className="space-y-1">
                    {data.correlation.repeats.map((r) => (
                      <li key={r.value} className="rounded-sm border border-amber/30 bg-amber/5 px-2 py-1.5 text-[12px]">
                        <span className="font-bold text-amber">{r.value}</span>
                        <span className="text-dim"> — {r.label}, also seen in </span>
                        <span className="text-amber">{r.also_seen_in.length}</span>
                        <span className="text-dim"> other engagement{r.also_seen_in.length === 1 ? '' : 's'}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[10px] text-dimmer">
                    A reused channel across calls is a live fraud operation, not a one-off.
                  </p>
                </section>
              )}

              <section>
                <h3 className="label mb-2">Artifacts</h3>
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="border-b border-edge text-left text-dimmer">
                      <th className="py-1 font-normal">severity</th>
                      <th className="py-1 font-normal">type</th>
                      <th className="py-1 font-normal">value</th>
                      <th className="py-1 font-normal">validation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.artifacts.items.map((i, n) => (
                      <tr key={n} className="border-b border-edge/50">
                        <td className={`py-1 ${i.severity === 'critical' ? 'text-crit' : 'text-dim'}`}>{i.severity}</td>
                        <td className="py-1 text-dim">{i.label}</td>
                        <td className="py-1 break-all text-ink">{i.value}</td>
                        <td className={`py-1 ${i.validation ? 'text-phos' : 'text-dimmer'}`}>{i.validation || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="rounded-sm border border-edge bg-void/40 px-3 py-2">
                <h3 className="label mb-1">Disclosure</h3>
                <p className="text-[11px] leading-relaxed text-dim">{data.disclosure.ai_disclosure}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-dimmer">{data.disclosure.consent_basis}</p>
              </section>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-edge px-4 py-3">
          <a
            href={`${serverBase}/api/report/${sessionId}/stix`}
            className="rounded-sm border border-phos/40 px-3 py-1.5 text-[10px] tracking-wider text-phos uppercase hover:bg-phos/10"
          >
            ↓ STIX 2.1 bundle
          </a>
          <a
            href={`${serverBase}/api/report/${sessionId}/markdown`}
            className="rounded-sm border border-edge px-3 py-1.5 text-[10px] tracking-wider text-dim uppercase hover:text-ink"
          >
            ↓ case file
          </a>
          <a
            href={`${serverBase}/api/report/${sessionId}/ftc`}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm border border-edge px-3 py-1.5 text-[10px] tracking-wider text-dim uppercase hover:text-ink"
          >
            ↗ FTC pre-fill
          </a>
          <button
            onClick={dispatchReport}
            className="rounded-sm border border-edge px-3 py-1.5 text-[10px] tracking-wider text-dim uppercase hover:text-ink"
          >
            ⇈ dispatch
          </button>
          {dispatched && <span className="text-[10px] text-dim">{dispatched}</span>}
          <span className="ml-auto text-[10px] text-dimmer">
            STIX 2.1 is what carriers and fraud teams ingest by machine
          </span>
        </footer>
      </div>
    </div>
  );
}

function Cell({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="rounded-sm border border-edge bg-void/50 px-2 py-1.5">
      <div className="label leading-tight">{k}</div>
      <div className={`text-[13px] font-bold ${accent ? 'text-phos' : 'text-ink'}`}>{v}</div>
    </div>
  );
}
