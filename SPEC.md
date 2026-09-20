# Honeypot AI, Technical Specification

> Status: implemented and running, except where marked **Not built**.
> This document describes what the code actually does. Aspirational behaviour is
> called out explicitly rather than blended in.

---

## 1. Problem and scope

Phone fraud is a volume business. A scam floor's unit economics depend on cycling
through calls quickly; an operator tied up for eight minutes on one target is an
operator not working three others. Honeypot AI attacks that economic assumption directly,
and harvests the caller's payment infrastructure while doing it.

**In scope**

- Answer an inbound scam call with a synthetic persona that is hard to disengage from.
- Keep the caller talking, in real time, with natural interruption handling.
- Extract and *validate* payment artifacts from what the caller says.
- Correlate artifacts across engagements.
- Produce a filing-ready referral package.

**Explicitly out of scope**: see §3.

---

## 2. System architecture

```
                    ┌──────────────── transports ────────────────┐
  browser mic ─────►│  /ws          linear16 16kHz               │
  phone call  ─────►│  /twilio      mu-law   8kHz                │──┐
                    └────────────────────────────────────────────┘  │
                                                                    ▼
                                                            ┌──────────────┐
                                                            │   Session    │
                                                            │ turn-taking  │
                                                            │  barge-in    │
                                                            │   tactics    │
                                                            └──────┬───────┘
                        ┌──────────────────┬───────────────────────┤
                        ▼                  ▼                       ▼
                  Deepgram STT      OpenAI persona           intel extraction
                  nova-3            gpt-4o streaming         regex + checksums
                        │                  │                       │
                        │                  ▼                       ▼
                        │          ElevenLabs TTS            Elasticsearch
                        │          turbo_v2_5                (JSONL fallback)
                        │                  │                       │
                        └──────────────────┴───────────────────────┘
                                           │
                                     audio to caller
```

One `Session` object owns an engagement end to end. It is transport-agnostic: the
browser demo and a real phone call run identical logic, differing only in the audio
codec negotiated at construction.

### Module responsibilities

| Module | Responsibility |
|---|---|
| `server/index.js` | HTTP + WebSocket surface, upgrade routing, monitor fan-out |
| `server/src/session.js` | The engagement state machine. Turn-taking, barge-in, tactics, metrics |
| `server/src/deepgram.js` | Streaming STT client, transport-aware encoding |
| `server/src/elevenlabs.js` | Streaming TTS client, transport-aware output format |
| `server/src/brain.js` | Persona generation, history trimming, tactical injection |
| `server/src/personas.js` | Persona definitions and the shared time-wasting doctrine |
| `server/src/intel.js` | Extraction rules, checksum validation, digit normalization |
| `server/src/elastic.js` | Indexing, aggregation, correlation, local fallback |
| `server/src/twilio.js` | TwiML, signature validation, caller forensics, media bridge |
| `server/src/report.js` | Case file, STIX 2.1, FTC pre-fill, dispatch |
| `web/lib/audio.ts` | Mic capture, gapless PCM playback, telephony colouration |
| `web/lib/useHoneypot.ts` | WebSocket protocol client and UI state |

### 2.1 Browser interface

The browser command center is a calm incident workspace built around one primary
workflow: choose a persona, start an engagement, follow the conversation, review
captured evidence, and open the referral package.

- The default desktop layout keeps Session, Conversation, and Evidence visible in
  three clear work areas without decorative command-center effects.
- The three-column workspace begins at 1280 pixels, when all work areas fit without
  horizontal clipping. Below that width, labeled tabs provide all three work areas.
  Metrics and intel remain reachable rather than disappearing.
- Workspace tabs expose tablist, tab, and tabpanel semantics, including the selected
  state and panel relationship for assistive technology.
- The start or end engagement action is the only visually dominant control.
- Opening the referral package moves keyboard focus into its dialog. Closing it
  returns focus to the control that opened it.
- Persona choice, phone-line audio, half-duplex audio, and referral access are grouped
  by task and use plain labels.
- Normal, empty, connecting, live, ended, missing-key, and offline states remain
  understandable without relying on color alone.
