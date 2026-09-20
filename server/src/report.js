import crypto from 'node:crypto';
import { store } from './elastic.js';
import { getPersona } from './personas.js';
import { redactIntelItem, redactPaymentText } from './redact.js';

/**
 * Referral package generation.
 *
 * Deliberate scoping note: there is no public API that files a complaint with
 * the FBI, FTC or FCC — those are human web forms, for every reporter. So this
 * does not pretend to "report to the authorities" with a checkmark. It produces
 * the three things that are actually actionable:
 *
 *   1. A formal case file a human can read and attach.
 *   2. A STIX 2.1 bundle — the format carriers, ISACs and fraud teams ingest
 *      by machine, which is where this intel realistically lands.
 *   3. A pre-filled FTC complaint, field by field, plus the deep link.
 *
 * Plus optional webhook dispatch, so a downstream system can receive it live.
 */

const TARPIT_IDENTITY_ID = 'identity--8f1a4b2c-6d3e-4a5f-9b7c-2e1d0a9f8c3b';

// Which artifacts are worth putting in front of an investigator, and how they
// map onto STIX patterns.
const STIX_PATTERNS = {
  crypto_wallet: (v, m) => `[x-cryptocurrency-wallet:address = '${esc(v)}' AND x-cryptocurrency-wallet:chain = '${esc(m.chain || 'unknown')}']`,
  payment_card: (v, m) => `[x-payment-card:bin = '${esc(m.bin || '')}' AND x-payment-card:last4 = '${esc(m.last4 || '')}']`,
  bank_routing: (v) => `[x-bank-account:routing_number = '${esc(v)}']`,
  bank_account: (v) => `[x-bank-account:account_number = '${esc(v)}']`,
  callback_number: (v, m) => `[x-phone-number:value = '${esc(m.e164 || v)}']`,
  origin_number: (v) => `[x-phone-number:value = '${esc(v)}']`,
  payment_tag: (v, m) => `[x-payment-handle:value = '${esc(v)}' AND x-payment-handle:rail = '${esc(m.rail || 'unknown')}']`,
  email: (v) => `[email-addr:value = '${esc(v)}']`,
  infrastructure: (v, m) =>
    m.kind === 'IPv4' ? `[ipv4-addr:value = '${esc(v)}']` : `[domain-name:value = '${esc(stripScheme(v))}']`,
  remote_access: (v) => `[x-remote-access-tool:name = '${esc(v)}']`,
};

