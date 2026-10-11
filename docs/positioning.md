# RecBay positioning

## The moat is ownership, not price

BYOK + IndexedDB means genuinely zero server cost — but "free" is not a
position. Competing on price against planning tools loses to a Google Sheet.
The position is:

> **Your script and references are stored on your device. No servers, no
> accounts, no access.**

That sentence appears in three user-facing places (onboarding, settings, under
parse results) — because every competing tool trains users to assume a cloud
exists, and users will assume the worst unless told otherwise. The wording
lives in exactly one file: `src/ui/PrivacyStatement.tsx`.

Practical consequences of the bet:

- **BYOK is a feature, not a hurdle.** It is framed as control ("your key, your
  model, your data"), with provider presets so non-technical users paste one
  key once.
- **No cloud means no sync.** IndexedDB doesn't follow you to another device,
  so *export* is a first-class Phase 1 feature, not a nice-to-have:
  "Export all data" produces one restorable JSON snapshot (records + blobs).
- **No analytics.** Improvement comes from watching real usage in person, not
  dashboards. See `parsing-quality.md` for how parse quality is measured.

## Why this team, not a funded one

Competitors build the workflow backward: AI wrappers (ShotKraft-style) hand
you a skeleton with no workspace to live in; data-blind canvases
(Milanote-style) give you space but flat text. RecBay enters from the middle
— AI produces the skeleton, *you* own the workspace, and the same data flows
to a phone on set.

Technology is copyable. The defensible thing is that this is the workflow tool
its maker would actually use: designed around a director on a real shoot day
— drag a card, check a box, pull up a lighting plot with no signal — not a
persona invented in a user interview. The architecture (docs/architecture.md)
is the enabler: it is what lets a small team ship and iterate in months while
the big platforms are still migrating tables.

## The product promise in one line

When a director pastes a script, they immediately get a workspace they can
reshape, annotate, and carry on set — and none of it ever leaves their device.
