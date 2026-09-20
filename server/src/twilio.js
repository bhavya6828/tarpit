import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Twilio inbound-call transport.
 *
 * A real scammer dials a real number. Twilio answers, opens a bidirectional
 * Media Stream to us, and we run the same session loop the browser demo uses —
 * the only difference is the audio format, which stays mu-law 8kHz end to end
 * so nothing has to be resampled in our process.
 */

// ─── TwiML ──────────────────────────────────────────────────────────────────

export function inboundTwiml({ publicUrl, personaId }) {
  const wsUrl = `${publicUrl.replace(/^http/, 'ws')}/twilio`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}">
      <Parameter name="persona" value="${escapeXml(personaId)}" />
    </Stream>
  </Connect>
</Response>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// ─── Webhook authenticity ───────────────────────────────────────────────────

/**
 * Validate Twilio's request signature so the number can't be driven by anyone
 * who guesses the URL. Tunnels are public; this is the only thing standing
 * between a demo number and an open telephony relay.
 */
export function validateSignature(req, url) {
  const token = config.twilio.authToken;
  const signature = req.get('X-Twilio-Signature');
  if (!token || !signature) return false;

  const body = req.body || {};
  const data = Object.keys(body)
    .sort()
    .reduce((acc, k) => acc + k + body[k], url);

  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─── Caller forensics ───────────────────────────────────────────────────────

const ATTESTATION = {
  A: {
    label: 'A — full attestation',
    verdict: 'carrier vouches for this number and the caller\'s right to use it',
    spoofed: false,
  },
  B: {
    label: 'B — partial attestation',
    verdict: 'carrier knows the customer but not that they own this number',
    spoofed: false,
  },
  C: {
    label: 'C — gateway attestation',
    verdict: 'carrier cannot vouch for this number — consistent with spoofing',
    spoofed: true,
  },
};

/** Parse Twilio's StirVerstat header into a plain attestation grade. */
export function parseVerstat(verstat) {
  if (!verstat) return null;
  const v = String(verstat);
  const grade = v.match(/-([ABC])$/)?.[1];
  if (/Failed/i.test(v)) {
    return { attestation: 'failed', label: 'validation failed', verdict: 'caller ID failed cryptographic validation — spoofed', spoofed: true, verstat: v };
  }
  if (/No-TN-Validation/i.test(v) || !grade) {
    return { attestation: 'none', label: 'no attestation', verdict: 'originating carrier signed nothing — unverifiable caller ID', spoofed: true, verstat: v };
  }
  return { ...ATTESTATION[grade], attestation: grade, verstat: v };
}

/**
 * Twilio Lookup: carrier, line type, CNAM. This is the real answer to "what do
 * you learn about the caller" on a phone network — not an IP address.
 */
export async function lookupNumber(e164) {
  const { accountSid, authToken } = config.twilio;
  if (!accountSid || !authToken || !e164) return {};

  const url =
    `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}` +
    `?Fields=line_type_intelligence,caller_name`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(config.security.providerTimeoutMs),
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
    });
    if (!res.ok) return {};
    const d = await res.json();
    const lti = d.line_type_intelligence || {};
    return {
      carrier: lti.carrier_name || null,
      lineType: lti.type || null,
      mcc: lti.mobile_country_code || null,
      mnc: lti.mobile_network_code || null,
      callerName: d.caller_name?.caller_name || null,
      valid: d.valid ?? null,
      countryCode: d.country_code || null,
    };
  } catch {
    return {};
  }
}

/** Build the caller dossier handed to a Session at call start. */
export async function buildCallerProfile(params) {
  const from = params.From || params.Caller || null;
  const verstat = parseVerstat(params.StirVerstat);
  const lookup = await lookupNumber(from);

  return {
    transport: 'twilio',
    callSid: params.CallSid || null,
    from,
    to: params.To || null,
    fromCity: params.FromCity || null,
    fromState: params.FromState || null,
    fromCountry: params.FromCountry || null,
    callerName: params.CallerName || lookup.callerName || null,
    carrier: lookup.carrier || null,
    lineType: lookup.lineType || null,
    mcc: lookup.mcc || null,
    mnc: lookup.mnc || null,
    attestation: verstat?.attestation || null,
    attestationLabel: verstat?.label || null,
    attestationVerdict: verstat?.verdict || null,
    verstat: verstat?.verstat || null,
    likelySpoofed: verstat?.spoofed ?? null,
  };
}

// ─── Media Stream bridge ────────────────────────────────────────────────────

const FRAME_BYTES = 160; // 20ms of mu-law at 8kHz

/**
 * Wire one Twilio Media Stream socket to a Session.
 *
 * `makeSession` is injected so this module never imports Session directly and
 * stays testable without spinning up the whole stack.
 */
export function attachMediaStream(ws, { pendingCalls, makeSession, onEvent }) {
  let session = null;
  let streamSid = null;
  let callSid = null;
  let closed = false;

  const sendJson = (obj) => {
    if (!closed && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  /** Outbound persona audio: mu-law straight from ElevenLabs, framed for Twilio. */
  const onAudio = ({ pcm }) => {
    if (!streamSid) return;
    for (let off = 0; off < pcm.length; off += FRAME_BYTES) {
      const frame = pcm.subarray(off, Math.min(off + FRAME_BYTES, pcm.length));
      sendJson({ event: 'media', streamSid, media: { payload: frame.toString('base64') } });
    }
  };

  const onSessionEvent = (evt) => {
    onEvent?.(evt, session);
    // Barge-in: drop whatever Twilio still has buffered, or the persona keeps
    // talking over the scammer for seconds after we decided to stop.
    if (evt.type === 'audio_flush' || evt.type === 'interrupted') {
      if (streamSid) sendJson({ event: 'clear', streamSid });
    }
    if (evt.type === 'audio_end' && streamSid) {
      sendJson({ event: 'mark', streamSid, mark: { name: `turn-${evt.turnId}` } });
    }
  };

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case 'start': {
        streamSid = msg.start?.streamSid || null;
        callSid = msg.start?.callSid || null;

        // The webhook ran moments ago and stashed the dossier under CallSid.
        const caller = pendingCalls.get(callSid);
        if (!callSid || !caller) {
          await teardown('unknown_call');
          return;
        }
        pendingCalls.delete(callSid);

        const personaId = msg.start?.customParameters?.persona || config.twilio.personaId;
        session = makeSession({ personaId, transport: 'twilio', caller });
        if (!session) {
          await teardown('capacity_reached');
          return;
        }
        session.on('event', onSessionEvent);
        session.on('audio', onAudio);
        await session.start();
        break;
      }

      case 'media': {
        if (!session || msg.media?.track === 'outbound') break;
        const payload = msg.media?.payload;
        if (payload) session.pushAudio(Buffer.from(payload, 'base64'));
        break;
      }

      case 'mark': {
        const turnId = Number(String(msg.mark?.name || '').replace('turn-', ''));
        if (Number.isFinite(turnId)) session?.notePlaybackDone(turnId);
        break;
      }

      case 'stop': {
        await teardown('caller_hung_up');
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => teardown('stream_closed'));
  ws.on('error', () => teardown('stream_error'));

  async function teardown(reason) {
    if (closed) return;
    closed = true;
    if (session) {
      session.removeListener('event', onSessionEvent);
      session.removeListener('audio', onAudio);
      await session.stop(reason);
      session = null;
    }
    try {
      ws.close();
    } catch {}
  }

  return { get session() { return session; } };
}
