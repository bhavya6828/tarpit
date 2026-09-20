# Tarpit MVP Plan

## 1. Why this file exists

This file is the handoff plan for the next Codex session. It explains what is
real, what is risky, what to build first, and how to prove each change works.

The team has little time. The MVP must be a repeatable browser demo that shows
the main value of Tarpit:

1. A caller speaks or types a scam message.
2. Tarpit turns speech into text.
3. A fictional persona answers in real time.
4. Tarpit finds useful scam intelligence.
5. The transcript and intelligence appear in the command center.
6. A case report can be exported.

Real phone support is useful, but it must not block the demo. The phone path is
currently written but the repository has not proven a real inbound Twilio call.

## 2. Current project truth

The existing architecture is:

```text
Browser mic or Twilio
  -> WebSocket or Twilio Media Stream
  -> Session state machine
  -> Deepgram Nova-3 speech-to-text
  -> deterministic intel extraction
  -> OpenAI persona response
  -> ElevenLabs text-to-speech
  -> browser or phone audio
  -> Elasticsearch, memory, and JSONL fallback
  -> case file, STIX, and FTC pre-fill
```

Important facts from the current code review:

- Browser audio, type-to-talk, persona selection, barge-in, extraction, and
  report routes are already present.
- `server/test/speech.test.js` has speech-format tests, but there are not yet
  full tests for the session, Twilio, storage, reports, or live provider loop.
- The simulator creates one generated scam script. It is useful for a pipeline
  smoke test, but it is not an adaptive scammer.
- Raw call audio is not saved. Transcripts and metadata are saved.
- Elasticsearch is optional. Local JSONL files are written under `data/`.
- The README tells users to copy `.env.example`, but `.env.example` is absent.
- The current checkout did not have all dependencies installed. Last checks
  failed because `openai` and `next` were not found. Run dependency setup before
  judging application behavior.
- `.env` contains live-looking credentials. Assume they are exposed. Revoke
  and replace them before any demo, commit, or sharing.

## 3. MVP scope

### Must work

- Local server starts with documented commands.
- Web app builds successfully.
- Health endpoint clearly reports missing keys and store mode.
- Browser command center connects to the server.
- A user can start and stop a session.
- Type-to-talk can always drive a session, even when the microphone fails.
- Browser microphone can drive a session when browser permissions allow it.
- Deepgram produces partial and final caller transcripts.
- OpenAI produces a short fictional persona reply.
- ElevenLabs produces playable response audio.
- Barge-in cancels stale response work and flushes stale audio.
- At least one payment artifact and one scam signal are extracted correctly.
- Transcript and intel appear in the UI and local fallback storage.
- Case file, Markdown, STIX, and FTC pre-fill endpoints return valid output.
- A manual QA run can repeat the same happy path from a clean server start.

### Should work if time allows

- One verified inbound Twilio call through a stable tunnel.
- Caller metadata appears in the session and report.
- Twilio audio uses the correct 8 kHz mu-law format in both directions.

### Not MVP blockers

- Production-grade multi-tenant deployment.
- Automatic filing with law enforcement.
- Outbound calling.
- Full raw-audio evidence archive.
- Perfect voice realism.
- High-volume concurrency.
- Advanced scammer behavior simulation.

## 4. Recommended implementation order

### Phase 0: Secure the demo first

Do this before using any provider again.

- Revoke and rotate the exposed Deepgram, ElevenLabs, OpenAI, Elasticsearch,
  and Twilio credentials.
- Keep `.env` local and untracked.
- Restore a sanitized `.env.example` with blank values and safe comments.
- Never print secret values in logs, reports, screenshots, or test output.
- Decide whether the demo will use real provider keys or mocked providers for
  automated tests. Tests must never need real keys.

### Phase 1: Make setup reproducible

- Run the documented install flow for root, server, and web packages.
- Confirm lockfiles are used.
- Fix README setup instructions if any command is wrong.
- Add a short troubleshooting section for PowerShell users. `npm.cmd` may be
  needed when PowerShell blocks `npm.ps1`.
- Run the server test command and web build command from a clean checkout.
- Do not call the project working until both commands pass.

### Phase 2: Lock the browser demo

Focus on the smallest story that a judge can see.