- The visual system uses a warm neutral canvas, white surfaces, charcoal text, subtle
  borders, one dark primary action, and muted semantic status colors. It has no CRT
  scanlines, neon glow, gradients, or large decorative effects.
- Keyboard focus is visible. The referral package is an accessible modal dialog that
  closes with Escape and has a labeled close control.

---

## 3. Non-goals

These are deliberate. Each is a claim the project could make and does not, because
it would not survive scrutiny.

**No IP address collection.** A PSTN call's audio arrives over the carrier network.
There is no IP in the path. Systems claiming otherwise are describing a VoIP-only
edge case or are wrong. Honeypot AI collects telephony-layer forensics instead (§9),
which has the advantage of being cryptographically verifiable.

**No automated filing with law enforcement.** The FTC, FCC and IC3 accept complaints
only through human web forms; no public filing API exists for anyone. Honeypot AI produces
a referral *package* and does not render a "REPORTED ✓" badge it cannot back up.

**No claim of legal admissibility.** Recordings are produced. Consent law varies by
jurisdiction. Every package carries an explicit caveat rather than an assurance.

**No impersonation of a real person.** Personas are fictional. No real identity,
voice likeness, or personal data is presented to the caller.

**No outbound calling.** Honeypot AI answers; it never dials. Outbound baiting would make
this a harassment tool.

---

## 4. Transports

Audio format is a property of the transport, resolved at session construction.

| | `browser` | `twilio` |
|---|---|---|
| Inbound encoding | `linear16` @ 16 kHz | `mulaw` @ 8 kHz |
| Outbound format | `pcm_24000` | `ulaw_8000` |
| Framing | 512-sample worklet frames (32 ms) | 160-byte frames (20 ms) |
| Playback control | client reports `playback_done` | Twilio `mark` events |
| Interrupt mechanism | client flushes Web Audio queue | `clear` event to Twilio |

The phone path is mu-law end to end deliberately: Deepgram ingests mu-law natively
and ElevenLabs emits it natively, so a live call performs **zero resampling** in our
process. Fewer conversions, less latency, fewer failure modes.

### 4.1 Twilio call flow

1. Inbound call → Twilio POSTs `/twilio/voice`.
2. Request signature validated against `TWILIO_AUTH_TOKEN` (HMAC-SHA1 over URL +
   sorted params). A missing token, missing signature, or mismatch is rejected with
   403. **This is load-bearing**: a tunnel is a public URL, and without it the number
   is an open telephony relay.
3. Caller dossier assembled (§9) and stashed by `CallSid`, TTL 60 s.
4. TwiML returns `<Connect><Stream>` pointing at `wss://…/twilio`.
5. Twilio opens the media socket, sends `start` carrying `CallSid`.
6. Dossier retrieved, `Session` constructed with `transport: 'twilio'`. An unknown
   or expired `CallSid` closes the media socket without creating a session.
7. Bidirectional audio until `stop` or socket close.

Live phone sessions are mirrored to every connected command-center client via a
monitor broadcast, so the UI lights up without anyone pressing a button.

---

## 5. The real-time loop

### 5.1 Turn detection

Deepgram is configured with:

```
interim_results=true   utterance_end_ms=1000   vad_events=true
endpointing=300        smart_format=true       punctuate=true
numerals=true          filler_words=true
```

A turn is flushed on `speech_final`, with `UtteranceEnd` as a backstop. `numerals=true`
is not cosmetic, it is what converts dictated digits into a form the checksum
validators can act on.

### 5.2 Barge-in

Triggered from **interim transcripts**, not raw VAD. Raw VAD fires on the persona's
own voice bleeding back through laptop speakers, which makes the agent interrupt
itself.

Guards:

- `SPEAK_GRACE_MS = 700`, ignore interruptions in the first 700 ms of agent speech.
- Minimum two recognized words.

On trigger: abort the in-flight completion, cancel the TTS socket, increment `turnId`
to invalidate in-flight audio, emit `audio_flush`, and (on Twilio) send `clear`.

Aborted completions are **not** surfaced as errors. The OpenAI SDK raises a plain
`Error` rather than a `DOMException`, so `isAbort()` matches on name *and* message -
otherwise every interruption paints a red error in the UI mid-demo.

### 5.3 Latency budget

