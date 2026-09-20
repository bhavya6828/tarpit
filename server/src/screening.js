import { extractIntel, detectSignals } from './intel.js';

/**
 * Deciding whether a call is a scam.
 *
 * Two stages. Inbound signalling gives a prior before anybody speaks, then what
 * the caller says is scored using the same extraction that collects evidence.
 * Nothing here calls a model: the decision has to be explainable to whoever is
 * being protected, and a list of reasons is worth more than a probability.
 */

// Engagement needs a decisive score; release only needs the call to look
// ordinary once enough has been said. The costs are not symmetric.
export const ENGAGE_AT = 60;
export const RELEASE_BELOW = 25;
export const RELEASE_AFTER_UTTERANCES = 2;

/** Pre-speech risk from inbound call signalling. Never a verdict on its own. */
export function telephonyPrior(caller) {
  if (!caller) return { score: 0, reasons: [] };

  const reasons = [];
  let score = 0;

  const attestation = String(caller.attestation || '').toLowerCase();
  if (attestation === 'failed') {
    score += 35;
    reasons.push('Caller ID failed cryptographic validation');
  } else if (attestation === 'c' || attestation === 'none' || !attestation) {
    score += 25;
    reasons.push('Caller ID is not vouched for by the originating carrier');
  } else if (attestation === 'b') {
    score += 5;
    reasons.push('Carrier knows the customer but not that they own this number');
  }

  if (String(caller.lineType || '').toLowerCase().includes('voip')) {
    score += 10;
    reasons.push('Originates on VoIP');
  }

  if (!caller.from) {
    score += 15;
    reasons.push('No caller ID presented');
  }

  return { score, reasons };
}

// Ordinary calls that happen to mention money should not be swept up.
const ORDINARY = [
  [/\b(appointment|reschedul|confirm(ing|ation)?|booking|reservation)\b/i, 'Confirms an appointment'],
  [/\b(delivery|deliver|package|parcel|dispatch(ed)?|arriving)\b/i, 'Concerns a delivery'],
  [/\b(prescription|pharmacy|surgery|clinic|dentist|doctor)\b/i, 'Healthcare context'],
  [/\b(returning your call|you called us|you left a message)\b/i, 'Returning a call'],
];

const AUTHORITY = /\b(IRS|Internal Revenue|Social Security|Medicare|FBI|DEA|sheriff|police|Amazon|Microsoft|Apple Support|Geek Squad|PayPal|Norton|McAfee)\b/i;

/**
 * Score one thing the caller said.
 *
 * The weights say what the demand actually is: being told to install remote
 * access is on its own decisive, while claiming to be a government agency is
 * only suspicious until paired with what they want.
 */
export function scoreUtterance(text) {
  const reasons = [];
  let score = 0;

  const found = extractIntel(text, { sessionId: 'screen', seen: new Set() });
  const types = new Set(found.map((f) => f.type));

  if (types.has('remote_access')) {
    score += 65;
    reasons.push('Directs the caller to install remote-access software');
  }
  if (types.has('crypto_wallet')) {
    score += 55;
    reasons.push('Requests payment to a crypto wallet');
  }
  if (types.has('gift_card')) {
    score += 50;
    reasons.push('Requests payment by gift card');
  }
  if (types.has('bank_routing') || types.has('bank_account') || types.has('payment_tag')) {
    score += 40;
    reasons.push('Directs payment to an account it supplied');
  }

  if (AUTHORITY.test(text)) {
    score += 25;
    reasons.push('Claims to represent an authority or major brand');
  }

  const coercion = found.filter((f) => f.type === 'coercion');
  if (coercion.length) {
    score += Math.min(30, coercion.length * 15);
    reasons.push(`Pressure tactics: ${coercion.map((c) => c.value).join(', ')}`);
  }

  if (detectSignals(text).includes('payment_pressure')) {
    score += 10;
    reasons.push('Pushes for payment');
  }

  for (const [pattern, reason] of ORDINARY) {
    if (pattern.test(text)) {
      score -= 20;
      reasons.push(`Ordinary call marker: ${reason.toLowerCase()}`);
    }
  }

  return { score: Math.max(0, score), reasons };
}

/**
 * The running decision.
 *
 * `screening` is a real answer, not an absence of one. Staying neutral costs
 * almost nothing, so the system only commits when the evidence justifies it.
 */
export function screeningVerdict({ score, utterances }) {
  if (score >= ENGAGE_AT && utterances >= 1) return 'scam';
  if (score < RELEASE_BELOW && utterances >= RELEASE_AFTER_UTTERANCES) return 'legitimate';
  return 'screening';
}
