'use client';

import { useEffect, useState } from 'react';
import { Panel, Pill } from './ui';
import type { Enrichment, IntelItem } from '@/lib/types';

const SEVERITY: Record<string, { color: string; anim: string }> = {
  critical: { color: 'var(--color-crit)', anim: 'crit-land' },
  high: { color: 'var(--color-amber)', anim: 'intel-land' },
  medium: { color: 'var(--color-info)', anim: 'intel-land' },
  low: { color: 'var(--color-dim)', anim: 'intel-land' },
};

const TYPE_ICON: Record<string, string> = {
  crypto_wallet: '⬡',
  payment_card: '▭',
  bank_routing: '⌗',
  bank_account: '⌗',
  callback_number: '☏',
  payment_tag: '$',
  gift_card: '▤',
  email: '@',
  infrastructure: '⌬',
  remote_access: '⚠',
  impersonation: '◈',
  coercion: '◊',
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
    const poll = () =>
      fetch(`${serverBase}/api/intel/summary`)
        .then((r) => r.json())
        .then(setSummary)
        .catch(() => {});
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [serverBase]);

  const critical = intel.filter((i) => i.severity === 'critical').length;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {/* ── fraud profile ── */}
      <Panel title="Fraud profile" bodyClass="px-3 py-3">
        {!enrichment ? (
          <p className="text-[12px] text-dimmer">classifying…</p>
        ) : (
          <div className="space-y-1.5">
            <Row k="Scam class" v={enrichment.scam_type?.replace(/_/g, ' ') || 'unknown'} accent />
            <Row k="Impersonating" v={enrichment.claimed_org || '—'} />
            <Row k="Alias given" v={enrichment.claimed_name || '—'} />
            <Row k="Payment rail" v={enrichment.payment_rail || '—'} accent />
            <Row k="Amount demanded" v={enrichment.amount_demanded || '—'} />
            {enrichment.pressure_tactics?.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {enrichment.pressure_tactics.slice(0, 5).map((t) => (
                  <Pill key={t} tone="amber">
                    {t}
                  </Pill>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* ── live artifact feed ── */}
      <Panel
        title="Extracted threat intel"
        right={
          <div className="flex items-center gap-1.5">
            {critical > 0 && <Pill tone="crit">{critical} critical</Pill>}
            <Pill tone="phos">{intel.length}</Pill>
          </div>
        }
        className="min-h-0 flex-1"
        bodyClass="min-h-0 overflow-y-auto"
      >
        {intel.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-[12px] text-dimmer">no artifacts captured</p>
            <p className="mt-1.5 text-[10px] leading-relaxed text-dimmer">
              card numbers are Luhn-checked, routing numbers ABA-checksummed, and
              spoken digits reassembled before indexing
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-edge">
            {intel.map((item) => {
              const sev = SEVERITY[item.severity] || SEVERITY.low;
              return (
                <li key={item.id} className={`px-3 py-2 ${sev.anim}`}>
                  <div className="flex items-center gap-2">
                    <span style={{ color: sev.color }}>{TYPE_ICON[item.type] || '●'}</span>
                    <span
                      className="text-[10px] tracking-[0.14em] uppercase"
                      style={{ color: sev.color }}
                    >
                      {item.label}
                    </span>
                    <span className="ml-auto text-[10px] text-dimmer">{item.severity}</span>
                  </div>
                  <div className="mt-1 pl-5 font-bold break-all text-ink text-[13px]">{item.value}</div>
                  {Object.keys(item.meta || {}).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 pl-5">
                      {Object.entries(item.meta).map(([k, v]) => (
                        <span
                          key={k}
                          className={`rounded-sm border px-1 py-px text-[9.5px] ${
                            String(v).includes('PASS')
                              ? 'border-phos/40 text-phos'
                              : 'border-edge text-dim'
                          }`}
                        >
                          {k}: {String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* ── cross-campaign rollup ── */}
      <Panel
        title="Campaign index"
        right={<Pill tone={summary?.mode === 'elastic' ? 'phos' : 'dim'}>{summary?.mode || '—'}</Pill>}
        bodyClass="grid grid-cols-2 gap-2 px-3 py-3"
      >
        <Mini label="Engagements" value={String(summary?.total_sessions ?? 0)} />
        <Mini label="Artifacts indexed" value={String(summary?.total_intel ?? 0)} />
        <Mini
          label="Total time burned"
          value={`${Math.floor((summary?.total_seconds_wasted ?? 0) / 60)}m`}
        />
        <Mini label="Total cost" value={`$${(summary?.total_cost_destroyed ?? 0).toFixed(2)}`} />
      </Panel>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="label">{k}</span>
      <span className={`text-right text-[12px] ${accent ? 'text-phos' : 'text-ink'}`}>{v}</span>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-edge bg-void/50 px-2 py-1.5">
      <div className="label leading-tight">{label}</div>
      <div className="tnum text-sm font-bold text-ink">{value}</div>
    </div>
  );
}
