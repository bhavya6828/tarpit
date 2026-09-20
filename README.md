# TARPIT

## Product

Tarpit is an autonomous AI bodyguard for scam calls.
It answers the phone so real people do not have to.

## Problem

Scammers make money by cycling through many calls.
Each minute spent with a fake victim is a minute they cannot spend on a real one.

## Solution

Tarpit uses a fictional AI persona to keep scam callers busy.
It extracts and validates payment details, then stores threat intelligence from the call.

## Pipeline

Caller audio flows through Deepgram speech-to-text, turn detection, and a GPT-4o persona.
GPT-4o streams replies to ElevenLabs text-to-speech while the extractor validates artifacts and saves them to Elasticsearch or local JSONL.

## Test locally

Install dependencies with `npm run install:all`, then create `.env` with `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, and `OPENAI_API_KEY`.
Run `npm run dev`, open `http://localhost:3000`, choose a persona, click **ARM TARPIT**, and talk or use type-to-talk.

For a microphone-free test, keep the app running and run `npm run simulate` in another terminal.
Elastic keys are optional because the app falls back to local JSONL storage.

Built by Max Gong, Kate Kaneshiro, Bhavya Wadhwa, and Hong Cheng Wang.
