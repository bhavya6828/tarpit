/**
 * Voice lab — render the same line several ways so a human can pick.
 *
 * Latency is measurable; naturalness is not. This writes WAV files you can
 * play back to back, including a deliberate reproduction of the word-fragment
 * bug so the difference is audible rather than theoretical.
 *
 *   npm run voicelab
 *   npm run voicelab -- --persona brenda
 *   npm run voicelab -- --text "your line here"
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ElevenLabsStream } from '../server/src/elevenlabs.js';
import { PERSONAS, getPersona } from '../server/src/personas.js';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};

const PERSONA = getPersona(flag('persona', 'harold'));
const TEXT = flag(
  'text',
  'Oh my heavens, five thousand dollars? Hold on now, son, let me sit down for a second. Can you say that number again, slower?'
);
const OUT = path.resolve('data/voicelab');
const RATE = 24000;

fs.mkdirSync(OUT, { recursive: true });

/** Minimal 16-bit mono WAV wrapper so these open in any player. */
function wav(pcm, sampleRate = RATE) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Feed `chunks` into a streaming TTS socket exactly as the server would. */
function render(voiceId, voiceSettings, chunks) {
  return new Promise((resolve) => {
    const parts = [];
    const t0 = Date.now();
    let first = 0;
    const tts = new ElevenLabsStream({
      voiceId,
      voiceSettings,
      onAudio: (b) => {
        if (!first) first = Date.now() - t0;
        parts.push(b);
      },
      onDone: () => resolve({ pcm: Buffer.concat(parts), first }),
      onError: (e) => {
        console.log('   error:', e.message);
        resolve({ pcm: Buffer.concat(parts), first });
      },
    });
    tts.connect();
    setTimeout(() => {
      for (const c of chunks) tts.push(c);
      tts.end();
    }, 300);
    setTimeout(() => resolve({ pcm: Buffer.concat(parts), first }), 30000);
  });
}

/** The old bug: flush every ~12 chars at the nearest space. */
function wordFragments(text) {
  const out = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    const ls = buf.lastIndexOf(' ');
    if (ls > 0 && buf.length >= 12) {
      out.push(buf.slice(0, ls + 1));
      buf = buf.slice(ls + 1);
    }
  }
  if (buf) out.push(buf);
  return out;
}

const ABBR = /(?:^|\s)(mr|mrs|ms|dr|st|jr|sr|prof|rev|no|vs|etc)$/i;
function clauses(text) {
  const out = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    for (;;) {
      let cut = -1;
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (c === '.' || c === '!' || c === '?') {
          const n = buf[i + 1];
          if (n === undefined || !/\s/.test(n)) continue;
          if (c === '.' && ABBR.test(buf.slice(0, i))) continue;
          cut = i;
          break;
        }
        if ((c === ',' || c === ';' || c === ':') && i >= 28) {
          cut = i;
          break;
        }
      }
      if (cut === -1) break;
      out.push(buf.slice(0, cut + 1));
      buf = buf.slice(cut + 1);
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

console.log(`\n  persona: ${PERSONA.name}   voice: ${PERSONA.voiceId}`);
console.log(`  line:    "${TEXT}"\n`);

const variants = [
  ['1-BROKEN-word-fragments', wordFragments(TEXT), PERSONA.voiceSettings, 'the old bug: ~12-char fragments'],
  ['2-FIXED-whole-clauses', clauses(TEXT), PERSONA.voiceSettings, 'what ships now: whole clauses'],
  ['3-FIXED-one-shot', [TEXT], PERSONA.voiceSettings, 'entire line at once (upper bound on quality)'],
  [
    '4-FIXED-faster',
    clauses(TEXT),
    { ...PERSONA.voiceSettings, speed: Math.min(1.1, (PERSONA.voiceSettings.speed ?? 1) + 0.06) },
    'clauses, slightly quicker',
  ],
  [
    '5-FIXED-more-stable',
    clauses(TEXT),
    { ...PERSONA.voiceSettings, stability: 0.65, style: 0.15 },
    'clauses, steadier delivery',
  ],
];

const written = [];
for (const [name, chunks, settings, note] of variants) {
  process.stdout.write(`  ${name.padEnd(28)} ${String(chunks.length).padStart(2)} chunk(s)  `);
  const { pcm, first } = await render(PERSONA.voiceId, settings, chunks);
  if (!pcm.length) {
    console.log('no audio');
    continue;
  }
  const file = path.join(OUT, `${PERSONA.id}-${name}.wav`);
  fs.writeFileSync(file, wav(pcm));
  written.push(file);
  console.log(`${(pcm.length / 2 / RATE).toFixed(1)}s  first=${first}ms   ${note}`);
}

console.log(`\n  ${written.length} files in ${OUT}`);
console.log('  play them in order — 1 is the bug you heard, 2 is the fix.\n');

if (process.platform === 'darwin' && written.length) {
  execFile('open', [OUT], () => {});
}