const esc = (s) => String(s).replace(/'/g, "\\'");
const stripScheme = (s) => String(s).replace(/^https?:\/\//, '').split('/')[0];

const uuid5ish = (seed) =>
  `${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 8)}-` +
  `${crypto.createHash('sha1').update(seed).digest('hex').slice(8, 12)}-` +
  `4${crypto.createHash('sha1').update(seed).digest('hex').slice(13, 16)}-` +
  `a${crypto.createHash('sha1').update(seed).digest('hex').slice(17, 20)}-` +
  `${crypto.createHash('sha1').update(seed).digest('hex').slice(20, 32)}`;

// ─── Case file ──────────────────────────────────────────────────────────────

export async function buildCaseFile(sessionId) {
  const { session, intel, utterances } = await store.sessionBundle(sessionId);
  if (!session && !intel.length) return null;

  const persona = getPersona(session?.persona);
  const safeIntel = intel.map((item) => redactIntelItem(item, intel));
  const bySeverity = (s) => safeIntel.filter((i) => i.severity === s);

  // Cross-call correlation: has any of this appeared in another engagement?
  const repeats = [];
  for (const item of intel.filter((i) => ['crypto_wallet', 'bank_routing', 'callback_number', 'origin_number', 'payment_tag'].includes(i.type))) {
    const hits = await store.correlate(item.value);
    const others = [...new Set(hits.map((h) => h.session_id))].filter((s) => s !== sessionId);
    if (others.length) repeats.push({ ...redactIntelItem(item, intel), also_seen_in: others, occurrences: hits.length });
  }

  return {
    case_id: `TARPIT-${String(sessionId).toUpperCase()}`,
    generated_at: new Date().toISOString(),
    generated_by: 'Tarpit autonomous scam-baiting system',

    engagement: {
      session_id: sessionId,
      started_at: session?.['@timestamp'] || null,
      duration_seconds: session?.seconds_wasted ?? 0,
      transport: session?.transport || 'browser',
      persona_deployed: persona ? `${persona.name} (${persona.id})` : session?.persona,
      turns: session?.turns ?? 0,
      status: session?.status || 'unknown',
    },

    classification: {
      scam_type: session?.scam_type || 'unknown',
      impersonated_entity: session?.claimed_org || null,
      payment_rail: session?.payment_rail || null,
    },

    caller: {
      number: session?.caller_number || null,
      carrier: session?.caller_carrier || null,
      caller_id_attestation: session?.caller_attestation || null,
      // Stated plainly so nobody reads more into this than is there.
      note:
        session?.transport === 'twilio'
          ? 'Originating network data from SS7/SIP signalling and Twilio Lookup. No IP address exists for a PSTN call.'
          : 'Browser-based engagement — no originating telephony metadata.',
    },

    artifacts: {
      total: safeIntel.length,
      critical: bySeverity('critical').length,
      high: bySeverity('high').length,
      validated: safeIntel.filter((i) => String(i.meta?.validated || '').includes('PASS')).length,
      items: safeIntel.map((i) => ({
        type: i.type,
        label: i.label,
        value: i.value,
        severity: i.severity,
        validation: i.meta?.validated || null,
        detail: i.meta,
        captured_at: i['@timestamp'],
        stated_in: i.source_utterance,
      })),
    },

    correlation: {
      note: 'Artifacts also observed in other engagements — indicates a reused fraud channel rather than a one-off.',
      repeats,
    },

    transcript: utterances.map((u) => ({
      at: u['@timestamp'],
      speaker: u.speaker === 'scammer' ? 'SUSPECT' : 'DECOY',
      text: redactPaymentText(u.text, intel),
    })),

    disclosure: {
      recording_party: 'Automated decoy system operated by the number holder.',
      consent_basis:
        'Recording is of a call placed TO the system operator by an unsolicited party. Review one-party/two-party consent rules for your jurisdiction before using this material in a filing.',
      ai_disclosure:
        'The DECOY side of this transcript was generated by an AI system. No human was impersonated and no real personal data was disclosed to the suspect.',
    },
  };
}

// ─── STIX 2.1 ───────────────────────────────────────────────────────────────

export function toStixBundle(caseFile) {
  const now = caseFile.generated_at;
  const objects = [
    {
      type: 'identity',
      spec_version: '2.1',
      id: TARPIT_IDENTITY_ID,
      created: now,
      modified: now,
      name: 'Tarpit',
      identity_class: 'system',
      description: 'Autonomous scam-baiting decoy and telephony threat-intel collector.',
    },
  ];

  const indicatorIds = [];
  for (const item of caseFile.artifacts.items) {
    const make = STIX_PATTERNS[item.type];
    if (!make) continue;
    const pattern = make(item.value, item.detail || {});
    const id = `indicator--${uuid5ish(`${caseFile.case_id}:${item.type}:${item.value}`)}`;
    indicatorIds.push(id);
    objects.push({
      type: 'indicator',
      spec_version: '2.1',
      id,
      created_by_ref: TARPIT_IDENTITY_ID,
      created: item.captured_at || now,
      modified: item.captured_at || now,
      name: `${item.label}: ${item.value}`,
      description: item.validation
        ? `${item.label} obtained during a live scam call. Validation: ${item.validation}.`
        : `${item.label} obtained during a live scam call.`,
      indicator_types: ['malicious-activity'],
      pattern,
      pattern_type: 'stix',
      valid_from: item.captured_at || now,
      confidence: { critical: 90, high: 75, medium: 55, low: 30 }[item.severity] ?? 50,
      labels: [item.type, item.severity],
    });
  }

  objects.push({
    type: 'report',
    spec_version: '2.1',
    id: `report--${uuid5ish(caseFile.case_id)}`,
    created_by_ref: TARPIT_IDENTITY_ID,
    created: now,
    modified: now,
    name: `${caseFile.case_id} — ${caseFile.classification.scam_type} telephone fraud`,
    description:
      `Decoy engagement lasting ${Math.round(caseFile.engagement.duration_seconds)}s. ` +
      `${caseFile.artifacts.total} artifacts captured, ${caseFile.artifacts.validated} checksum-validated.`,
    report_types: ['threat-report'],
    published: now,
    object_refs: indicatorIds.length ? indicatorIds : [TARPIT_IDENTITY_ID],
  });

  return { type: 'bundle', id: `bundle--${uuid5ish(`bundle:${caseFile.case_id}`)}`, objects };
}

// ─── FTC pre-fill ───────────────────────────────────────────────────────────

export function toFtcComplaint(caseFile) {
  const payment = caseFile.artifacts.items.filter((i) =>
    ['crypto_wallet', 'bank_routing', 'bank_account', 'payment_tag', 'gift_card', 'payment_card'].includes(i.type)
  );

  return {
    portal: 'https://reportfraud.ftc.gov/',
    note: 'The FTC accepts complaints only through its web form — there is no public filing API. These are the field values to paste.',
    fields: {
      what_happened: [
        `An unsolicited caller contacted this number claiming to represent ${caseFile.classification.impersonated_entity || 'an unspecified organization'}.`,
        `The caller's stated scheme was consistent with ${String(caseFile.classification.scam_type).replace(/_/g, ' ')} fraud.`,
        payment.length
          ? `They directed payment to: ${payment.map((p) => `${p.label} ${p.value}`).join('; ')}.`
          : 'No payment destination was obtained before the call ended.',
        `The call lasted ${Math.round(caseFile.engagement.duration_seconds)} seconds. A full transcript is available.`,
      ].join(' '),
      contact_method: caseFile.engagement.transport === 'twilio' ? 'Phone call' : 'Other',
      caller_phone: caseFile.caller.number || 'Unknown / not presented',
      business_name: caseFile.classification.impersonated_entity || 'Unknown',
      amount_requested: caseFile.artifacts.items.find((i) => i.type === 'coercion' && /amount/i.test(i.value))?.value || 'See narrative',
      money_sent: 'No — engagement was with an automated decoy; no funds were transferred.',
      payment_methods_requested: [...new Set(payment.map((p) => p.label))],
    },
  };
}

// ─── Markdown rendering ─────────────────────────────────────────────────────

export function toMarkdown(caseFile) {
  const L = [];
  const p = (s = '') => L.push(s);

  p(`# ${caseFile.case_id}`);
  p();
  p(`**Generated** ${caseFile.generated_at} by ${caseFile.generated_by}`);
  p();
  p('## Classification');
  p();
  p(`| Field | Value |`);
  p(`|---|---|`);
  p(`| Scam type | ${caseFile.classification.scam_type} |`);
  p(`| Impersonated entity | ${caseFile.classification.impersonated_entity || '—'} |`);
  p(`| Payment rail | ${caseFile.classification.payment_rail || '—'} |`);
  p(`| Duration | ${Math.round(caseFile.engagement.duration_seconds)}s |`);
  p(`| Persona deployed | ${caseFile.engagement.persona_deployed} |`);
  p();
  p('## Caller');
  p();
  p(`| Field | Value |`);
  p(`|---|---|`);
  p(`| Number | ${caseFile.caller.number || '—'} |`);
  p(`| Carrier | ${caseFile.caller.carrier || '—'} |`);
  p(`| Caller ID attestation | ${caseFile.caller.caller_id_attestation || '—'} |`);
  p();
  p(`> ${caseFile.caller.note}`);
  p();
  p(`## Artifacts (${caseFile.artifacts.total}, ${caseFile.artifacts.validated} checksum-validated)`);
  p();
  p(`| Severity | Type | Value | Validation |`);
  p(`|---|---|---|---|`);
  for (const i of caseFile.artifacts.items) {
    p(`| ${i.severity} | ${i.label} | \`${i.value}\` | ${i.validation || '—'} |`);
  }

  if (caseFile.correlation.repeats.length) {
    p();
    p('## Cross-engagement correlation');
    p();
    for (const r of caseFile.correlation.repeats) {
      p(`- \`${r.value}\` (${r.label}) also seen in ${r.also_seen_in.length} other engagement(s): ${r.also_seen_in.join(', ')}`);
    }
  }

  p();
  p('## Transcript');
  p();
  for (const t of caseFile.transcript) {
    p(`**${t.speaker}:** ${t.text}`);
    p();
  }

  p('## Disclosure');
  p();
  p(`- ${caseFile.disclosure.ai_disclosure}`);
  p(`- ${caseFile.disclosure.consent_basis}`);

  return L.join('\n');
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

/** POST the package to a downstream system, if one is configured. */
export async function dispatch(caseFile, url) {
  if (!url) return { dispatched: false, reason: 'no REPORT_WEBHOOK_URL configured' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_file: caseFile, stix: toStixBundle(caseFile) }),
    });
    return { dispatched: res.ok, status: res.status };
  } catch (err) {
    return { dispatched: false, reason: err.message };
  }
}
