# Honeypot AI

## Product

Honeypot AI is an autonomous AI bodyguard for scam calls.
It answers the phone so real people do not have to.

## Problem

Scammers make money by cycling through many calls.
Each minute spent with a fake victim is a minute they cannot spend on a real one.

## Solution

Honeypot AI uses a fictional AI persona to keep scam callers busy.
It extracts and validates payment details, then stores threat intelligence from the call.

## Pipeline

Caller audio flows through Deepgram speech-to-text, turn detection, and a GPT-4o persona.
GPT-4o hands each reply to ElevenLabs text-to-speech while the extractor validates artifacts and saves them to Elasticsearch or local JSONL.

## Test locally

Install dependencies with `npm run install:all`, then create `.env` with `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, and `OPENAI_API_KEY`.
Run `npm run dev`, open `http://localhost:3000`, choose a persona, click **ARM HONEYPOT**, and talk or use type-to-talk.

On PowerShell, use `npm.cmd run install:all`, `Copy-Item .env.example .env`, and `npm.cmd run dev` if script policy blocks `npm.ps1`.

For a microphone-free test, keep the app running and run `npm run simulate` in another terminal.
Elastic keys are optional because the app falls back to local JSONL storage.

## Take real calls

Expose the server with `cloudflared tunnel --url http://localhost:8787` and copy the
`https://` origin it prints into `PUBLIC_URL`.
Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_NUMBER`, then point the
number's Voice webhook at `<PUBLIC_URL>/twilio/voice` using HTTP POST.

Check it with `curl localhost:8787/api/twilio/status`, which reports the webhook URL
it expects.
Quick tunnels get a new hostname on every restart, so if cloudflared drops you must
update `PUBLIC_URL` and the Twilio webhook again.

## Settings worth knowing

`.env.example` lists every supported key with blank values.
Anything left blank falls back to a working default.

`TTS_GRANULARITY` takes `reply` (default, best prosody) or `clause` (lower latency).
`TWILIO_PERSONA` takes `harold`, `dale`, `kevin`, or `brenda`.

With `HONEYPOT_ACCESS_TOKEN` blank, command and dispatch access is local-only.
For a remote command center, set `HONEYPOT_ACCESS_TOKEN` and
`NEXT_PUBLIC_HONEYPOT_TOKEN` to the same demo token before building the web app.
This token is visible to the browser and is not production user authentication.

`MAX_CONCURRENT_SESSIONS` defaults to `4`, `MAX_SESSION_MINUTES` defaults to `30`,
and `PROVIDER_TIMEOUT_MS` defaults to `5000`.

Built by Max Gong, Kate Kaneshiro, Bhavya Wadhwa, and Hong Cheng Wang.
