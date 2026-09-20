/**
 * Threat-intel extraction.
 *
 * Two passes over the live transcript:
 *   1. Deterministic  — regex + checksum validation. Instant, zero-cost, and
 *                       the checksums are what separate a real routing number
 *                       from "the noise" (any 9 digits looks like an ABA).
 *   2. Enrichment     — a small LLM pass for the soft intel a regex can't see
 *                       (claimed employer, pressure tactic, threat type).
 *
 * Everything emitted here is shaped for Elasticsearch.
 */

// ─── Spoken-number normalization ────────────────────────────────────────────
// Deepgram's numerals=true handles most of this, but scammers read card
// numbers digit-by-digit with filler words in between and ASR gets creative.
const WORD_DIGITS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

const DIGIT_WORD_RE = /\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/gi;
// Runs of digit groups joined only by spaces/commas/dots/dashes.
const DIGIT_RUN_RE = /\b\d+(?:[ \t,.\-]+\d+)+\b/g;
// "oh" only counts as a zero when it is wedged between digits.
const SPOKEN_OH_RE = /(\d)[ \t,.\-]*\boh\b[ \t,.\-]*(?=\d)/gi;
// "double four" / "triple seven" — common when a scammer dictates an account.
const REPEAT_RE = /\b(double|triple)\s+(zero|one|two|three|four|five|six|seven|eight|nine|\d)\b/gi;

/**
 * Turn dictated numbers into digit strings.
 *
 * Deepgram's numerals=true covers the easy cases, but scammers read account
 * and card numbers one digit at a time with filler in between, and ASR emits
 * those as separate tokens. Without this the checksums never get a candidate.
 *
 * Runs in three passes so delimiters are never destroyed — an earlier version
 * glued the trailing separator onto the next word ("021000021or"), which broke
 * the \b anchor and silently dropped every routing number.
 */
export function normalizeSpokenDigits(text) {
  if (!text) return '';

  // 1. "double four" → "44"
  let out = text.replace(REPEAT_RE, (_, mult, digit) => {
    const d = WORD_DIGITS[String(digit).toLowerCase()] ?? digit;
    return d.repeat(String(mult).toLowerCase() === 'double' ? 2 : 3);
  });

  // 2. digit words → digits, delimiters left exactly as they were
  out = out.replace(DIGIT_WORD_RE, (m) => WORD_DIGITS[m.toLowerCase()]);

  // 3. "five oh five" → "505", only where it is surrounded by digits
  let prev;
  do {
    prev = out;
    out = out.replace(SPOKEN_OH_RE, '$10');
  } while (out !== prev);

  // 4. collapse digit groups separated only by spacing into one number
  out = out.replace(DIGIT_RUN_RE, (run) => run.replace(/\D/g, ''));

  return out;
}

// ─── Validators ─────────────────────────────────────────────────────────────

