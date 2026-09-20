/**
 * Simulate an inbound scam call — no microphone, no human.
 *
 * Synthesizes a scammer with ElevenLabs, streams that audio into the running
 * server exactly as the browser's mic would, and prints the live loop. Use it
 * to regression-test the whole pipeline, or as a backup demo if the room is
 * too loud to talk over.
 *
 *   npm run simulate
 *   npm run simulate -- --persona dale --script "your scam script here"
 */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { synthesizeOnce } from '../server/src/elevenlabs.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const PERSONA = flag('persona', 'harold');
const PORT = flag('port', process.env.PORT || '8787');
const HOLD = Number(flag('hold', '35')); // seconds to stay on the line
const SCAMMER_VOICE = flag('voice', 'pNInz6obpgDQGcFmaJgB');

// Separate utterances, not one monologue. A caller who never stops talking gives
// the persona no turn boundary, which makes response latency unmeasurable and is
// nothing like a real call.
const DEFAULT_SCRIPT = [
  'Sir, this is Agent Miller with the I R S.',
  'You owe five thousand dollars in back taxes.',
  'Wire it to routing number zero two one zero zero zero zero two one.',
  'Did you write that down? Read it back to me.',
  'Or call me back at six one seven, five five five, zero one four two.',
].join(' | ');
// Pipe separates utterances; each is spoken, then the caller waits.
const SCRIPT = flag('script', DEFAULT_SCRIPT);
const GAP_MS = Number(flag('gap', '5000'));

const CACHE = path.resolve('data', `sim-${Buffer.from(SCRIPT).toString('base64url').slice(0, 24)}.raw`);

/** ElevenLabs gives us 24kHz; Deepgram is configured for 16kHz. */
function downsample24to16(pcm24) {
  const src = new Int16Array(pcm24.buffer, pcm24.byteOffset, pcm24.length / 2);
  const out = new Int16Array(Math.floor((src.length * 2) / 3));
  for (let i = 0; i < out.length; i++) {
    const x = i * 1.5;
    const i0 = Math.floor(x);
    const f = x - i0;
    out[i] = (src[i0] || 0) * (1 - f) + (src[i0 + 1] || 0) * f;
  }
  return Buffer.from(out.buffer);
}