Measured on an M-series Mac, warm connections:

| Stage | Observed |
|---|---|
| Deepgram interim → final | ~300 ms (endpointing) |
| OpenAI first token | 650–800 ms |
| ElevenLabs first audio | ~440 ms (turbo, HTTP) |
| **Perceived first response** | **~250 ms** |

Perceived latency is far below the sum because a **filler is spoken immediately**.
`"hold on now"` enters the TTS socket before the model has written anything, which
buys the time the reply takes to arrive.

### 5.3.1 How text reaches the voice engine

A voice engine plans intonation across the span of text it is handed. Hand it less
and it plans less. This is the single largest determinant of whether output reads as
speech or as dictation, and it is a latency tradeoff:

| Granularity | First audio | Result |
|---|---|---|
| Word fragments (~12 chars) | fastest | Dictation. Each fragment carries its own stress pattern and trailing pause. Rejected. |
| Clause | +0 ms | Natural within a clause, slightly disjointed across them. |
| **Whole reply** | **+250 ms** | **Best prosody. What ships.** |

The whole reply is buffered before synthesis. The filler covers the wait, so the
added latency is not audible to the caller. `TTS_GRANULARITY` may be set to `clause`
to trade prosody back for latency on a slow link.

Clause detection remains implemented and is used at `clause` granularity. It requires
real lookahead: text arrives one character at a time, so a terminator at the end of
the buffer has no following character yet. It waits for the next character, requires
whitespace after the terminator, and guards abbreviations and initials so `Mr.
Biscuits` and `I.R.S.` are not split.

### 5.4 Tactical adaptation

`detectSignals()` classifies each caller utterance. Matching directives from `TACTICS`
are injected as a system turn immediately before generation:

| Signal | Trigger | Response |
|---|---|---|
| `exit_intent` | hang-up language, frustration, insults | deploy strongest hook, escalate compliance |
| `suspicion` | "are you a bot" | deflect via mundane physical detail |
| `payment_pressure` | payment rails mentioned | maximize harvest; make them repeat the destination |
| `long_silence` | `IDLE_NUDGE_MS = 9000` elapsed | fill the gap in character |

This is the difference between an agent and a chatbot: strategy changes mid-call on
live signals, rather than one frozen prompt running to completion.

### 5.4.1 Backchannelling

Strict alternation is not conversation. A listener on a phone call is audible the whole
time: "mhm", "uh huh", "oh". Silence while the other person speaks is what makes a
caller ask "hello? are you there?", and it is the strongest remaining cue that the other
end is a recording.

While the caller is speaking the persona emits short cached reactions, driven from
Deepgram interim results:

| Rule | Value | Reason |
|---|---|---|
| Caller must have been speaking | 2500 ms | reacting to three words is not listening |
| Minimum spacing | 4000 ms | constant noise is worse than none |
| Maximum per caller turn | 2 | any more reads as interruption |

Backchannels are a fixed set of fixed phrases, so their audio is cached on disk exactly
as fillers are and plays with no request. They deliberately do **not** take a turn: they
never set `agentSpeaking`, never advance `turnId`, and never cancel in-flight
generation, so they cannot interrupt the persona's own reply or suppress barge-in.

### 5.5 History

Trimmed to `MAX_HISTORY_TURNS = 24`, always preserving the opening exchange so
narrative continuity survives a long call.

### 5.5.1 Person first

The doctrine optimized for time-wasting produced a persona that stalled on every
single turn: sit down, find the glasses, move the cat, ask for a repeat. That is not
how a slow person behaves, it is how a delay machine behaves, and a caller hangs up on
a delay machine.

The stalling only works because the target seems real. So most turns are ordinary human
responses, obstacles are occasional, and the agent is told when it has leaned on them
too long. Consecutive stalls are counted against the persona's own obstacle vocabulary,
and after two in a row the next turn is directed to simply respond: answer the question,
react, ask something a normal person would ask.

Being briefly lucid, direct, or even mildly impatient is in character. Nobody is
confused every second of a phone call, and unbroken confusion reads as a performance.

### 5.6 Call state

Raw turns are a poor memory. A model given only a transcript improvises a plausible
next line rather than tracking what has happened, which reads as reciting a script: it
asks again for a number it already has, reuses an excuse it already spent, and answers
around the question instead of answering it.

