import OpenAI from 'openai';
import { config } from './config.js';
import { TACTICS } from './personas.js';

export const openai = config.openai.key ? new OpenAI({ apiKey: config.openai.key }) : null;

const AUDIO_TAG_DIRECTION = `
VOICE DIRECTION: your line is spoken by an engine that acts on emotional cues
written in square brackets. Without them you are read accurately and flatly,
which sounds like a machine.

Use ONE bracketed cue per reply, and do not put it in the same place every
time. Opening every single turn with a cue is its own pattern. Often it belongs
mid-sentence, where the feeling actually changes, and some lines need none.
Choose what the moment actually calls for: [confused], [nervously], [frightened],
[hopeful], [sighs], [chuckles], [slowly], [whispering], [cheerfully].

Cues are direction, never dialogue. Never describe an action, only an emotion.
Write "[nervously] Oh my heavens, five thousand?" and never "[picks up wallet]".
`.trim();

const MAX_HISTORY_TURNS = 24;

/**
 * How the persona has recently started its turns.
 *
 * Opening every reply with the same interjection is the most machine-like thing
 * a generated voice can do, and it happens because nothing in the prompt says
 * otherwise. Feeding these back as phrases to avoid is what breaks the pattern.
 */
export function recentOpeners(history, limit = 4) {
  const spoken = (history || [])
    .filter((m) => m.role === 'assistant' && String(m.content || '').trim())
    .slice(-limit);

  return spoken.map((m) =>
    stripAudioTags(m.content)
      .split(/\s+/)
      .slice(0, 4)
      .join(' ')
      .replace(/[.,!?;:]+$/, '')
  );
}

/** Which of this persona's stock excuses have already been used aloud. */
export function spentObstacles(persona, history) {
  const said = (history || [])
    .filter((m) => m.role === 'assistant')
    .map((m) => String(m.content || ''))
    .join(' ');

  const spent = [];
  for (const [name, pattern] of Object.entries(persona?.obstacles || {})) {
    if (pattern.test(said)) spent.push(name);
  }
  return spent;
}

const ARTIFACT_ORDER = [
  'bank_routing',
  'bank_account',
  'crypto_wallet',
  'payment_card',
  'payment_tag',
  'gift_card',
  'callback_number',
];

/**
 * What the persona should already know, assembled from session state.
 *
 * A transcript alone makes a model improvise the next plausible line. Told
 * plainly that it already has the routing number, it stops asking for it and
 * stalls on something else, which is the behavior that reads as listening
 * rather than reciting.
 */
export function describeCallState({ persona, history, intel = [], enrichment = null, elapsedSeconds = 0, turnCount = 0 }) {
  const lines = [];

  const who = [enrichment?.claimed_name, enrichment?.claimed_org].filter(Boolean).join(' of ');
  if (who) lines.push(`The caller says he is ${who}.`);

  const demand = [enrichment?.amount_demanded, enrichment?.payment_rail && `by ${enrichment.payment_rail}`]
    .filter(Boolean)
    .join(' ');
  if (demand) lines.push(`He is demanding ${demand}.`);

  const captured = ARTIFACT_ORDER.flatMap((type) =>
    intel.filter((i) => i.type === type).map((i) => `${i.label} ${i.value}`)
  );
  if (captured.length) {
    lines.push(
      `You have ALREADY written down: ${captured.join('; ')}. ` +
        'Do not ask for these again as though they are new. You may read one back wrong.'
    );
  }

  const spent = spentObstacles(persona, history);
  if (spent.length) {
    lines.push(`Excuses you have already used, do not reuse them: ${spent.join(', ')}.`);
  }

  if (turnCount >= 4) {
    lines.push(`You have held him ${Math.round(elapsedSeconds)}s across ${turnCount} exchanges.`);
  }

  if (!lines.length) return null;

  return `WHAT YOU KNOW SO FAR IN THIS CALL:\n${lines.map((l) => `- ${l}`).join('\n')}\n
Use this. Refer to specifics he has already given you. Answer the question he
actually just asked, badly, rather than saying something that would fit any
moment in the call.`;
}

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
export async function* streamPersonaReply({
  persona,
  history,
  tactics = [],
  elapsedSeconds = 0,
  spokenFiller = null,
  intel = [],
  enrichment = null,
  turnCount = 0,
  signal,
}) {
  if (!openai) {
    yield "Oh, uh... hold on now, I think something's wrong with my phone.";
    return;
  }

  const messages = [{ role: 'system', content: persona.systemPrompt }];

  // eleven_v3 is the only model that acts on emotional direction. Asking the
  // other models for tags just makes them speak the brackets aloud.
  if (/v3/.test(config.elevenlabs.model)) {
    messages.push({ role: 'system', content: AUDIO_TAG_DIRECTION });
  }

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

  // What it already knows, before what it should avoid saying. Facts first.
  const state = describeCallState({ persona, history, intel, enrichment, elapsedSeconds, turnCount });
  if (state) messages.push({ role: 'system', content: state });

  const openers = recentOpeners(history);
  if (openers.length) {
    messages.push({
      role: 'system',
      content:
        `You have already begun turns with: ${openers.map((o) => `"${o}"`).join(', ')}. ` +
        'Do not open with any of those again, or with anything close to them. ' +
        'Start this turn differently. React to the specific words the caller just used ' +
        'rather than reaching for a stock phrase.',
    });
  }

  // A filler has already been spoken aloud by the time this runs, so the reply
  // has to continue from it. Otherwise the caller hears two openers stacked.
  if (spokenFiller) {
    messages.push({
      role: 'system',
      content:
        `You have ALREADY said "${spokenFiller}" out loud. Continue straight on from it. ` +
        'Do not greet, do not start with another interjection, do not repeat that phrase.',
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

/**
 * Emotional direction for eleven_v3, for example "[confused] Oh my heavens."
 *
 * A model asked to sound frightened without being told to reads the words
 * accurately and flatly, because nothing in the text says otherwise. Tags state
 * the emotion instead of hoping the model infers it. They belong in the audio
 * and nowhere else, so they are stripped before a line reaches a transcript or
 * an intel record.
 *
 * Only short lowercase directions in leading position count, so bracketed data
 * the caller states, such as an account number, survives.
 */
const AUDIO_TAG = /\[[a-z][a-z ,'-]{1,28}\]\s*/g;

export function stripAudioTags(text) {
  return String(text ?? '').replace(AUDIO_TAG, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Split generated text into the spans handed to the voice engine.
 *
 * `reply` keeps the whole reply together, which produces the best prosody
 * because the engine can plan intonation across the entire utterance. `clause`
 * trades some of that back for lower latency.
 */
export function chunkForSpeech(text, granularity = 'reply') {
  const input = String(text ?? '');
  if (granularity !== 'clause') return input.trim() ? [input] : [];

  const out = [];
  let buf = '';
  for (const ch of input) {
    buf += ch;
    let cut;
    while ((cut = findClauseEnd(buf)) !== -1) {
      const piece = buf.slice(0, cut + 1);
      buf = buf.slice(cut + 1);
      if (piece.trim()) out.push(piece);
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
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