async function getUtterance(text, index) {
  const file = CACHE.replace(/\.raw$/, `-${index}.raw`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const pcm = downsample24to16(await synthesizeOnce(SCAMMER_VOICE, text, { stability: 0.5, similarity_boost: 0.75 }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pcm);
  return pcm;
}

const lines = SCRIPT.split('|').map((t) => t.trim()).filter(Boolean);
const utterances = [];
for (const [i, line] of lines.entries()) {
  process.stdout.write(`  utterance ${i + 1}/${lines.length}… `);
  const pcm = await getUtterance(line, i);
  utterances.push({ text: line, pcm });
  console.log(`${(pcm.length / 2 / 16000).toFixed(1)}s`);
}
console.log(`  ${utterances.length} utterances, ${GAP_MS}ms of silence between them\n`);

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
ws.binaryType = 'nodebuffer';
const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`;
let audioBytes = 0;
let audioFrames = 0;
// Time from the caller's last word to the persona's first audible sample. This
// is the number the caller actually feels, and the one ElevenLabs judges on.
let callerStoppedAt = 0;
let awaitingReply = false;
// A listening noise is not a reply, so only audio after audio_start counts.
let replyStarted = false;
let replyStartedAt = 0;
const responseTimes = [];

ws.on('error', (e) => {
  console.error(`\n  cannot reach the server on :${PORT} — is "npm run dev" running?\n  ${e.message}`);
  process.exit(1);
});

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'start', personaId: PERSONA }));

  // Speak one utterance, then wait, exactly as a caller would. The silence is
  // real audio, because Deepgram finalizes on a heard pause, not on absence.
  const FRAME = 1024; // 512 samples @16kHz = 32ms
  let index = 0;
  let off = 0;
  let speaking = false;
  let waitUntil = Date.now() + 1500;

  setInterval(() => {
    const now = Date.now();

    if (!speaking) {
      if (now < waitUntil || index >= utterances.length) {
        ws.send(Buffer.alloc(FRAME));
        return;
      }
      speaking = true;
      off = 0;
    }

    const current = utterances[index].pcm;
    if (off >= current.length) {
      speaking = false;
      index++;
      waitUntil = now + GAP_MS;
      if (index >= utterances.length) console.log(`${ts()} ◀ caller has finished`);
      ws.send(Buffer.alloc(FRAME));
      return;
    }

    ws.send(current.subarray(off, off + FRAME));
    off += FRAME;
  }, 32);

  const runtime = utterances.reduce((a, u) => a + u.pcm.length / 2 / 16000, 0) * 1000 + utterances.length * GAP_MS + 8000;
  setTimeout(() => ws.send(JSON.stringify({ type: 'stop' })), runtime);
  setTimeout(finish, runtime + 2000);
});

ws.on('message', (d, isBinary) => {
  if (isBinary) {
    audioBytes += d.length;
    audioFrames++;
    if (awaitingReply && replyStarted) {
      const ms = Date.now() - callerStoppedAt;
      // A caller who keeps talking produces several finals while one reply is
      // still being generated, so audio can land microseconds after a later
      // final while belonging to an earlier turn. Those are carryover, not a
      // response, and counting them would flatter the number.
      // Only count a reply that began after the caller stopped. A caller who
      // talks continuously produces finals while a previous reply is still
      // being spoken, and that audio belongs to the earlier turn.
      if (replyStartedAt < callerStoppedAt) {
        awaitingReply = false;
        replyStarted = false;
        return;
      }
      awaitingReply = false;
      replyStarted = false;
      responseTimes.push(ms);
      console.log(`${ts()}   \u23f1 first audio ${ms}ms after caller stopped`);
    }
    return;
  }
  const e = JSON.parse(d.toString());
  switch (e.type) {
    case 'transcript':
      if (e.speaker === 'scammer') {
        callerStoppedAt = Date.now();
        awaitingReply = true;
        replyStarted = false;
      }
      console.log(`${ts()} ${e.speaker === 'scammer' ? '◀ CALLER' : '▶ PERSONA'}: ${e.text}`);
      break;
    case 'intel':
      console.log(
        `${ts()}   ⚑ ${e.item.severity.toUpperCase().padEnd(9)}${e.item.type.padEnd(17)}${String(e.item.value).padEnd(20)}${JSON.stringify(e.item.meta)}`
      );
      break;
    case 'signals':
      console.log(`${ts()}   ⚡ tactic: ${e.signals.join(', ')}`);
      break;
    case 'enrichment':
      console.log(`${ts()}   ⊞ ${JSON.stringify(e.enrichment)}`);
      break;
    case 'audio_start':
      replyStarted = true;
      replyStartedAt = Date.now();
      break;
    case 'backchannel':
      console.log(`${ts()}   \u266a "${e.text}"  (listening while they talk)`);
      break;
    case 'interrupted':
      console.log(`${ts()}   ✂ barge-in`);
      break;
    case 'error':
      console.log(`${ts()}   ✗ ${e.scope}: ${e.message.slice(0, 80)}`);
      break;
    case 'session_end':
      console.log(
        `${ts()} ■ ${e.secondsWasted.toFixed(1)}s wasted · $${e.costDestroyed.toFixed(3)} destroyed · ${e.turns} turns · ${e.intelCount} artifacts`
      );
      break;
    default:
      break;
  }
});

function finish() {
  const secs = (audioBytes - audioFrames * 4) / 2 / 24000;
  console.log(`\n  persona spoke ${secs.toFixed(1)}s across ${audioFrames} audio frames`);
  if (responseTimes.length) {
    const sorted = [...responseTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(`  response latency: median ${median}ms, worst ${sorted[sorted.length - 1]}ms, over ${sorted.length} turn(s)`);
  }
  process.exit(0);
}