Everything needed to fix that is already in the session, and is injected each turn as a
compact set of facts:

| Fact | Source |
|---|---|
| Who the caller claims to be | enrichment `claimed_org`, `claimed_name`, impersonation artifacts |
| What they are demanding, and how much | enrichment `payment_rail`, `amount_demanded` |
| Payment destinations already obtained | captured artifacts |
| Excuses already spent | persona obstacle vocabulary matched against its own turns |
| How long they have been held | elapsed seconds and turn count |

Spent excuses are matched deterministically against a vocabulary each persona declares,
so it costs nothing per turn and cannot invent an obstacle that was never used. Knowing
a routing number is already captured is what lets the agent stop asking and start
stalling on something else, which is the behavior that reads as understanding.

---

## 6. Personas

Four, each a `systemPrompt` composed of character text plus a shared **doctrine**.

| id | Character | Mechanic |
|---|---|---|
| `harold` | 85, retired postal inspector | cat, glasses, migrating wallet |
| `dale` | 44, HVAC | maps every utterance onto a pizza order |
| `kevin` | 20, sophomore | catastrophically distractible |
| `brenda` | 62, church volunteer | weaponized hospitality |

### Doctrine (the load-bearing part)

- **Dangling carrot**, always about to comply, never refusing. Obstacles rotate
  between categories; never two of a kind consecutively.
- **Hard 25-word ceiling, target 10–15.** Counterintuitive but central: you do not
  waste a scammer's time by talking at them, a monologue lets them mute you and work
  another victim. Short turns force *them* to keep responding. Ten exchanges beat one
  speech. This single constraint cut average reply length ~45%.
- **Hand the ball back**, but not every turn and not the same way. Dead air is a
  hang-up cue, yet a question every single time is a template, and a template is what
  makes a voice sound generated however good the synthesis is.
- **Vary the shape.** Real speech is uneven: four words, then thirty, then a fragment.
  A constant reply length is a tell on its own.
- **Never reuse an opener.** Repeating the same interjection turn after turn is the
  most machine-like behavior available, so recent openings are fed back into the prompt
  as phrases to avoid.
- **A filler is not spoken every turn.** It fires on roughly a third of turns, and when
  it does the model is told what was already said, so the reply continues from it
  rather than stacking a second interjection in front.
- **Harvest as confusion.** Asking a caller to repeat and spell payment details is
  in-character for a confused target and is the primary intel mechanism. Reading a
  long number back *wrong* is the highest-yield time-waster available.
- **Plain spoken text only**, output is read aloud; no markdown, emoji, or stage
  directions.

Mid-call persona swap is supported and framed in-narrative as handing the phone to
someone else in the household.

---

## 7. Intel extraction

Two passes.

### 7.1 Deterministic pass

Runs on every caller utterance. Twelve rule types:

`crypto_wallet` · `payment_card` · `bank_routing` · `callback_number` ·
`bank_account` · `payment_tag` · `gift_card` · `email` · `infrastructure` ·
`remote_access` · `impersonation` · `coercion`

What separates this from pattern-matching:

**Checksum validation.** Cards must satisfy Luhn mod-10 and are network-identified
from the BIN. Routing numbers must satisfy the ABA mod-10 checksum *and* carry a
valid Federal Reserve prefix (01–12, 21–32, 61–72, 80). Any nine digits look like a
routing number; roughly one in ten actually is one.

**Spoken-digit reassembly.** Scammers dictate numbers one digit at a time. A
three-pass normalizer runs before extraction:

1. `"double four"` → `44`
2. digit words → digits, delimiters preserved exactly
3. `"five oh five"` → `505`, only where `oh` sits between digits
4. digit groups separated solely by spacing collapse into one number

> Verified end to end: a synthesized caller speaking *"zero two one zero zero zero
> zero two one"* yields `021000021`, **ABA checksum PASS**.

**Span masking.** Rules run in priority order; matched spans are blanked from the
working text. Without this a 16-digit card is also reported as a phone number hiding
inside its own digits.

Callback candidates must also begin outside any longer digit sequence. An invalid
card-like or reference number cannot leak an embedded ten-digit phone number.

