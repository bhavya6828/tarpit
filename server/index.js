import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

import { config, missingKeys, twilioReady } from './src/config.js';
import { store } from './src/elastic.js';
import { Session } from './src/session.js';
import { personaSummaries } from './src/personas.js';
import { inboundTwiml, validateSignature, buildCallerProfile, attachMediaStream } from './src/twilio.js';
import { buildCaseFile, toStixBundle, toFtcComplaint, toMarkdown, dispatch } from './src/report.js';
import { requestAuthorized, SessionGate } from './src/security.js';

const app = express();
const sessionGate = new SessionGate(config.security.maxConcurrentSessions);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

// ─── REST ───────────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  const missing = missingKeys();
  res.json({
    ok: missing.length === 0,
    missing,
    services: {
      deepgram: !!config.deepgram.key,
      elevenlabs: !!config.elevenlabs.key,
      openai: !!config.openai.key,
      elastic: store.mode,
    },
    models: {
      stt: config.deepgram.model,
      tts: config.elevenlabs.model,
      llm: config.openai.model,
    },
    economics: config.economics,
    security: {
      mode: config.security.accessToken ? 'token' : 'local-only',
      activeSessions: sessionGate.size,
      maxConcurrentSessions: config.security.maxConcurrentSessions,
      maxSessionMinutes: config.security.maxSessionMs / 60_000,
    },
  });
});

app.get('/api/personas', (req, res) => res.json({ personas: personaSummaries() }));

// ─── Referral package ───────────────────────────────────────────────────────
//
// No public API files a complaint with the FBI, FTC or FCC — those are human
// web forms. So we produce what is genuinely actionable: a case file, a STIX
// 2.1 bundle for machine ingestion by carriers and fraud teams, and a
// field-by-field FTC pre-fill.

async function caseOr404(req, res) {
  const file = await buildCaseFile(req.params.sessionId);
  if (!file) {
    res.status(404).json({ error: `no engagement recorded for ${req.params.sessionId}` });
    return null;
  }
  return file;
}