- Start the server and web app.
- Connect the command center.
- Start Harold first. Keep other personas available only if they are stable.
- Use type-to-talk as the guaranteed fallback.
- Verify one spoken or typed scam script containing:
  - a claimed organization,
  - a callback number,
  - a valid routing number or payment card test value,
  - urgency or a threat.
- Confirm the transcript, intel card, validation label, timer, and report ID
  all update during one session.
- Verify that stopping and restarting a session clears live UI state correctly.

### Phase 3: Add tests around the real failure points

Add focused tests before changing behavior. Prefer dependency injection or small
fake provider clients over real network calls.

Required test areas:

- `intel.js`
  - spoken digit normalization,
  - Luhn validation,
  - ABA validation,
  - span masking,
  - deduplication,
  - false positive protection.
- `session.js`
  - start and stop,
  - final transcript persistence,
  - queued caller text,
  - barge-in cancellation,
  - enrichment failure does not kill the call,
  - missing provider key fallback behavior.
- `twilio.js`
  - valid signature accepted,
  - bad signature rejected,
  - unknown media call rejected or safely ignored,
  - inbound and outbound frame handling,
  - teardown on stop and socket close.
- `elastic.js`
  - local JSONL fallback,
  - report data after provider failure,
  - behavior after process restart if JSONL is advertised as persistent.
- `report.js`
  - valid case file,
  - valid STIX bundle,
  - FTC fields,
  - correlation of repeated artifacts,
  - no unmasked payment data in exported reports unless explicitly intended.
- Web app
  - production build,
  - type-to-talk flow,
  - stale audio flush after interruption,
  - useful error state when server is offline.

### Phase 4: Fix MVP security and data safety

These are small enough to matter now and important enough not to defer.

- Fail closed for Twilio when the auth token is missing.
- Do not create a Twilio session for an unknown `CallSid` or unknown media
  stream unless there is an intentional authenticated flow.
- Protect the command WebSocket and report dispatch route before exposing the
  server through a public tunnel.
- Add a simple development token or local-only mode. Keep the mechanism small.
- Add a maximum session duration and maximum concurrent session count.
- Add request timeouts around external lookups and provider calls.
- Redact payment cards and bank numbers before writing transcript text to
  Elasticsearch, JSONL, or reports. Keep only masked forms and last four digits
  where possible.
- Document retention and deletion behavior for transcripts.
- Do not promise raw audio evidence until raw audio recording, storage, access,
  retention, and consent behavior are actually implemented.

### Phase 5: Optional phone pilot

Only start this after the browser acceptance checklist passes.

- Use a stable HTTPS tunnel.
- Point the Twilio number Voice webhook to `/twilio/voice` with HTTP POST.
- Make one real inbound call from an allowed test phone.
- Verify webhook signature, Twilio `start`, media frames, Deepgram transcript,
  persona audio, barge-in, `stop`, session storage, and report generation.
- Capture timestamps for webhook response, first transcript, first response
  audio, and total call duration.
- Write down any carrier, codec, tunnel, or trial-account limitation.

If this phase fails, the browser demo remains the MVP. Do not hide the failure.
Label phone support as tested, partially tested, or unverified.

## 5. Definition of done

The MVP is done only when all of these are true:

- A clean install completes.
- Server tests pass.
- Web production build passes.
- A provider-backed browser demo completes one full call loop.
- Type-to-talk works as a fallback.
- At least one validated intel artifact is visible.
- A report can be downloaded and parsed.
- Local fallback storage works when Elasticsearch is unavailable.
- No secrets appear in git, logs, screenshots, or generated reports.
- Manual QA checklist passes twice from fresh server starts.
- Known limitations are written in `MVP.md` and `SPEC.md`.
- If Twilio was not tested live, the demo claims browser support only.

## 6. Required test and QA gate for every change

Every code or behavior change must follow this order:

1. Read `SPEC.md` and update it first if behavior changes.
2. Add or update a failing test for the intended behavior.
3. Make the smallest implementation change.
4. Run focused tests for the changed module.
5. Run the full server test suite.
6. Run the web production build.
7. Run the relevant manual QA flow.
8. Check logs, UI, stored data, and report output for errors or leaked secrets.
9. Update this plan or `SPEC.md` when the real behavior differs from the plan.
10. Only then mark the work complete.

