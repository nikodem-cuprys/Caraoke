# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SingLearn: paste a YouTube link to identify a song, supply authorized audio,
and get an interactive karaoke lesson — synced word-by-word lyrics, a
scrolling target-pitch visualization, vocal/instrumental mixing, and
practice tools (loop a phrase, slow it down, jump sections). See
`README.md` for full architecture, legal/audio-source rationale, models
used, and environment variable reference — don't duplicate that here.

## Commands

```bash
# Install + build (do this before anything else works — web/api import
# packages/shared as @singlearn/shared)
npm install
npm run build:shared

# Dev servers (separate terminals)
npm run dev:api                 # http://localhost:4100
npm run dev:web                 # http://localhost:3200
cd apps/worker && ./.venv/Scripts/python -m singlearn_worker.main   # Windows venv

# Tests
npm run test                    # shared + api (vitest)
npm run test:shared
npm run test:api
npm run test:e2e                # Playwright; starts api/web/worker itself, runs the REAL pipeline end-to-end
cd apps/worker && pytest        # worker unit + integration tests

# Single test
npx vitest run path/to/file.test.ts -t "test name"     # from packages/shared or apps/api
cd apps/worker && pytest tests/test_file.py::test_name
npx playwright test -g "test name"

# Lint / typecheck / format
npm run --workspace @singlearn/api lint     # tsc --noEmit
npm run --workspace @singlearn/web lint     # tsc --noEmit
cd apps/worker && ruff check . && ruff format --check .

# Build
npm run --workspace @singlearn/api build
npm run --workspace @singlearn/web build

# Prisma (from apps/api)
npx prisma generate
npx prisma migrate deploy       # apply existing migrations
npx prisma migrate dev          # after editing schema.prisma
```

No Docker is required for local dev — the default config is SQLite +
local-filesystem storage + a DB-backed job queue (see `docker-compose.yml`
only if you need Postgres/Redis/MinIO parity). `.env.example` files exist
per app (`apps/api/.env.example`, `apps/web/.env.local.example`,
`apps/worker/.env.example`) — copy them, don't hand-roll env vars.

## Architecture

Three processes, one canonical data flow:

```
apps/web (Next.js)  <--REST + SSE-->  apps/api (Express)  <--HTTP poll-->  apps/worker (Python)
```

- **apps/web**: Next.js/React. `src/lib/usePlayer.ts` is the single source
  of playback truth — one `requestAnimationFrame` loop reads the "primary"
  `<audio>` element's `currentTime` and drives *everything* (lyrics,
  word-highlighting, pitch visualizer, section indicator, loop boundaries).
  There is intentionally no other clock; if you're adding a feature that
  needs "current time," read it from `usePlayer`, don't create a new timer.
  When separated stems are playing, the secondary stem is periodically
  re-synced to the primary if it drifts >120ms.
- **apps/api**: Express + Prisma. Processing is modeled as an explicit,
  persisted state machine (`ProcessingJob`/`ProcessingStage` in
  `prisma/schema.prisma`) so progress survives a browser refresh or worker
  restart — never simulate percentage progress. Progress reaches the
  browser over SSE (`GET /api/jobs/:id/stream`), not polling.
- **apps/worker**: Python, polls the API's queue over HTTP (it is not an
  HTTP server itself — see `tests/e2e/global-setup.ts` for how e2e tests
  start/stop it). `run_pipeline.py` orchestrates one job through the fixed
  stage order: `PREPARE_AUDIO → SEPARATE_STEMS → TRANSCRIBE → ALIGN_WORDS →
  DETECT_PITCH → SIMPLIFY_MELODY → SEGMENT_LYRICS → GENERATE_WAVEFORM →
  BUILD_KARAOKE → COMPLETE`. Each stage lives in its own file under
  `pipeline/` and is independently unit-tested.

### The three swappable abstractions

Each has a factory (`getXProvider()`) that reads config and picks an
implementation — when adding a feature, check whether it belongs behind one
of these rather than hardcoding a new path:

- **`AudioSourceProvider`** (`apps/api/src/audioSource/`): resolves where
  processable audio comes from. Tried in order: `LicensedAudioProvider` →
  `AuthorizedRemoteAudioProvider` (both unconfigured stubs) →
  `UserUploadAudioProvider` (the only one enabled by default). **YouTube
  URLs are never used to download/extract audio** — only for oEmbed
  metadata and (optionally) embedding the official player. This is a hard
  legal constraint (YouTube's ToS), not a style preference — see
  `AudioSourceProvider.ts`'s docstring and `README.md`'s "Legal / platform
  considerations" before changing anything here.
- **`StorageProvider`** (`apps/api/src/storage/`): `local` (filesystem,
  default) or `s3`. The local provider serves files through `/assets/*`
  with HMAC-signed, time-limited URLs (`assetSigning.ts`) — signed URLs
  must be **absolute** (`API_PUBLIC_URL`), because the browser and worker
  resolve relative URLs against their own origin, not the API's (this was
  a real, previously-shipped bug: relative asset URLs silently 404 when
  the web app and API run on different ports in dev).
- **`QueueProvider`** (`apps/api/src/queue/`): `db` (the `ProcessingJob`
  table is the queue, default, no Redis) or `bullmq` (Redis-backed, for
  multi-worker/GPU scaling). `BullMqQueueProvider` is not exercised by the
  automated test suite (it runs without Redis) — smoke-test manually if
  you change it.

### Data model

`Song → SongSection → LyricLine → LyricWord`, plus flat `PitchFrame` (raw,
downsampled) and `MelodyNote` (simplified, confidence-gated) arrays scoped
to the song. Word/note/section confidence is always stored and surfaced in
the UI as an estimate (e.g. "Possible transcription error") rather than
presented as fact — never fabricate a note or word when confidence is
poor. Identical audio is content-hashed (SHA-256) and never reprocessed —
see `songs.integration.test.ts`'s cache-reuse test before changing upload
handling.

