'use client';

import { useEffect, useState } from 'react';
import { Panel, Pill } from './ui';
import type { Enrichment, IntelItem } from '@/lib/types';

const SEVERITY: Record<string, { dot: string; badge: string }> = {
  critical: { dot: 'bg-danger', badge: 'bg-danger-soft text-danger' },
  high: { dot: 'bg-warning', badge: 'bg-warning-soft text-warning' },
  medium: { dot: 'bg-info', badge: 'bg-info-soft text-info' },
  low: { dot: 'bg-faint', badge: 'bg-surface-subtle text-muted' },
};

export default function IntelPanel({
  intel,
  enrichment,
  serverBase,
}: {
  intel: IntelItem[];
  enrichment: Enrichment | null;
  serverBase: string;
}) {
  const [summary, setSummary] = useState<{
    mode: string;
    total_sessions: number;
    total_seconds_wasted: number;
    total_cost_destroyed: number;
    total_intel: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    const poll = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetch(`${serverBase}/api/intel/summary`, { signal: current.signal });
        if (!response.ok) throw new Error(`summary ${response.status}`);
        const payload = await response.json();
        if (active && controller === current) setSummary(payload);
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        if (active && controller === current && !aborted) setSummary(null);
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [serverBase]);

  const critical = intel.filter((item) => item.severity === 'critical').length;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Panel title="Fraud profile" bodyClass="p-4">
        {!enrichment ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm leading-relaxed text-muted">
            Classification appears after enough caller context is available.
          </div>
        ) : (
          <dl className="space-y-3">
            <Row label="Scam type" value={enrichment.scam_type?.replace(/_/g, ' ') || 'Unknown'} strong />
            <Row label="Claimed organization" value={enrichment.claimed_org || 'Not identified'} />
            <Row label="Caller alias" value={enrichment.claimed_name || 'Not identified'} />
            <Row label="Payment rail" value={enrichment.payment_rail || 'Not identified'} strong />
            <Row label="Amount" value={enrichment.amount_demanded || 'Not identified'} />
            {enrichment.pressure_tactics?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {enrichment.pressure_tactics.slice(0, 5).map((tactic) => (
                  <Pill key={tactic} tone="amber">
                    {tactic}
                  </Pill>
                ))}
              </div>
            )}
          </dl>
        )}
      </Panel>

      <Panel
        title="Evidence"
        right={
          <div className="flex items-center gap-1.5">
            {critical > 0 && <Pill tone="crit">{critical} critical</Pill>}
            <Pill tone="info">{intel.length} total</Pill>
          </div>
        }
        className="min-h-[360px] flex-1 xl:min-h-0"
        bodyClass="min-h-0 overflow-y-auto"
      >
        {intel.length === 0 ? (
          <div className="mx-auto max-w-xs px-6 py-12 text-center">
            <p className="font-serif text-xl tracking-[-0.02em] text-text">No evidence captured yet</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Payment details, callback numbers, and infrastructure appear here after validation.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {intel.map((item) => {
              const severity = SEVERITY[item.severity] || SEVERITY.low;
              return (
                <li
                  key={item.id}
                  className={`px-4 py-4 ${item.severity === 'critical' ? 'evidence-land' : 'soft-land'}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severity.dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-text">{item.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${severity.badge}`}>
                          {item.severity}
                        </span>
                      </div>
                      <p className="mt-1.5 break-all font-mono text-xs font-semibold text-text">{item.value}</p>
                      {Object.keys(item.meta || {}).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {Object.entries(item.meta).map(([key, value]) => (
                            <span
                              key={key}
                              className={`rounded-md border px-2 py-1 text-[10px] ${
                                String(value).includes('PASS')
                                  ? 'border-positive/20 bg-positive-soft text-positive'
                                  : 'border-border bg-canvas text-muted'
                              }`}
                            >
                              {key}: {String(value)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="Campaign totals"
        right={<Pill tone={summary?.mode === 'elastic' ? 'phos' : 'dim'}>{summary?.mode || 'Loading'}</Pill>}
        bodyClass="grid grid-cols-2 gap-2 p-4"
      >
        <Mini label="Engagements" value={String(summary?.total_sessions ?? 0)} />
        <Mini label="Evidence items" value={String(summary?.total_intel ?? 0)} />
        <Mini label="Time occupied" value={`${Math.floor((summary?.total_seconds_wasted ?? 0) / 60)}m`} />
        <Mini label="Cost disrupted" value={`$${(summary?.total_cost_destroyed ?? 0).toFixed(2)}`} />
      </Panel>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-right text-sm ${strong ? 'font-semibold text-text' : 'text-text'}`}>{value}</dd>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-canvas px-3 py-2.5">
      <div className="text-[10px] font-semibold tracking-wide text-muted uppercase">{label}</div>
      <div className="tnum mt-1 text-base font-semibold text-text">{value}</div>
    </div>
  );
}
