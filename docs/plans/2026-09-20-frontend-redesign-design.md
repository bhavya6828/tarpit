# Frontend redesign design

## Direction

Tarpit will use a calm incident workspace instead of the current retro command
center. The interface should feel like a dependable case-management tool used during
a live call. A warm paper canvas, white surfaces, charcoal text, subtle borders, and
small semantic color accents establish hierarchy without visual noise. The product
name and connection state sit at the top, while one dark action starts or ends the
engagement. No gradient, glow, scanline, or oversized decorative heading is used.

The desktop workspace has three areas. Session contains persona selection, audio
controls, and live metrics. Conversation remains the largest area and keeps the typed
caller fallback at the bottom. Evidence contains fraud classification, extracted
artifacts, and campaign totals. On narrow screens, labeled tabs switch between these
same three areas so no information is removed. The default mobile view is
Conversation because it is the primary live task.

## Components and data

`CommandCenter` remains the state owner and passes the existing `useTarpit` data into
the same feature components. The redesign changes composition and presentation, not
the WebSocket protocol or domain logic. `PersonaPicker` becomes a compact, readable
choice group. `MetricsRail`, `Transcript`, and `IntelPanel` use shared surface,
status, and typography tokens. `CaseFile` remains an overlay, but gains dialog
semantics, clear document actions, and a calmer report layout.

Empty and error states state what happened and what the operator can do next.
Connecting, ready, live, ended, and offline states use both text and a status marker.
Missing provider keys remain visible without blocking the typed demo path.

## Verification

Source-level tests lock the core responsive and accessibility contracts before the
implementation lands. The normal test suite and production build must pass. Desktop
and mobile browser screenshots must then confirm hierarchy, wrapping, text fit,
focus treatment, and access to Session, Conversation, and Evidence. Browser console
and request failures must be reviewed. If browser control is unavailable, the goal
stays incomplete until screenshot evidence can be captured.