**Cross-variant dedupe.** Keys are the alphanumeric core of the value, so the raw and
normalized passes don't both report `44-2291` and `442291`.

### 7.2 Enrichment pass

Every `ENRICH_EVERY_TURNS = 3` turns, `gpt-4o-mini` classifies the transcript into
`scam_type`, `claimed_org`, `claimed_name`, `payment_rail`, `amount_demanded`,
`pressure_tactics`, `confidence`. Temperature 0, JSON mode, instructed not to invent
values.

### 7.3 Severity

| Severity | Score | Examples |
|---|---|---|
| critical | 95 | crypto wallet, payment card, routing number, remote-access tooling |
| high | 75 | drop account, callback number, P2P handle, gift card |
| medium | 50 | email, infrastructure, impersonated entity, alias |
| low | 25 | coercion tactics |

---

## 8. Data model

Three Elasticsearch indices, created on boot if absent.

**`honeypot-intel`**, one document per artifact.
`@timestamp`, `session_id`, `type`, `label`, `value`, `severity`, `score`, `speaker`,
`source_utterance`, `meta`

**`honeypot-sessions`**, one document per engagement.
`@timestamp`, `session_id`, `persona`, `transport`, `status`, `seconds_wasted`,
`cost_destroyed_usd`, `turns`, `intel_count`, `scam_type`, `claimed_org`,
`payment_rail`, `caller_number`, `caller_carrier`, `caller_attestation`

**`honeypot-utterances`**, one document per line of dialogue.
`@timestamp`, `session_id`, `speaker`, `text`, `persona`

Every write also lands in memory and appends to `data/*.jsonl`. Elastic is never on
the critical path of a call.

The local store reloads all valid JSONL records on process start, so reports remain
available when Elasticsearch is absent or fails. Payment cards, routing numbers,
and bank account numbers are masked before any memory, JSONL, or Elasticsearch
write, including artifact identifiers. Local records have no automatic expiry and
remain until the operator deletes the files under `data/`.

---

## 9. Caller forensics

Replaces the IP-address non-goal with signals that actually exist on a phone network.

| Field | Source | Value |
|---|---|---|
| `attestation` | `StirVerstat` webhook param | STIR/SHAKEN grade |
| `carrier`, `lineType` | Twilio Lookup v2 | originating carrier; mobile/landline/VoIP |
| `callerName` | CNAM | the caller-ID name they paid to display |
| `fromCity/State/Country` | Twilio webhook | registered geography |

### Attestation grading

| Grade | Meaning | Spoofed |
|---|---|---|
| A | carrier vouches for the number and the caller's right to use it | no |
| B | carrier knows the customer but not that they own the number | no |
| C | gateway attestation, carrier cannot vouch | **yes** |
| `failed` | failed cryptographic validation | **yes** |
| `none` | carrier signed nothing | **yes** |

A `C`/`failed`/`none` result is indexed as **critical**: it is cryptographic evidence
of caller-ID spoofing, which is both a federal offence and a strong fraud indicator.

---

## 10. API surface

### REST

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | key presence, model ids, store mode |
| GET | `/api/personas` | persona cards |
| GET | `/api/intel/summary` | aggregates for the campaign panel |
| GET | `/api/intel/search?q=` | full-text artifact search |
| GET | `/api/report/:id` | case file (JSON) |
| GET | `/api/report/:id/stix` | STIX 2.1 bundle |
| GET | `/api/report/:id/markdown` | case file (Markdown) |
| GET | `/api/report/:id/ftc` | FTC field pre-fill |
| POST | `/api/report/:id/dispatch` | POST package to `REPORT_WEBHOOK_URL` |
| GET | `/api/twilio/status` | phone readiness, webhook URL |
| POST | `/twilio/voice` | TwiML (signature-validated) |

### WebSocket `/ws`

Client → server, JSON control frames plus binary PCM:

`start` · `stop` · `persona` · `inject` · `playback_done` · `mute_while_speaking` · `ping`

Server → client, JSON events plus binary audio framed as
`[uint32 turnId LE][PCM16 @24kHz]`:

`hello` · `session_start` · `session_end` · `persona_changed` · `stt_ready` · `vad` ·
`transcript_partial` · `transcript` · `agent_delta` · `audio_start` · `audio_end` ·
`audio_flush` · `interrupted` · `state` · `metrics` · `intel` · `enrichment` ·
`signals` · `nudge` · `error` · `pong`

`inject` feeds text as though the caller had spoken it, same pipeline, no microphone.
It is the UI's type-to-talk box and the demo's mic-failure fallback.
Typed input is trimmed and blank input is ignored. A new session flushes queued
audio and clears the transcript, partial text, live persona text, intel, metrics,
enrichment, signals, and speaking state. A bridge disconnect also flushes playback
and leaves an actionable offline message.

The command WebSocket and report dispatch route use local-only access when
`HONEYPOT_ACCESS_TOKEN` is blank. Remote clients are rejected. When a token is set,
the server accepts it through `X-Honeypot AI-Token`, a bearer header, or the WebSocket
`token` query parameter. The browser uses `NEXT_PUBLIC_HONEYPOT_TOKEN`. This is a
small demo access boundary, not production user authentication.

The browser automatically reconnects a dropped command socket with bounded
exponential backoff from 500 ms to 8 seconds. A successful connection resets the
backoff. Reconnection stops when the page unmounts. Repeated bridge errors are
deduplicated, malformed JSON events and undersized audio frames are ignored without
crashing the UI, and secure pages use HTTPS and WSS endpoints automatically.

Health, campaign summary, and case-file requests are abortable. A component that
unmounts or starts a replacement poll aborts its stale request so late responses do
not update inactive UI.

The process allows four concurrent sessions by default. Each session ends after
30 minutes by default. External provider HTTP calls and WebSocket handshakes time
out after five seconds by default.

---

## 11. Referral packages

**Case file**, engagement metadata, classification, caller forensics, every artifact
with its validation result, full transcript, cross-engagement correlation, and
disclosure block.

Payment cards, routing numbers, and bank account numbers are masked to their last
four digits in every exported artifact, transcript excerpt, and transcript line.
JSON, Markdown, STIX, FTC pre-fill, and webhook dispatch all derive from this same
redacted case file.

**STIX 2.1 bundle**, `identity` + one `indicator` per artifact + a `report` linking
them. Patterns use standard SCOs where they exist (`email-addr`, `domain-name`,
`ipv4-addr`) and `x-` custom objects where STIX has no native type (crypto wallets,
phone numbers, bank accounts). Confidence derives from severity. This is the format
carriers, ISACs and bank fraud teams ingest by machine, realistically where this
intel lands.

**FTC pre-fill**, field-by-field values for `reportfraud.ftc.gov`, with the narrative
composed from the classification and captured payment destinations.

**Correlation** is the part that turns data into intelligence: if a wallet or routing
number appears in more than one engagement it is flagged with the other session ids.
A reused payment channel is a live operation, not a data point.

---

## 12. Voice realism

Synthetic voice reads as fake mostly for reasons that are not the model.

| Lever | Implementation | Why |
|---|---|---|
| Band-limiting | biquad 300–3400 Hz | real phone audio is narrowband; studio 24 kHz is the biggest tell |
| Codec grit | `tanh` soft-clip, drive 1.15 | lossy codecs leave this on consonants |
| Line levelling | compressor, ratio 6, −28 dB | phone lines are aggressively AGC'd |
| Noise floor | brown-noise bed at 0.0015 gain | digital silence is unnatural, audible hiss is worse |
| Room tone | per-persona ambience loop, gain 0.028 | Harold says "let me turn the television down" |
| Model | see below | expressiveness against latency |
| Emotional direction | audio tags in generated text | inferred emotion is flat; stated emotion is not |

Each lever is subtle alone and they stack. Hiss, room tone and soft-clip together read
as a bad connection rather than a real one, so the noise elements sit far below where
they were first set. The band-pass and the compressor do the work; noise is seasoning.

Ambience is mixed **before** the telephony filter, because the caller hears the room
down the same line. The chain is bypassable at runtime (`PHONE LINE` toggle) by
widening the filters to transparency rather than rewiring the graph.

On the Twilio path this colouration is redundant, because 8 kHz mu-law does it for
real.