### Models (see README "Models used" for full rationale/licenses)

Demucs (separation, MIT), faster-whisper (transcription + word timestamps,
MIT), librosa `pyin` (pitch detection, ISC, no pretrained model). All three
only ever run inside `apps/worker`, invoked by the queue — never call an ML
model from an API request handler.

### Microphone practice is entirely client-side

`packages/shared/src/pitchDetection.ts` (autocorrelation) and
`singingScore.ts` (turns samples into a few specific sentences, never a
bare score) are pure and unit-tested; `apps/web/src/lib/useMicrophonePitch.ts`
does the Web Audio plumbing. No microphone audio is ever recorded or sent
to the server — this isn't a policy choice layered on top, it's the whole
design (only `{time, frequencyHz, confidence}` numbers ever leave the
`AnalyserNode`). Don't add server involvement to this feature without
re-reading README's "Microphone practice" section first.

### Transpose only shifts the practice guide, not the audio

The -3..+3 semitone control (`TransposeControl.tsx`) shifts the displayed
target melody, key, vocal range, and mic comparison
(`transposeMelodyNotes`/`transposePitchClass` in `music.ts`) — it does not
re-pitch the backing track. That's a deliberate scope decision (see
README's "Transpose / key shift"), not an oversight: real pitch-shifting
that preserves tempo would need a new worker stage, a new cached-asset
type, and a schema change (`ProcessingJob` is hard 1:1 with `Song` today).
Don't assume audio re-pitching is a small follow-up to this feature.

### UI palette is greys, blacks, and red — deliberately, not a placeholder

`globals.css`'s `:root` variables are the source of truth; don't reach for
teal/purple/amber/blue anywhere in the UI, including canvas-drawn colors
that can't reference CSS variables directly (`PitchVisualizer.tsx`'s
`CANVAS_*` constants, `Waveform.tsx`'s `SECTION_COLORS`) — mirror the CSS
palette's hex values there instead. Where a design needs more than one
distinguishable color for data (the pitch visualizer's target-vs-your-voice
overlay, the waveform's section-type coloring), use grey-vs-red or
light-vs-dark shades rather than introducing a new hue. One deliberate
exception: `var(--accent)` is red now, not a "positive/success" color the
way the old teal was — a few spots that used it for a success state
(`ProcessingStages`'s "done" checkmark, the processing page's completion
message) were switched to `var(--text)` instead, since a red checkmark
reads as an error. Keep that distinction when adding new success states:
red means "brand/primary action/attention," not "success."

### Practice sessions heartbeat; they don't rely on a single "end" call

`usePracticeSession.ts` extends a `PracticeSession` row every 30s while the
practice page stays mounted (`PATCH .../practice-sessions/:id`), rather
than starting one on mount and ending it once on unmount — a closed tab or
crashed browser would never get to send that final call, leaving the
session open forever. If you touch this hook, keep the "cleanup can fire
before the async start resolves" case handled explicitly (end the session
immediately in that case rather than starting a heartbeat interval nothing
will ever clear) - this was a real bug caught by comparing e2e output
against expectations, not by inspection. Also: in `next dev`, expect one
extra near-zero-duration session per page load from React StrictMode's
deliberate double-mount - don't "fix" that by suppressing StrictMode.

`PracticeSession` (and its Prisma model) predates this feature by a lot -
it was part of the original schema scaffolding with no working
endpoints/UI behind it, the same situation `LicensedAudioProvider` is
still in. Grep for a model/interface actually being used before assuming a
feature is unimplemented just because it doesn't show up in the UI yet.

### Vocal range fit check reuses the mic pipeline; it doesn't add a second one

`VocalRangeCard.tsx` runs its own `useMicrophonePitch` instance (separate
from the one on the practice page's mic-comparison feature) for a two-note
calibration capture, then calls `evaluateVocalRangeFit`/`estimateHeldNoteMidi`
(`packages/shared/src/vocalRangeFit.ts`) — both pure and unit-tested. The
calibrated range is `localStorage`-only (`apps/web/src/lib/vocalRangeStorage.ts`);
there's no user account to attach it to server-side. Don't test this against
the repo's synthetic e2e fixture without forcing `song.vocalRange` via route
interception first (see `tests/e2e/vocalRangeFit.spec.ts`) - like the
difficulty rating feature, the fixture's TTS "singing" doesn't reliably
produce a confident melody, so the real field is null for it.

### Vocal exercises reuse the main mic instance, not a second one

Unlike `VocalRangeCard`, `DifficultPartsPanel`'s "Practice this" exercise
flow takes the `Player` component's existing `useMicrophonePitch` instance
as props (`micPermission`/`micStart`/`micSamplesRef`/`micClearHistory`)
rather than creating its own - it needs samples timestamped against the
same canonical playback clock the loop region is using, so calling
`micStart()` from the exercise flow just enables the same "Microphone
practice active" state the regular mic panel shows. `evaluateExerciseAttempt`
(`packages/shared/src/exercisePractice.ts`) is a deliberately separate,
simpler pass/fail judgment from `singingScore.ts`'s feedback sentences -
don't merge them; the exercise flow wants one boolean per attempt, not a
paragraph. Progress (`apps/web/src/lib/exerciseProgress.ts`) is
`localStorage`-only, same rationale as the vocal range calibration above.
Starting an exercise does not call `player.play()` - like the pre-existing
"Loop" button, it only sets up the loop region; e2e tests for this feature
must click Play themselves (a real bug this session hit: without it,
`currentTime` never leaves 0, so mic samples never fall inside the target
note's window and every attempt reports "not enough signal").