function requireAccess(req, res, next) {
  if (requestAuthorized(req, config.security.accessToken)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

app.get('/api/report/:sessionId', async (req, res) => {
  const file = await caseOr404(req, res);
  if (file) res.json(file);
});

app.get('/api/report/:sessionId/stix', async (req, res) => {
  const file = await caseOr404(req, res);
  if (!file) return;
  res.type('application/json').set('Content-Disposition', `attachment; filename="${file.case_id}.stix.json"`).send(JSON.stringify(toStixBundle(file), null, 2));
});

app.get('/api/report/:sessionId/ftc', async (req, res) => {
  const file = await caseOr404(req, res);
  if (file) res.json(toFtcComplaint(file));
});

app.get('/api/report/:sessionId/markdown', async (req, res) => {
  const file = await caseOr404(req, res);
  if (!file) return;
  res.type('text/markdown').set('Content-Disposition', `attachment; filename="${file.case_id}.md"`).send(toMarkdown(file));
});

app.post('/api/report/:sessionId/dispatch', requireAccess, async (req, res) => {
  const file = await caseOr404(req, res);
  if (!file) return;
  const result = await dispatch(file, process.env.REPORT_WEBHOOK_URL);
  res.json({ case_id: file.case_id, ...result });
});

// ─── Twilio inbound call ────────────────────────────────────────────────────
//
// Dossiers are built in the webhook (where StirVerstat lives) and handed to the
// Media Stream a moment later, keyed by CallSid.
const pendingCalls = new Map();

app.post('/twilio/voice', async (req, res) => {
  const { publicUrl } = config.twilio;
  if (!publicUrl) return res.status(500).type('text/plain').send('PUBLIC_URL not configured');

  // Tunnels are public URLs. Without this the number is an open relay.
  const fullUrl = `${publicUrl}/twilio/voice`;
  if (!validateSignature(req, fullUrl)) {
    console.warn('[twilio] rejected request with bad signature');
    return res.status(403).type('text/plain').send('invalid signature');
  }

  const profile = await buildCallerProfile(req.body || {});
  if (profile.callSid) pendingCalls.set(profile.callSid, profile);
  setTimeout(() => profile.callSid && pendingCalls.delete(profile.callSid), 60000);

  console.log(
    `[twilio] inbound ${profile.from || 'unknown'} → ${profile.to || '?'}  ` +
      `carrier=${profile.carrier || '?'} line=${profile.lineType || '?'} attestation=${profile.attestation || 'none'}`
  );

  res.type('text/xml').send(inboundTwiml({ publicUrl, personaId: config.twilio.personaId }));
});

app.get('/api/twilio/status', (req, res) => {
  const ready = twilioReady();
  res.json({
    ...ready,
    number: config.twilio.number || null,
    publicUrl: config.twilio.publicUrl || null,
    webhook: config.twilio.publicUrl ? `${config.twilio.publicUrl}/twilio/voice` : null,
    persona: config.twilio.personaId,
  });
});
app.get('/api/intel/summary', async (req, res) => res.json(await store.summary()));
app.get('/api/intel/search', async (req, res) => res.json({ hits: await store.search(req.query.q || '') }));

// ─── WebSocket bridge ───────────────────────────────────────────────────────
//
// client → server : JSON control frames, or binary PCM16 @16kHz from the mic
// server → client : JSON events, or binary [uint32 turnId LE | PCM16 @24kHz]

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const twilioWss = new WebSocketServer({ noServer: true });

// Command-center clients watching whatever is happening, including phone calls
// they did not start themselves.
const monitors = new Set();
const broadcast = (evt) => {
  const payload = JSON.stringify(evt);
  for (const m of monitors) {
    if (m.readyState === WebSocket.OPEN) m.send(payload);
  }
};

const makeSession = (options) => {
  const session = new Session(options);
  if (!sessionGate.tryAdd(session)) return null;
  const release = (event) => {
    if (event.type !== 'session_end') return;
    sessionGate.delete(session);
    session.removeListener('event', release);
  };
  session.on('event', release);
  return session;
};

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/ws') {
    if (!requestAuthorized(req, config.security.accessToken)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/twilio') {
    twilioWss.handleUpgrade(req, socket, head, (ws) => twilioWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

twilioWss.on('connection', (ws) => {
  console.log('[twilio] media stream connected');
  attachMediaStream(ws, {
    pendingCalls,
    makeSession,
    // Mirror the live call into every open command center.
    onEvent: (evt) => broadcast({ ...evt, source: 'phone' }),
  });
});

wss.on('connection', (ws) => {
  let session = null;
  const alive = () => ws.readyState === WebSocket.OPEN;

  const sendEvent = (evt) => {
    if (alive()) ws.send(JSON.stringify(evt));
  };

  const sendAudio = ({ turnId, pcm }) => {
    if (!alive()) return;
    const header = Buffer.alloc(4);
    header.writeUInt32LE(turnId >>> 0, 0);
    ws.send(Buffer.concat([header, pcm]), { binary: true });
  };

  const attach = (s) => {
    s.on('event', sendEvent);
    s.on('audio', sendAudio);
  };

  const detach = (s) => {
    s?.removeListener('event', sendEvent);
    s?.removeListener('audio', sendAudio);
  };

  monitors.add(ws);
  sendEvent({
    type: 'hello',
    personas: personaSummaries(),
    elastic: store.mode,
    missing: missingKeys(),
    twilio: twilioReady().ok ? { number: config.twilio.number, persona: config.twilio.personaId } : null,
  });

  ws.on('message', async (data, isBinary) => {
    if (isBinary) {
      session?.pushAudio(Buffer.from(data));
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'start': {
        if (session) {
          await session.stop('restarted');
          detach(session);
        }
        session = makeSession({ personaId: msg.personaId });
        if (!session) {
          sendEvent({ type: 'error', scope: 'session', message: 'session capacity reached' });
          break;
        }
        attach(session);
        await session.start();
        break;
      }
      case 'stop': {
        if (session) {
          await session.stop('operator_ended');
          detach(session);
          session = null;
        }
        break;
      }
      case 'persona':
        session?.setPersona(msg.id);
        break;
      case 'inject':
        session?.injectScammerText(msg.text);
        break;
      case 'playback_done':
        session?.notePlaybackDone(msg.turnId);
        break;
      case 'mute_while_speaking':
        session?.setMuteWhileSpeaking(msg.value);
        break;
      case 'ping':
        sendEvent({ type: 'pong', t: Date.now() });
        break;
      default:
        break;
    }
  });

  ws.on('close', async () => {
    monitors.delete(ws);
    if (session) {
      await session.stop('disconnected');
      detach(session);
      session = null;
    }
  });

  ws.on('error', () => {});
});

// ─── Boot ───────────────────────────────────────────────────────────────────

// Listen first, connect to Elastic after. Index setup against a cold serverless
// project can take ten seconds, and there's no reason the audio bridge should be
// unreachable while that happens — writes fall back to the local store until
// the client is ready.
store.init().then(() => {
  if (store.mode === 'elastic') console.log('  └─ intel store    elastic (connected)');
});

server.listen(config.port, () => {
  const missing = missingKeys();
  console.log('');
  console.log('  ████ TARPIT  —  autonomous scam-baiter');
  console.log(`  ├─ control plane  http://localhost:${config.port}`);
  console.log(`  ├─ audio bridge   ws://localhost:${config.port}/ws`);
  console.log(`  ├─ stt            Deepgram ${config.deepgram.model}   ${config.deepgram.key ? 'ok' : 'NO KEY'}`);
  console.log(`  ├─ tts            ElevenLabs ${config.elevenlabs.model}   ${config.elevenlabs.key ? 'ok' : 'NO KEY'}`);
  console.log(`  ├─ brain          OpenAI ${config.openai.model}   ${config.openai.key ? 'ok' : 'NO KEY'}`);
  console.log(`  ├─ intel store    ${store.mode === 'elastic' ? 'elastic' : 'connecting…'}`);
  const tw = twilioReady();
  console.log(
    `  └─ phone          ${tw.ok ? `${config.twilio.number || 'ready'} → ${config.twilio.publicUrl}/twilio/voice` : `disabled (${tw.missing.join(', ')})`}`
  );
  if (missing.length) console.log(`\n  ⚠ missing keys in .env: ${missing.join(', ')}`);
  console.log('');
});