/** Luhn / mod-10. Every real payment card satisfies this; random digits do so 1 in 10. */
export function luhnValid(digits) {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** ABA routing checksum: 3(d1+d4+d7) + 7(d2+d5+d8) + (d3+d6+d9) ≡ 0 mod 10. */
export function abaValid(digits) {
  if (!/^\d{9}$/.test(digits)) return false;
  const d = [...digits].map(Number);
  const sum =
    3 * (d[0] + d[3] + d[6]) +
    7 * (d[1] + d[4] + d[7]) +
    1 * (d[2] + d[5] + d[8]);
  if (sum === 0) return false;
  // First two digits are the Federal Reserve routing symbol; 00 and 13-20 are unassigned.
  const prefix = Number(digits.slice(0, 2));
  const validPrefix =
    (prefix >= 1 && prefix <= 12) ||
    (prefix >= 21 && prefix <= 32) ||
    (prefix >= 61 && prefix <= 72) ||
    prefix === 80;
  return sum % 10 === 0 && validPrefix;
}

export function cardNetwork(digits) {
  if (/^4\d{12}(\d{3})?(\d{3})?$/.test(digits)) return 'Visa';
  if (/^(5[1-5]\d{14}|2(2[2-9]\d{12}|[3-6]\d{13}|7[01]\d{12}|720\d{12}))$/.test(digits)) return 'Mastercard';
  if (/^3[47]\d{13}$/.test(digits)) return 'American Express';
  if (/^6(?:011|5\d{2}|4[4-9]\d)\d{12}$/.test(digits)) return 'Discover';
  return 'Unknown';
}

/** Base58 check-ish sanity for legacy BTC addresses (no full hash check — ASR mangles these anyway). */
function plausibleBtc(addr) {
  return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(addr);
}

// ─── Extractors ─────────────────────────────────────────────────────────────

const GIFT_BRANDS = /\b(apple|itunes|google\s?play|amazon|steam|target|walmart|best\s?buy|visa\s?gift|ebay|sephora|razer\s?gold)\b/i;
const ACCOUNT_CONTEXT = /\b(account|acct|checking|savings|deposit|beneficiary|bank)\b/i;

const RULES = [
  {
    type: 'crypto_wallet',
    label: 'Crypto wallet',
    severity: 'critical',
    scan(t) {
      const out = [];
      for (const m of t.matchAll(/\b0x[a-fA-F0-9]{40}\b/g)) {
        out.push({ value: m[0], meta: { chain: 'Ethereum (EVM)', validated: 'address format' } });
      }
      for (const m of t.matchAll(/\b(?:bc1[a-zA-HJ-NP-Z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g)) {
        if (plausibleBtc(m[0])) out.push({ value: m[0], meta: { chain: 'Bitcoin', validated: 'address format' } });
      }
      for (const m of t.matchAll(/\b4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}\b/g)) {
        out.push({ value: m[0], meta: { chain: 'Monero', validated: 'address format' } });
      }
      return out;
    },
  },
  {
    type: 'payment_card',
    label: 'Payment card',
    severity: 'critical',
    scan(t) {
      const out = [];
      for (const m of t.matchAll(/\b(?:\d[ -]?){12,19}\b/g)) {
        const digits = m[0].replace(/\D/g, '');
        if (digits.length < 13 || digits.length > 19) continue;
        if (!luhnValid(digits)) continue;
        const network = cardNetwork(digits);
        out.push({
          value: `${digits.slice(0, 6)}${'•'.repeat(Math.max(0, digits.length - 10))}${digits.slice(-4)}`,
          raw: m[0],
          meta: { network, bin: digits.slice(0, 6), last4: digits.slice(-4), validated: 'Luhn mod-10 PASS' },
        });
      }
      return out;
    },
  },
  {
    type: 'bank_routing',
    label: 'ABA routing number',
    severity: 'critical',
    scan(t) {
      const out = [];
      for (const m of t.matchAll(/\b\d{9}\b/g)) {
        if (!abaValid(m[0])) continue;
        out.push({ value: m[0], meta: { validated: 'ABA mod-10 checksum PASS', fed_prefix: m[0].slice(0, 2) } });
      }
      return out;
    },
  },
  {
    type: 'callback_number',
    label: 'Callback number',
    severity: 'high',
    scan(t) {
      const out = [];
      for (const m of t.matchAll(/(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/g)) {
        const npa = m[1];
        if (/^(\d)\1\1$/.test(npa)) continue;
        // "my account number is 9988776655" is a drop account, not a callback.
        const lead = t.slice(Math.max(0, m.index - 32), m.index);
        if (ACCOUNT_CONTEXT.test(lead)) continue;
        out.push({
          value: `(${m[1]}) ${m[2]}-${m[3]}`,
          raw: m[0],
          meta: { area_code: npa, e164: `+1${m[1]}${m[2]}${m[3]}` },
        });
      }
      return out;
    },
  },
  {
    type: 'bank_account',
    label: 'Bank account (drop)',
    severity: 'high',
    scan(t) {
      const out = [];
      if (!ACCOUNT_CONTEXT.test(t)) return out;
      for (const m of t.matchAll(/\b\d{8,17}\b/g)) {
        if (m[0].length === 9 && abaValid(m[0])) continue; // already captured as routing
        if (luhnValid(m[0]) && m[0].length >= 13) continue; // already captured as card
        if (/^(\d)\1+$/.test(m[0])) continue; // 00000000
        out.push({ value: m[0], meta: { digits: m[0].length, context: 'stated near payment language' } });
      }
      return out;
    },
  },
  {
    type: 'payment_tag',
    label: 'P2P payment handle',
    severity: 'high',
    scan(t) {
      const out = [];
      for (const m of t.matchAll(/\$[A-Za-z][A-Za-z0-9_]{2,19}\b/g)) {
        out.push({ value: m[0], meta: { rail: 'Cash App $cashtag' } });
      }
      for (const m of t.matchAll(/\b(zelle|venmo|cash\s?app|wise|revolut)\b[^.!?]{0,40}?\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi)) {
        out.push({ value: m[2], meta: { rail: m[1].replace(/\s+/g, ' ') } });
      }
      return out;
    },
  },
  {
    type: 'gift_card',
    label: 'Gift card demand',
    severity: 'high',
    scan(t) {
      const out = [];
      const brand = t.match(GIFT_BRANDS);
      if (brand && /\b(gift|card|code|redeem|scratch|voucher)\b/i.test(t)) {
        out.push({ value: `${brand[0]} gift card`, meta: { brand: brand[0], rail: 'gift card laundering' } });
      }
      for (const m of t.matchAll(/\b[A-Z0-9]{4}[- ][A-Z0-9]{4}[- ][A-Z0-9]{4}(?:[- ][A-Z0-9]{4})?\b/g)) {
        out.push({ value: m[0], meta: { rail: 'gift card code format' } });
      }
      return out;
    },
  },
  {
    type: 'email',
    label: 'Email address',
    severity: 'medium',
    scan(t) {
      return [...t.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)].map((m) => ({
        value: m[0],
        meta: { domain: m[0].split('@')[1] },
      }));
    },
  },
  {
    type: 'infrastructure',
    label: 'Network infrastructure',
    severity: 'medium',
    scan(t) {
      const out = [];
      for (const m of t.matchAll(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g)) {
        out.push({ value: m[0], meta: { kind: 'IPv4' } });
      }
      for (const m of t.matchAll(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|info|xyz|online|site|live|support|help|desk)\b(?:\/\S*)?/gi)) {
        if (/@/.test(m[0])) continue;
        out.push({ value: m[0], meta: { kind: 'domain/url' } });
      }
      return out;
    },
  },
  {
    type: 'remote_access',
    label: 'Remote-access tooling',
    severity: 'critical',
    scan(t) {
      const out = [];
      const tools = /\b(anydesk|teamviewer|ultraviewer|supremo|logmein|connectwise|screenconnect|splashtop|quick\s?assist|rustdesk)\b/gi;
      for (const m of t.matchAll(tools)) {
        out.push({ value: m[0], meta: { kind: 'RAT / remote desktop', tactic: 'device takeover' } });
      }
      for (const m of t.matchAll(/\b\d{9,10}\b/g)) {
        if (/anydesk|teamviewer/i.test(t)) out.push({ value: m[0], meta: { kind: 'possible remote-access session ID' } });
      }
      return out;
    },
  },
  {
    type: 'impersonation',
    label: 'Claimed authority',
    severity: 'medium',
    scan(t) {
      const out = [];
      const orgs = /\b(IRS|Internal Revenue|Social Security|Medicare|FBI|DEA|Sheriff|Police Department|Amazon|Microsoft|Apple Support|Geek Squad|PayPal|Norton|McAfee|Publishers Clearing|Wells Fargo|Bank of America|Chase|Visa|Mastercard)\b/gi;
      for (const m of t.matchAll(orgs)) {
        out.push({ value: m[0], meta: { kind: 'impersonated entity' } });
      }
      for (const m of t.matchAll(/\b(?:badge|employee|agent|officer|case|file|warrant)\s*(?:number|no\.?|id|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,14})\b/gi)) {
        if (!/\d/.test(m[1])) continue; // a bare name is an alias, not an identifier
        out.push({ value: m[1], meta: { kind: 'claimed badge/case identifier' } });
      }
      const TITLE = '[Aa]gent|[Oo]fficer|[Dd]etective|[Ii]nspector|[Mm]r\\.?|[Mm]s\\.?|[Mm]rs\\.?';
      const AUTHORITY = '[Aa]gent|[Oo]fficer|[Dd]etective|[Ii]nspector';
      const NAME = '[A-Z][a-z]{2,}';
      const aliasRes = [
        new RegExp(`\\b(?:[Mm]y name is|[Tt]his is|[Ii]'?m)\\s+(?:${TITLE})?\\s*(${NAME})(?:\\s+(${NAME}))?\\b`, 'g'),
        // Standalone titles are restricted to authority claims — "Mr. Smith"
        // alone is too weak a signal and fires on ordinary conversation.
        new RegExp(`\\b(?:${AUTHORITY})\\s+(${NAME})(?:\\s+(${NAME}))?\\b`, 'g'),
      ];
      for (const re of aliasRes) {
        for (const m of t.matchAll(re)) {
          out.push({ value: [m[1], m[2]].filter(Boolean).join(' '), meta: { kind: 'claimed alias' } });
        }
      }
      return out;
    },
  },
  {
    type: 'coercion',
    label: 'Coercion tactic',
    severity: 'low',
    scan(t) {
      const out = [];
      const tactics = [
        [/\b(arrest|warrant|police|jail|prison|deport|lawsuit|sue you|law enforcement)\b/i, 'legal threat'],
        [/\b(right now|immediately|within the hour|last chance|final (notice|warning)|expire)\b/i, 'artificial urgency'],
        [/\b(do not (tell|hang|talk)|don'?t tell (anyone|your)|stay on the line|keep this (between|confidential))\b/i, 'isolation'],
        [/\b(frozen|suspended|locked|compromised|breach|unauthorized (charge|access))\b/i, 'account-jeopardy pretext'],
        [/\b(refund|overpaid|owe|back taxes|settlement|prize|won)\b/i, 'financial pretext'],
      ];
      for (const [re, name] of tactics) {
        const m = t.match(re);
        if (m) out.push({ value: name, meta: { trigger: m[0] } });
      }
      return out;
    },
  },
];

const SEVERITY_SCORE = { critical: 95, high: 75, medium: 50, low: 25 };

/**
 * Deterministic pass. Returns normalized intel records ready for Elastic.
 * `seen` is a Set the caller owns, so we never emit the same artifact twice
 * in one engagement.
 */
/** Rule types that compete over the same digits; earlier wins and masks the span. */
const MASKING_TYPES = new Set([
  'crypto_wallet', 'payment_card', 'bank_routing', 'callback_number',
  'payment_tag', 'gift_card', 'bank_account',
]);

function scanVariant(text, rulesOutput, sessionId, speaker, seen) {
  // `work` shrinks as rules claim spans — a 16-digit card can't also be read
  // as a phone number hiding inside its own digits.
  let work = text;

  for (const rule of RULES) {
    let hits;
    try {
      hits = rule.scan(work) || [];
    } catch {
      continue;
    }

    for (const hit of hits) {
      // Dedupe on the alphanumeric core so the raw and digit-normalized passes
      // don't both report "44-2291" and "442291" as separate artifacts.
      const key = `${rule.type}:${String(hit.value).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      if (!seen.has(key)) {
        seen.add(key);
        rulesOutput.push({
          id: `${sessionId || 'sess'}-${key.replace(/\s+/g, '_')}-${Date.now()}`,
          session_id: sessionId,
          type: rule.type,
          label: rule.label,
          value: hit.value,
          severity: rule.severity,
          score: SEVERITY_SCORE[rule.severity] ?? 40,
          speaker,
          meta: hit.meta || {},
          source_utterance: text.slice(0, 400),
          '@timestamp': new Date().toISOString(),
        });
      }

      if (MASKING_TYPES.has(rule.type)) {
        const raw = hit.raw ?? String(hit.value);
        const at = work.indexOf(raw);
        if (at !== -1) {
          work = work.slice(0, at) + ' '.repeat(raw.length) + work.slice(at + raw.length);
        }
      }
    }
  }
}

/**
 * Deterministic pass. Returns normalized intel records ready for Elasticsearch.
 * `seen` is a Set owned by the caller, so an artifact is reported once per
 * engagement no matter how many times the scammer repeats it.
 */
export function extractIntel(rawText, { sessionId, speaker = 'scammer', seen = new Set() } = {}) {
  const text = rawText || '';
  const found = [];

  scanVariant(text, found, sessionId, speaker, seen);

  // Scan the digit-normalized text too — that's where dictated card and
  // routing numbers actually become checksummable.
  const normalized = normalizeSpokenDigits(text);
  if (normalized !== text) scanVariant(normalized, found, sessionId, speaker, seen);

  return found;
}

/** Does this utterance look like the scammer is trying to leave? */
export function detectSignals(text) {
  const t = (text || '').toLowerCase();
  const signals = [];
  if (/\b(hang up|hanging up|goodbye|good bye|i'?m done|waste of (my )?time|forget it|not interested|call you back|transfer you|stupid|idiot|f\*+k|shut up)\b/.test(t)) {
    signals.push('exit_intent');
  }
  if (/\b(are you (a )?(bot|robot|ai|real|recording|machine)|is this (a )?(bot|recording)|you'?re not real|computer generated)\b/.test(t)) {
    signals.push('suspicion');
  }
  if (/\b(card|payment|pay|gift|bitcoin|wallet|transfer|wire|routing|zelle|cash app|send the money)\b/.test(t)) {
    signals.push('payment_pressure');
  }
  return signals;
}

// ─── LLM enrichment pass ────────────────────────────────────────────────────

const ENRICH_SCHEMA = `Return ONLY minified JSON matching:
{"scam_type":string,"claimed_org":string|null,"claimed_name":string|null,"payment_rail":string|null,"amount_demanded":string|null,"pressure_tactics":string[],"confidence":number}
scam_type is one of: irs_tax, tech_support, bank_fraud, social_security, gift_card, crypto_investment, romance, prize_lottery, utility, package_delivery, debt_collection, unknown.
confidence is 0..1. Use null when not stated. Do not invent values.`;

export async function enrichIntel(openai, model, transcript) {
  if (!openai || !transcript?.trim()) return null;
  try {
    const res = await openai.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a fraud analyst reading a live transcript of a scam call. ' +
            'The CALLER is the suspected scammer. Extract only what the caller actually stated. ' +
            ENRICH_SCHEMA,
        },
        { role: 'user', content: transcript.slice(-6000) },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
