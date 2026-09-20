import { extractIntel, luhnValid } from './intel.js';

const SENSITIVE_TYPES = new Set(['payment_card', 'bank_routing', 'bank_account']);

export function maskDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `${'*'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

const flexibleDigits = (digits) => digits.split('').join('[\\s.-]*');

export function redactPaymentText(value, intel = []) {
  let out = String(value || '');
  const detected = extractIntel(out);
  const candidates = [...intel, ...detected];
  for (const item of candidates.filter((entry) => ['bank_routing', 'bank_account'].includes(entry.type))) {
    const digits = String(item.value || '').replace(/\D/g, '');
    if (digits.length < 8) continue;
    out = out.replace(new RegExp(`(?<!\\d)${flexibleDigits(digits)}(?!\\d)`, 'g'), maskDigits(digits));
  }
  return out.replace(/(?<!\d)(?:\d[ \t.-]?){12,18}\d(?!\d)/g, (candidate) => {
    const digits = candidate.replace(/\D/g, '');
    return luhnValid(digits) ? maskDigits(digits) : candidate;
  });
}

export function redactIntelItem(item, intel = [item]) {
  return {
    ...item,
    value: SENSITIVE_TYPES.has(item.type) ? maskDigits(item.meta?.last4 || item.value) : item.value,
    source_utterance: redactPaymentText(item.source_utterance, intel),
  };
}
