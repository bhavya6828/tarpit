/**
 * Generate the room each persona is sitting in.
 *
 * Harold's opener says "let me turn the television down" — if that lands over
 * dead silence, the ear catches the lie before it catches anything else. These
 * loops sit under the voice and go through the same telephony filter, because
 * the scammer is hearing the room down the phone line too.
 *
 *   node --env-file=.env scripts/generate-ambience.mjs [--force]
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('web/public/ambience');
const FORCE = process.argv.includes('--force');
const KEY = process.env.ELEVENLABS_API_KEY;

if (!KEY) {
  console.error('ELEVENLABS_API_KEY missing — run with `node --env-file=.env`');
  process.exit(1);
}

const ROOMS = {
  harold:
    'quiet suburban living room ambience, a television murmuring softly in another room, ' +
    'faint refrigerator hum, occasional distant traffic, no music, no speech',
  dale:
    'home garage and kitchen ambience, a television playing sports quietly in the background, ' +
    'a dog barking twice far away, faint clatter, no music, no speech',
  kevin:
    'college dorm room ambience, laptop fan whirring, muffled hallway noise and a door closing, ' +
    'faint keyboard typing, no music, no speech',
  brenda:
    'warm southern kitchen ambience, birds outside an open window, a wall clock ticking, ' +
    'faint dishes clinking, no music, no speech',
};

fs.mkdirSync(OUT, { recursive: true });

for (const [id, prompt] of Object.entries(ROOMS)) {
  const file = path.join(OUT, `${id}.mp3`);
  if (fs.existsSync(file) && !FORCE) {
    console.log(`  ${id.padEnd(8)} cached (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
    continue;
  }

  process.stdout.write(`  ${id.padEnd(8)} generating… `);
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: 22,
      // Low influence keeps it as texture rather than a dramatic sound effect.
      prompt_influence: 0.25,
    }),
  });

  if (!res.ok) {
    console.log(`FAILED ${res.status}: ${(await res.text()).slice(0, 120)}`);
    continue;
  }

  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

console.log(`\n  ambience written to ${OUT}`);