Minimum commands after dependencies exist:

```text
npm.cmd test                         # from server/
npm.cmd run build                   # from repo root
```

For provider-backed checks, use a disposable test session and inspect:

- `/api/health`
- `/api/intel/summary`
- `/api/report/:sessionId`
- `data/utterances.jsonl`
- `data/intel.jsonl`
- browser transcript and intel panels
- server error output

## 7. Manual QA checklist

Run this checklist after each meaningful MVP change.

### Clean start

- [ ] Start from a fresh server process.
- [ ] Open the command center in a fresh browser tab.
- [ ] Confirm health status and missing-key state are truthful.
- [ ] Confirm no secret appears in the browser or server log.

### Happy path

- [ ] Start Harold.
- [ ] Submit the scam script through type-to-talk.
- [ ] Confirm caller text appears once.
- [ ] Confirm persona text appears once.
- [ ] Confirm persona audio plays.
- [ ] Confirm one payment artifact appears with correct validation.
- [ ] Confirm signal and metrics panels update.
- [ ] Stop the call.
- [ ] Confirm the session ends cleanly.

### Failure path

- [ ] Block the microphone and confirm type-to-talk still works.
- [ ] Interrupt the persona and confirm old audio stops.
- [ ] Stop the server and confirm the UI shows a useful offline state.
- [ ] Run without Elasticsearch and confirm JSONL fallback works.
- [ ] Submit an invalid Twilio signature and confirm rejection.
- [ ] Send malformed text or empty input and confirm no crash.

### Report path

- [ ] Download JSON case file.
- [ ] Download Markdown case file.
- [ ] Download STIX bundle and parse JSON.
- [ ] Read FTC pre-fill output.
- [ ] Confirm sensitive values are masked according to policy.
- [ ] Confirm repeated artifacts are correlated correctly.

## 8. Risks and decisions for the next Codex

### Risk: provider latency or outage

Use type-to-talk and the simulator for the demo. Add clear UI errors. Do not
make the demo depend on a live phone call.

### Risk: real-time audio bugs

Prefer browser headphones. Keep half-duplex mode visible. Test interruption and
silence handling with a repeatable script.

### Risk: legal and privacy exposure

Do not claim automatic reporting or legal admissibility. Avoid collecting more
personal data than needed. Add a recording and consent decision before storing
raw audio or using the system outside a controlled demo.

### Risk: public tunnel abuse

Do not expose the server until endpoint protection, session limits, and Twilio
fail-closed checks exist. A public tunnel plus provider keys can become an API
cost and telephony abuse path.

### Risk: documentation drift

When code and `SPEC.md` disagree, update the spec before changing behavior.
Keep `MVP.md` focused on the smallest tested release, not every aspiration.

## 9. Work breakdown for implementation

Use small tasks. Each task should have one clear acceptance test.

Suggested task order:

1. `chore(setup): restore safe environment template and reproducible setup`
2. `test(intel): add extraction and validation regression coverage`
3. `test(session): add session and interruption coverage`
4. `test(report): add report and redaction coverage`
5. `fix(storage): make local fallback behavior match its persistence promise`
6. `fix(security): fail closed and protect public session routes`
7. `test(web): add build and browser demo acceptance coverage`
8. `feat(mvp): make browser demo path repeatable`
9. `test(twilio): add media bridge and signature coverage`
10. `feat(phone): verify one inbound Twilio call`

Follow repository rules for commits: tests land before the implementation they
prove, commit messages use the `git-commit-formatter` skill, no co-author
trailers are added, and push to `origin/main` only after the task passes its
tests and QA review.

## 10. First action for the next Codex session

Start here:

1. Read `AGENTS.md`, `SPEC.md`, and this file.
2. Check git status.
3. Rotate the exposed credentials before any live provider call.
4. Restore `.env.example` without secrets.
5. Install dependencies using the lockfiles.
6. Run server tests and web build.
7. Report the first real failure before changing behavior.
8. Implement only the highest-priority failing task.
9. Test and manually QA it before moving on.

The goal is not to build every planned feature. The goal is to show one complete,
honest, repeatable scam-call defense loop that works under demo conditions.