### 12.1 Model selection

| Model | TTFB | Notes |
|---|---|---|
| `eleven_flash_v2_5` | ~325 ms | Fastest, flattest. |
| `eleven_turbo_v2_5` | ~425 ms | Good prosody, no emotional range. |
| `eleven_v3` | ~700 ms | Most expressive. Supports audio tags. |
| `eleven_multilingual_v2` | ~1600 ms | Too slow for conversation. |

`eleven_v3` accepts inline **audio tags** such as `[confused]`, `[nervously]` and
`[sighs]`. A model asked to sound frightened without being told to will read the words
accurately and flatly, because nothing in the text says otherwise. Tags are how
emotion is specified rather than hoped for, and personas emit them inline.

Tags are stripped before a line is written to the transcript or indexed, so the intel
record stays clean.

### 12.2 Two synthesis paths

`eleven_v3` is not available on the input-streaming websocket. The endpoint rejects
it outright:

```
400 unsupported_model
Model 'eleven_v3' is not supported on the text-to-speech websocket endpoint.
```

So the voice has two paths, selected from the configured model:

| Path | Models | Mechanism |
|---|---|---|
| Websocket | `flash`, `turbo`, `multilingual` | Text pushed into an open socket, audio returns as it generates. |
| HTTP | `eleven_v3` | Complete text posted once, audio streams back in the response body. |

The HTTP path cannot begin until text is complete, so it synthesizes **per sentence**
rather than per reply. Two reasons, both measured:

| Text sent | `eleven_v3` first byte | `eleven_turbo_v2_5` first byte |
|---|---|---|
| Whole reply | 1505 ms | 283 ms |
| First sentence only | 806 ms | 246 ms |

v3's first byte scales with the length of the text it is given, so a shorter request
is faster on its own, and it can start as soon as the first sentence exists instead of
waiting for the whole reply. Together that roughly halves time to audio:

| Path | Caller stops to persona audible |
|---|---|
| v3, whole reply | ~3.0 s |
| v3, per sentence | **~1.5 s** |
| turbo, websocket stream | ~1.2 s |

The **first** span of a reply is released on a clause break rather than a sentence end,
because it is the only thing between the caller and any audio at all. It must still
clear a minimum length, since a stub like "Oh my," is the clipped delivery that made
the voice sound like dictation, and a long run-on breaks on a word rather than holding
every sample back. This matters most on the roughly two thirds of turns where no
filler fires: those measured 2339ms and 3808ms to first audio against 929ms when one
did, and now land between 1221ms and 1685ms.

Requests are issued as each sentence completes and may be in flight together, but
audio is emitted strictly in sentence order. The head sentence streams straight
through; later ones buffer until their turn, which is cheap because a sentence is
small. Out-of-order emission would rearrange the persona's words.

**Filler prewarm.** On the HTTP path the filler is synthesized and cached to disk per
persona and phrase on first use. Fillers are a fixed set of short fixed strings, so
after the first call they play immediately with no request at all, which is what keeps
the instant-response feel while the model is still writing the rest of the reply.
Cached audio is keyed by voice, model and phrase, so changing any of those regenerates
it.

---

## 13. Failure modes

| Failure | Behaviour |
|---|---|
| Elastic unreachable | falls back to memory + JSONL; UI shows store mode |
| Elastic slow at boot | `store.init()` is non-blocking; server listens immediately |
| Missing voice keys | surfaced in `/api/health` and the UI banner; rest still runs |
| Mic blocked | error surfaced; type-to-talk remains available |
| LLM aborted by barge-in | suppressed, not shown as an error |
| Intel enrichment fails | call continues and session teardown still persists its final state |
| Ambience fetch fails | silently skipped; never breaks a call |
| Twilio bad signature | 403, call rejected |
| Browser never reports playback | server-side timeout releases `agentSpeaking` |
| Browser command socket drops | UI reconnects with bounded backoff and preserves the current view |
| Malformed command frame | frame is ignored and an actionable bridge error is retained once |

---

## 14. Non-obvious constraints

Learned the hard way; documented so they are not reintroduced.

**Deepgram finalizes on heard silence, not absent audio.** A stream that stops sending
bytes leaves the last utterance unfinalized indefinitely, and that utterance is the
one most likely to contain payment details. Half-duplex mode therefore transmits
digital silence rather than sending nothing.

