'use client';

import { useEffect, useRef, useState } from 'react';

const ACCESS_TOKEN = process.env.NEXT_PUBLIC_TARPIT_TOKEN || '';

interface CaseFileData {
  case_id: string;
  engagement: { duration_seconds: number };
  classification: { scam_type: string; impersonated_entity: string | null };
  caller: { number: string | null; carrier: string | null; caller_id_attestation: string | null; note: string };
  artifacts: {
    total: number;
    validated: number;
    items: { label: string; value: string; severity: string; validation: string | null }[];
  };
  correlation: { repeats: { value: string; label: string; also_seen_in: string[] }[] };
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
  const [error, setError] = useState<string | null>(null);
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    setData(null);
    setError(null);

    fetch(`${serverBase}/api/report/${sessionId}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`${response.status}`))))
      .then((payload) => {
        if (mounted.current) setData(payload);
      })
      .catch((reason) => {
        if (mounted.current && reason?.name !== 'AbortError') setError(String(reason.message));
      });

    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [sessionId, serverBase]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const dispatchReport = async () => {
    setDispatchStatus('Sending');
    try {
      const response = await fetch(`${serverBase}/api/report/${sessionId}/dispatch`, {
        method: 'POST',
        headers: ACCESS_TOKEN ? { 'X-Tarpit-Token': ACCESS_TOKEN } : {},
      });
      const result = await response.json();
      if (mounted.current) {
        setDispatchStatus(result.dispatched ? `Delivered (HTTP ${result.status})` : `Not sent: ${result.reason}`);
      }
    } catch (reason) {
      if (mounted.current) setDispatchStatus(`Failed: ${(reason as Error).message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-text/55 p-3 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-file-title"
        className="panel flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div>
            <p className="label">Referral package</p>
            <h2 id="case-file-title" className="mt-1 font-serif text-2xl tracking-[-0.03em] text-text">
              {data?.case_id || 'Building case file'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close referral package"
            className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-text hover:bg-surface-subtle"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {error && <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">Could not load case file: {error}</p>}
          {!data && !error && <p className="text-sm text-muted">Building case file...</p>}

          {data && (
            <div className="space-y-6">
              <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Cell label="Scam class" value={data.classification.scam_type.replace(/_/g, ' ')} accent />
                <Cell label="Impersonating" value={data.classification.impersonated_entity || 'Unknown'} />
                <Cell label="Evidence" value={`${data.artifacts.total} (${data.artifacts.validated} verified)`} />
                <Cell label="Duration" value={`${Math.round(data.engagement.duration_seconds)}s`} />
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold text-text">Originating network</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Cell label="Number" value={data.caller.number || 'Unknown'} />
                  <Cell label="Carrier" value={data.caller.carrier || 'Unknown'} />
                  <Cell label="Caller ID attestation" value={data.caller.caller_id_attestation || 'Unknown'} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted">{data.caller.note}</p>
              </section>

              {data.correlation.repeats.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-text">Cross-engagement correlation</h3>
                  <ul className="space-y-2">
                    {data.correlation.repeats.map((repeat) => (
                      <li key={repeat.value} className="rounded-lg border border-warning/20 bg-warning-soft px-3 py-2 text-sm text-warning">
                        <strong>{repeat.value}</strong> was also seen in {repeat.also_seen_in.length} other engagement{repeat.also_seen_in.length === 1 ? '' : 's'} as {repeat.label}.
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-3 text-sm font-semibold text-text">Captured evidence</h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="bg-surface-subtle text-xs text-muted">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Severity</th>
                        <th className="px-3 py-2 font-semibold">Type</th>
                        <th className="px-3 py-2 font-semibold">Value</th>
                        <th className="px-3 py-2 font-semibold">Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.artifacts.items.map((item, index) => (
                        <tr key={`${item.label}-${index}`} className="border-t border-border">
                          <td className={`px-3 py-2 ${item.severity === 'critical' ? 'text-danger' : 'text-muted'}`}>{item.severity}</td>
                          <td className="px-3 py-2 text-muted">{item.label}</td>
                          <td className="px-3 py-2 font-mono text-xs text-text">{item.value}</td>
                          <td className="px-3 py-2 text-positive">{item.validation || 'Not validated'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-lg border border-border bg-canvas p-4">
                <h3 className="text-sm font-semibold text-text">Disclosure</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">{data.disclosure.ai_disclosure}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{data.disclosure.consent_basis}</p>
              </section>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-4 sm:px-6">
          <ReportLink href={`${serverBase}/api/report/${sessionId}/stix`}>STIX bundle</ReportLink>
          <ReportLink href={`${serverBase}/api/report/${sessionId}/markdown`}>Case file</ReportLink>
          <ReportLink href={`${serverBase}/api/report/${sessionId}/ftc`} external>FTC pre-fill</ReportLink>
          <button type="button" onClick={dispatchReport} className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-text hover:bg-surface-subtle">
            Dispatch
          </button>
          {dispatchStatus && <span role="status" className="text-xs text-muted">{dispatchStatus}</span>}
        </footer>
      </div>
    </div>
  );
}

function Cell({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-canvas px-3 py-2">
      <div className="label">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${accent ? 'text-positive' : 'text-text'}`}>{value}</div>
    </div>
  );
}

function ReportLink({ href, external = false, children }: { href: string; external?: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-text hover:bg-surface-subtle"
    >
      {children}
    </a>
  );
}
