# TARPIT

**An autonomous digital bodyguard that answers scam calls so your grandmother doesn't have to.**

When a scammer gets through, Tarpit picks up with a hyper-realistic AI persona whose only
goal is to waste their time. While the scammer is trapped, the backend quietly harvests
their payment infrastructure — wallet addresses, routing numbers, drop accounts, callback
numbers — validates it, and indexes it as threat intel.

Scammers operate on volume. Every minute they spend on Harold is a minute they can't
spend on a real victim.

---

## Quick start

```bash
npm run install:all     # root + server + web
cp .env.example .env    # then paste your keys in
npm run dev             # server :8787, UI :3000
```

Open **http://localhost:3000**, pick a persona, hit **ARM TARPIT**, and talk into your mic.

> **Wear headphones.** Without them the persona hears itself through the laptop speakers
> and interrupts its own sentence. If you must demo on speakers, flip **HALF-DUPLEX ON**
> in the header — it stops sending mic audio while the persona is talking.

### Keys you need in `.env`

| Key | Used for |
|---|---|
| `DEEPGRAM_API_KEY` | streaming speech-to-text (listening to the scammer) |
| `ELEVENLABS_API_KEY` | streaming text-to-speech (the persona's voice) |
| `OPENAI_API_KEY` | the persona brain + fraud classification |
| `ELASTIC_CLOUD_ID` + `ELASTIC_API_KEY` | threat-intel index (optional — falls back to a local store) |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `PUBLIC_URL` | real inbound phone calls (optional) |

Everything degrades gracefully. Missing Elastic → local JSONL in `data/`. Missing any
voice key → the UI tells you which one, and the rest of the system still runs.

---

## The 3-minute demo

1. **Frame it.** "Scammers steal billions from people who can't afford it. We built an
   AI that answers the phone so they don't have to."
2. **Hand the judge a script.** *"You're an IRS agent. Get my AI's credit card number.
   Do not let them off the phone."*
3. **Let them try.** Harold will not find his wallet. Mr. Biscuits is on the paperwork.
4. **Point at the right panel** when the judge reads out a number — the artifact lands in
   red with `Luhn mod-10 PASS` or `ABA checksum PASS` next to it.
5. **Point at the timer.** "That's 90 seconds of their operating budget, gone. Do this at
   scale and the unit economics of phone fraud stop working."

**The line that lands with skeptics:** everyone's worried AI will be used to scam people.
This is the same technology, pointed the other way.

### If the mic fails
Two fallbacks, both exercising the identical pipeline:

- **Type-to-talk box** under the transcript — type as the scammer, press enter.
- **`npm run simulate`** — synthesizes a scammer with ElevenLabs and streams that audio
  into the server exactly as the mic would. A full call, no human, no microphone. Watch it
  land in the UI in real time.

  ```bash
  npm run simulate                                    # default IRS script, Harold
  npm run simulate -- --persona dale --hold 60        # different persona, longer call
  npm run simulate -- --script "your scam script"     # your own script
  ```

  This is also the regression test — it exercises Deepgram, the extractor, the persona,
  ElevenLabs and Elastic in one command.

---

## Taking real calls

The browser demo and the phone line run the **same session loop** — only the audio
format differs, and the phone path stays mu-law 8kHz end to end so nothing is resampled
in-process.

```bash
# 1. expose the server (either works)
cloudflared tunnel --url http://localhost:8787
ngrok http 8787

# 2. put that https origin in .env
PUBLIC_URL=https://your-tunnel.example.com
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_NUMBER=+1...

# 3. point your Twilio number's Voice webhook at
#    https://your-tunnel.example.com/twilio/voice   (HTTP POST)

# 4. check it
curl localhost:8787/api/twilio/status
```

Now anyone can dial the number and get Harold. The command center mirrors the live call —
you don't have to start anything in the browser.

Inbound requests are rejected unless they carry a valid `X-Twilio-Signature`. A tunnel is
a public URL; without that check the number is an open telephony relay.

## What you can and cannot learn about a caller

**You cannot get a scammer's IP address from a phone call.** The audio arrives over the
carrier network — there is no IP in the path. Any project claiming otherwise is either
describing a VoIP-only edge case or is wrong, and it is the first thing a technical judge
will probe.

What the signalling *does* carry is better, because it's verifiable:

| Signal | What it tells you |
|---|---|
| **STIR/SHAKEN attestation** | Whether the originating carrier cryptographically vouched for the caller ID. Grade **C**, `Failed`, or no attestation means the number is almost certainly spoofed. |
| **Carrier + line type** | Who originates the traffic, and whether it's mobile, landline, or VoIP — scam floors run on VoIP. |
| **CNAM** | The caller-ID name they paid to display, e.g. "IRS TAX DEPT". |
| **Geographic origin** | City/state the number is registered to, against what they claim. |

All of it is indexed as artifacts alongside whatever the scammer says out loud.

## Reporting

There is **no public API that files a complaint with the FBI, FTC or FCC** — those are
human web forms, for everyone. So Tarpit doesn't fake a "REPORTED ✓" badge. It produces
the three things that are actually actionable:

```
GET  /api/report/:id            case file (JSON)
GET  /api/report/:id/stix       STIX 2.1 bundle
GET  /api/report/:id/markdown   case file (Markdown)
GET  /api/report/:id/ftc        field-by-field FTC pre-fill
POST /api/report/:id/dispatch   POST the package to REPORT_WEBHOOK_URL
```

**STIX 2.1** is the format carriers, ISACs and bank fraud teams ingest by machine — it's
where this intel realistically lands. Indicators carry the validation result and a
confidence score derived from severity.

The case file also does **cross-engagement correlation**: if a wallet or routing number
shows up in more than one call, it's flagged. A reused payment channel is a live operation,
not a one-off — that's the difference between a data point and intelligence.

Every package carries an explicit AI-disclosure and a consent-law caveat, because the
transcript is a recording and recording law varies by state.

## Why it doesn't sound fake

Synthetic voice reads as fake mostly for reasons that aren't the model:

- **Band-limiting.** Real phone audio lives in 300–3400Hz. Studio-clean 24kHz speech is
  the single biggest tell. Playback runs through a telephony chain — bandpass, soft-clip
  for codec grit, heavy compression, and a low line-noise floor. Toggle it live with
  **PHONE LINE** in the header to hear the difference.
- **Room tone.** Harold says "let me turn the television down." If that lands over
  digital silence, the ear catches it instantly. Each persona has a generated ambience
  loop (`npm run ambience`) mixed in *before* the phone filter, because the caller hears
  the room down the same line.
- **Model choice.** `eleven_turbo_v2_5` over `flash_v2_5`: +116ms to first byte,
  audibly better prosody. On a phone call that latency delta is invisible.
- **Reply length.** Short turns. A monologue lets the scammer mute you; short replies
  force them to keep talking, which is both more realistic and more time destroyed.

## How it works

```
   mic ──► 16kHz PCM ──► Deepgram nova-3 ──┬──► turn detection ──► GPT-4o persona
                                            │                            │
                                            └──► intel extraction        │ token stream
                                                      │                  ▼
                                                      ▼           ElevenLabs flash v2.5
                                                 Elasticsearch           │
                                                                    24kHz PCM
                                                                         ▼
                                                                     speakers
```

**Why it feels like a person, not a chatbot:**

- **Audio starts before thinking finishes.** The persona speaks a filler ("hold on now…")
  the instant a turn starts, while the model is still writing. LLM tokens stream straight
  into the TTS socket, so the first word plays in a few hundred ms.
- **It can be interrupted.** Deepgram interim results trigger barge-in: the LLM request is
  aborted, the TTS socket is cancelled, queued audio is flushed. The persona reacts to
  being talked over instead of restarting its sentence.
- **It changes tactics mid-call.** Live signals (exit intent, suspicion, payment pressure,
  dead air) inject tactical directives before generation. When the scammer starts to leave,
  the persona escalates *compliance*, not conflict — that's what keeps them on.
- **It fills silence.** Nine seconds of dead air and the persona nudges, in character.

One subtlety worth knowing if you touch the audio path: Deepgram finalizes an utterance by
*hearing* the pause after it. If the stream goes silent-by-absence rather than
silent-by-silence, the last thing the caller said is never transcribed — which is exactly
the utterance most likely to hold the payment details. Half-duplex mode therefore streams
digital silence rather than sending nothing.

**Why the intel is real signal, not regex noise:**

- Card numbers must pass **Luhn mod-10** and get network-identified from the BIN.
- Routing numbers must pass the **ABA mod-10 checksum** *and* carry a valid Federal Reserve
  prefix. Any nine digits look like a routing number; roughly one in ten actually is one.
- **Dictated digits are reassembled.** Scammers read numbers aloud one at a time.
  `"zero two one zero zero zero zero two one"` → `021000021` → checksum PASS.
- **Span masking** stops a 16-digit card from also being reported as a phone number hiding
  inside its own digits.

---

## Layout

```
server/
  index.js              express + websocket bridge
  src/personas.js       the four personas and the time-wasting doctrine
  src/session.js        turn-taking, barge-in, tactics, metrics
  src/deepgram.js       streaming STT
  src/elevenlabs.js     streaming TTS
  src/brain.js          persona generation
  src/intel.js          extraction, checksums, digit normalization
  src/elastic.js        indexing with local fallback
web/
  components/           the command center
  lib/audio.ts          mic capture + gapless PCM playback
  lib/useTarpit.ts      websocket + state
```

## The cast

| Persona | The bit |
|---|---|
| **Harold Pemberton**, 85 | Looking for his wallet. Keeps finding stories about his cat instead. |
| **Dale Kruger**, 44 | Sincerely believes this is the pizza place calling about his order. |
| **Kevin Ostrowski**, 20 | Sophomore. Four tabs of attention, none of them on you. |
| **Brenda Vance**, 62 | Wants to help. Needs to tell you about the church van first. |

Swap personas mid-call from the header — the agent plays it as handing the phone to
someone else in the house, which costs the scammer another minute by itself.

## Tuning

`.env` knobs: `SCAMMER_COST_PER_MINUTE` (default `0.42`) and `AVG_SCAM_CALL_SECONDS`
(default `270`) drive the "cost destroyed" and "victim calls displaced" numbers. Voice IDs
override per persona with `VOICE_HAROLD`, `VOICE_DALE`, `VOICE_KEVIN`, `VOICE_BRENDA`.
