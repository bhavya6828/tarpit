# Frontend stability design

## Goal

The command center should recover from ordinary local-demo failures without a page
refresh. Stability means the interface does not crash on malformed bridge data, does
not stay offline after a temporary server restart, does not repeat the same error on
every failed attempt, and does not let late HTTP responses update components that no
longer exist.

## Approach

A small transport helper module owns deterministic behavior that can be tested
without a browser. It resolves HTTP and WebSocket URLs from the configured server,
chooses secure protocols when the page is secure, calculates a bounded reconnect
delay, parses JSON and binary socket frames safely, and appends errors without
duplicates. This keeps transport policy out of the React hook while avoiding a new
state library or dependency.

`useTarpit` keeps one socket lifecycle per mount. It reconnects after a close using a
500 ms, 1 s, 2 s, 4 s, then 8 s delay, capped at 8 s. A successful open resets the
attempt count. Cleanup cancels the reconnect timer, signal timer, in-flight health
request, and socket. Audio playback is flushed when the bridge closes. Malformed
messages become one useful error and do not escape the event handler.

Campaign summary and case-file requests use `AbortController`. Starting a new poll
aborts the previous poll. Unmounting aborts the active request and prevents late
state writes. Report dispatch keeps its existing user-visible failure message.

## Verification

Pure tests cover URL resolution, reconnect delay limits, valid and invalid JSON,
short binary frames, audio payload extraction, and error deduplication. Source-level
integration checks require the React hook and fetch components to use the tested
helpers and abort signals. The full repository test suite and production build must
pass. Browser restart testing remains the final manual check when browser control is
available.
