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
    // Flush on word boundaries so TTS never receives a split word.
    const lastSpace = buf.lastIndexOf(' ');
    if (lastSpace > 0 && buf.length >= 12) {
      yield buf.slice(0, lastSpace + 1);
      buf = buf.slice(lastSpace + 1);
    }
  }
  if (buf.trim()) yield buf;
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