**`CloseStream` needs a round trip.** Deepgram flushes the final transcript only after
receiving `CloseStream` and closes the socket itself. Tearing the socket down in the
same tick discards that flush.

**Barge-in must not trigger on VAD.** The persona's own audio re-enters the mic on
laptop speakers. Interim transcripts plus a grace window are the reliable signal.

**Delimiters must survive digit normalization.** An early normalizer glued the
trailing separator onto the following word (`021000021or`), breaking the `\b` anchor
and silently dropping every routing number.

**Streamed audio must stay on sample boundaries.** An HTTP response arrives in
arbitrary byte lengths, so a chunk can end halfway through a 16-bit sample. Forwarding
that shifts every following sample one byte, which does not sound like a glitch, it
sounds like white noise, and the browser throws constructing an `Int16Array` from an
odd byte count. The partial sample is carried into the next chunk. The websocket path
never hit this because it delivered whole frames.

**Reply length is a time-wasting lever, inverted.** Longer replies waste less of the
scammer's time, not more.

---

## 15. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HONEYPOT_ACCESS_TOKEN` |, | remote command and dispatch access |
| `MAX_CONCURRENT_SESSIONS` | `4` | process session cap |
| `MAX_SESSION_MINUTES` | `30` | automatic session stop |
| `PROVIDER_TIMEOUT_MS` | `5000` | provider request and handshake timeout |
| `DEEPGRAM_API_KEY` |, | required |
| `DEEPGRAM_MODEL` | `nova-3` | |
| `ELEVENLABS_API_KEY` |, | required |
| `ELEVENLABS_MODEL` | `eleven_turbo_v2_5` | |
| `OPENAI_API_KEY` |, | required |
| `OPENAI_MODEL` | `gpt-4o` | persona |
| `OPENAI_EXTRACT_MODEL` | `gpt-4o-mini` | classifier |
| `ELASTIC_NODE` / `ELASTIC_CLOUD_ID` + `ELASTIC_API_KEY` |, | optional |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` |, | optional |
| `TWILIO_NUMBER`, `TWILIO_PERSONA` | `harold` | |
| `PUBLIC_URL` |, | tunnel origin for TwiML |
| `REPORT_WEBHOOK_URL` |, | referral dispatch target |
| `SCAMMER_COST_PER_MINUTE` | `0.42` | metrics |
| `AVG_SCAM_CALL_SECONDS` | `270` | metrics |
| `VOICE_HAROLD` / `_DALE` / `_KEVIN` / `_BRENDA` | preset ids | voice override |
| `NEXT_PUBLIC_HONEYPOT_SERVER` | `localhost:8787` | browser server host |
| `NEXT_PUBLIC_HONEYPOT_TOKEN` |, | browser copy of demo access token |

---

## 16. Testing

`npm run simulate` synthesizes a scammer with ElevenLabs and streams that audio into
the running server exactly as a microphone would, a complete call with no human. It
exercises Deepgram, turn-taking, extraction, the persona, TTS and Elasticsearch in one
command, and doubles as a demo fallback.

```bash
npm run simulate
npm run simulate -- --persona dale --hold 60
npm run simulate -- --script "your scam script"
```

Audio fixtures are cached in `data/` keyed by script hash, so repeat runs cost nothing.

### Verified

- Automated type-to-talk loop with fake provider edges through persona audio,
  extraction, JSONL, process-restart recovery, case file, STIX, Markdown, and FTC.
- Full loop end to end with live keys across all four services.
- Spoken routing number → transcription → ABA checksum PASS → indexed.
- Barge-in cancelling generation and flushing queued audio.
- Cross-engagement correlation across 8 sessions.
- STIX 2.1 bundle and FTC pre-fill generation.
- TwiML output, signature validation, attestation parsing (unit-level).

### Not yet verified

- **A real inbound phone call.** The Twilio account is trial-state and cannot
  provision a number until a caller ID is verified, which itself requires upgrading.
  All code paths are written and unit-tested; none has carried live carrier audio.
- Voice realism is unassessed by ear. Latency is measured; quality is not.
