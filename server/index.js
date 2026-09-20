import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

import { config, missingKeys } from './src/config.js';
import { store } from './src/elastic.js';
import { Session } from './src/session.js';
import { personaSummaries } from './src/personas.js';

const app = express();
app.use(cors());
app.use(express.json());

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
  });
});

app.get('/api/personas', (req, res) => res.json({ personas: personaSummaries() }));
app.get('/api/intel/summary', async (req, res) => res.json(await store.summary()));
app.get('/api/intel/search', async (req, res) => res.json({ hits: await store.search(req.query.q || '') }));

// ─── WebSocket bridge ───────────────────────────────────────────────────────
//
// client → server : JSON control frames, or binary PCM16 @16kHz from the mic
// server → client : JSON events, or binary [uint32 turnId LE | PCM16 @24kHz]

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

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

  sendEvent({ type: 'hello', personas: personaSummaries(), elastic: store.mode, missing: missingKeys() });

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
        session = new Session({ personaId: msg.personaId });
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
  console.log(`  └─ intel store    ${store.mode === 'elastic' ? 'elastic' : 'connecting…'}`);
  if (missing.length) console.log(`\n  ⚠ missing keys in .env: ${missing.join(', ')}`);
  console.log('');
});
