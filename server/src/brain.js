import OpenAI from 'openai';
import { config } from './config.js';
import { TACTICS } from './personas.js';

export const openai = config.openai.key ? new OpenAI({ apiKey: config.openai.key }) : null;

const MAX_HISTORY_TURNS = 24;

/** Trim history but always keep the opening exchange for narrative continuity. */
export function trimHistory(history) {
  if (history.length <= MAX_HISTORY_TURNS) return history;
  return [...history.slice(0, 2), ...history.slice(-(MAX_HISTORY_TURNS - 2))];
}

/**
 * Stream one persona reply.
 *
 * `tactics` are situational directives derived from live signals (exit intent,
 * suspicion, payment pressure). They are injected as a system turn immediately
 * before generation, so the agent changes strategy mid-call instead of running
 * one frozen prompt for the whole engagement.
 *
 * Yields text deltas already buffered to word boundaries, which is the right
 * granularity to hand to a streaming TTS socket.
 */
export async function* streamPersonaReply({ persona, history, tactics = [], elapsedSeconds = 0, signal }) {
  if (!openai) {
    yield "Oh, uh... hold on now, I think something's wrong with my phone.";
    return;
  }

  const messages = [{ role: 'system', content: persona.systemPrompt }];

  // Long-call awareness: the longer they've stayed, the more invested they are,
  // and the harder the agent should work to protect the streak.
  if (elapsedSeconds > 120) {
    messages.push({
      role: 'system',
      content: `SITUATION: you have kept this caller on the line for ${Math.floor(
        elapsedSeconds / 60
      )} minutes. They are heavily invested and unlikely to walk away now. Keep dangling the carrot — stay maximally cooperative, stay maximally slow.`,
    });
  }

  for (const t of tactics) {
    if (TACTICS[t]) messages.push({ role: 'system', content: TACTICS[t] });
  }

  messages.push(...trimHistory(history));

  const stream = await openai.chat.completions.create(
    {
      model: config.openai.model,
      messages,
      stream: true,
      temperature: 0.95,
      presence_penalty: 0.6,
      frequency_penalty: 0.35,
      // Brevity comes from the prompt; this is only a runaway guard, set high
      // enough that a reply is never cut off mid-sentence.
      max_tokens: 90,
    },
    { signal }
  );

  let buf = '';
  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content;
    if (!delta) continue;
    buf += delta;

    // Flush on CLAUSE boundaries, never on word boundaries.
    //
    // This is the difference between speech and dictation. A TTS engine plans
    // intonation across the span of text it is handed: give it "Oh my heavens,"
    // and it produces one falling phrase; give it "Oh my " then "heavens, " and
    // it produces two unrelated fragments with their own stress patterns, which
    // is exactly what reads as a machine reading a list.
    //
    // Latency is covered by the filler already playing, so waiting for a whole
    // clause costs nothing the caller can hear.
    let cut;
    while ((cut = findClauseEnd(buf)) !== -1) {
      const piece = buf.slice(0, cut + 1);
      buf = buf.slice(cut + 1);
      if (piece.trim()) yield piece;
    }

    // Runaway guard: a clause this long without punctuation would stall audio.
    if (buf.length > 160) {
      const lastSpace = buf.lastIndexOf(' ');
      if (lastSpace > 40) {
        yield buf.slice(0, lastSpace + 1);
        buf = buf.slice(lastSpace + 1);
      }
    }
  }
  if (buf.trim()) yield buf;
}

/**
 * Index of the next clause-ending character, or -1.
 *
 * Sentence enders always cut. Commas cut only once enough text has accumulated
 * to be worth speaking as a unit — otherwise "Oh, " ships on its own and we are
 * back to fragments.
 */
const ABBREVIATIONS = /(?:^|\s)(mr|mrs|ms|dr|st|jr|sr|prof|rev|lt|sgt|capt|dept|apt|no|vs|etc|inc|ltd|co|u\.s|a\.m|p\.m)$/i;

function findClauseEnd(buf) {
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];

    if (c === '.' || c === '!' || c === '?') {
      const next = buf[i + 1];
      // Text arrives a character at a time, so a terminator at the end of the
      // buffer has no lookahead yet. Wait for the next character rather than
      // guessing — otherwise "5.000" splits before the "0" ever shows up.
      if (next === undefined) continue;
      // Real sentence ends are followed by space. "5.000" and "I.R.S" are not.
      if (!/\s/.test(next)) continue;
      // "Mr. Biscuits" — an abbreviation, not a sentence. Splitting here stops
      // the voice dead on the title, which is worse than not splitting at all.
      if (c === '.' && ABBREVIATIONS.test(buf.slice(0, i))) continue;
      // A lone initial: "J. Miller".
      if (c === '.' && /(?:^|[\s.])[A-Z]$/.test(buf.slice(0, i))) continue;
      return i;
    }

    if ((c === ',' || c === ';' || c === ':' || c === '\u2014') && i >= 28) return i;
  }
  return -1;
}

/** Strip anything that shouldn't be spoken aloud. */
export function sanitizeForSpeech(text) {
  return text
    .replace(/\*[^*]*\*/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
