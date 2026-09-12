# SingLearn

SingLearn is a karaoke + lyric trainer + melody trainer. Paste a YouTube
link to identify a song, supply audio you're authorized to process,
and SingLearn turns it into an interactive karaoke lesson: synchronized
word-by-word lyrics, a scrolling target-pitch visualization, vocal/
instrumental mixing where separation is available, and practice tools
(loop a phrase, slow it down, jump between sections) built for learning
difficult parts rather than just playing a song through once.

```
Paste YouTube URL → Analyze song → Create karaoke project → Practice song
```

## Table of contents

- [Architecture](#architecture)
- [Legal / platform considerations](#legal--platform-considerations)
- [Processing pipeline](#processing-pipeline)
- [Models used](#models-used)
- [Local setup](#local-setup)
- [Docker (optional infra)](#docker-optional-infra)
- [Environment variables](#environment-variables)
- [Database migrations](#database-migrations)
- [Worker configuration (CPU/GPU)](#worker-configuration-cpugpu)
- [Object storage](#object-storage)
- [Microphone practice](#microphone-practice)
- [Transpose / key shift](#transpose--key-shift)
- [Difficulty rating & practice history](#difficulty-rating--practice-history)
- [Vocal range fit check](#vocal-range-fit-check)
- [Vocal exercises for difficult passages](#vocal-exercises-for-difficult-passages)
- [Spaced repetition for review](#spaced-repetition-for-review)
- [Tests](#tests)
- [Security considerations](#security-considerations)
- [Known limitations](#known-limitations)
- [Repository structure](#repository-structure)

## Architecture

```
Browser
   │
   │  paste YouTube URL, upload authorized audio
   ▼
apps/web  (Next.js/React)
   │  REST                          │  Server-Sent Events
   ▼                                ▼
apps/api  (Express/TypeScript) ──────────── real-time stage updates
   │            │
   │            └── PostgreSQL/SQLite (Prisma): Song, ProcessingJob,
   │                LyricLine/Word, PitchFrame, MelodyNote, SongSection, ...
   │
   ├── AudioSourceProvider (Licensed → AuthorizedRemote → UserUpload)
   ├── QueueProvider (DB-backed by default, BullMQ+Redis for scale)
   └── StorageProvider (local filesystem by default, S3/MinIO for scale)
                   │
                   ▼
          apps/worker  (Python, polls the queue over HTTP)
                   │
   ┌───────────────┼────────────────────┬─────────────────┐
   ▼               ▼                    ▼                 ▼
PREPARE_AUDIO  SEPARATE_STEMS   TRANSCRIBE → ALIGN_WORDS   DETECT_PITCH
(ffmpeg)       (Demucs/none)    (faster-whisper)           (librosa pyin)
   │               │                    │                 │
   └───────────────┴──── SIMPLIFY_MELODY / SEGMENT_LYRICS ┘
                              │
                    GENERATE_WAVEFORM, BUILD_KARAOKE
                              │
                              ▼
                     reports back to apps/api
                     (assets, lyrics, melody) → COMPLETE
```

The web app and API only ever exchange JSON/SSE and short-lived signed
asset URLs; the worker only ever exchanges job/stage state and derived
metadata (lyrics, notes, sections) with the API plus files on whichever
`StorageProvider` is configured. Any of the three storage/queue/audio-source
abstractions can be swapped independently without touching the others.

### Canonical timeline

Every piece of UI (lyrics, word highlighting, pitch visualizer, section
indicator, loop boundaries) is driven by a single number: the current
playback time of the "primary" `<audio>` element (`apps/web/src/lib/usePlayer.ts`).
There is exactly one `requestAnimationFrame` loop reading that time; when
separated stems are playing, the secondary stem is periodically
re-synced to the primary if it drifts by more than ~120ms. Nothing else
keeps its own clock.

## Legal / platform considerations

YouTube's API Services Terms of Service forbid using the API (or any other
means) to download, extract, or separate the audio/video tracks of a
YouTube video. **SingLearn does not do this, ever.** A YouTube URL is only
ever used for two things:

1. identifying the song, via YouTube's public oEmbed endpoint
   (title/channel/thumbnail — see `apps/api/src/youtube/fetchYoutubeMetadata.ts`),
2. embedding the official YouTube player for reference playback, where
   that's used.

To run the actual audio pipeline (separation, transcription, pitch
detection), the system needs audio bytes it is authorized to process. That
authorization is modeled as an `AudioSourceProvider` interface
(`apps/api/src/audioSource/`) with three implementations, tried in order:

1. `LicensedAudioProvider` — a properly licensed content partner. Not
   configured out of the box; a real deployment would wire this to whatever
   licensing agreement it has.
2. `AuthorizedRemoteAudioProvider` — an operator-specific integration for
   which explicit rights were obtained. Disabled by default; this is
   intentionally not a generic YouTube downloader and never will be.
3. `UserUploadAudioProvider` — the user uploads audio they own or have
   permission to process. **This is the only provider enabled out of the
   box.**

If no provider can resolve audio automatically, the API returns
`needs_user_upload` and the web app prompts for a file. The rest of the
pipeline is identical regardless of which provider supplied the bytes.

## Processing pipeline

Modeled as an explicit, persisted state machine
(`apps/api/prisma/schema.prisma`'s `ProcessingJob`/`ProcessingStage`, driven
by `apps/worker/singlearn_worker/run_pipeline.py`), so a browser refresh or
worker restart mid-job doesn't lose progress and the frontend never shows a
simulated percentage — only stages the worker has actually run:

```
FETCH_METADATA → VALIDATE_AUDIO_SOURCE → PREPARE_AUDIO → SEPARATE_STEMS →
TRANSCRIBE → ALIGN_WORDS → DETECT_PITCH → SIMPLIFY_MELODY →
SEGMENT_LYRICS → GENERATE_WAVEFORM → BUILD_KARAOKE → COMPLETE
```

Each stage is independently unit/integration tested under
`apps/worker/tests/`. Progress reaches the browser over Server-Sent Events
(`GET /api/jobs/:id/stream`), not polling.

Identical audio (by SHA-256 content hash) is never reprocessed: uploading
the same bytes for a different song reuses the cached `prepared_reference`,
stems, transcription, and pitch data (see
`songs.integration.test.ts`'s "reuses cached results" test).

## Models used

Chosen for singing (not just speech), license compatibility, and CPU
availability so local development never requires a GPU:

| Stage | Library/model | License | Why |
|---|---|---|---|
| Vocal/instrumental separation | [Demucs](https://github.com/adefossez/demucs) (`htdemucs`) | MIT | Current state-of-the-art open-source separation quality; MIT license permits commercial use; `SEPARATION_ENGINE=none` degrades honestly (reports `available: false`) instead of faking a stem when Demucs isn't installed/enabled. |
| Transcription + word timestamps | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | CTranslate2 reimplementation of OpenAI Whisper; word-level timestamps out of the box, runs well on CPU, actively maintained. |
| Pitch/melody detection | [librosa](https://github.com/librosa/librosa) `pyin` (probabilistic YIN) | ISC | No pretrained model download, pure numpy/scipy CPU algorithm, well-established for monophonic singing pitch tracking, and its voiced-probability output maps directly onto the confidence values this app requires (see `detect_pitch.py`'s docstring for the CREPE/torchcrepe/RMVPE comparison). Swapping in a neural estimator later only means reimplementing `estimate_pitch_contour` behind the same return shape. |
| Audio normalization | ffmpeg (`loudnorm`, EBU R128) | LGPL/GPL (system binary, not vendored) | Industry standard; single-pass loudness normalization keeps the pipeline stage simple. |

None of these models are called from a frontend/serverless request handler;
they only ever run inside `apps/worker`, invoked by the job queue.

## Local setup

No Docker required. This is what the repository is configured for out of
the box (SQLite + local filesystem storage + the DB-backed queue).

**Requirements:** Node.js 20+, Python 3.11+, `ffmpeg`/`ffprobe` on `PATH`.

```bash
# 1. Install JS dependencies (npm workspaces: apps/web, apps/api, packages/shared)
npm install

# 2. Build the shared package (web/api import it as @singlearn/shared)
npm run build:shared

# 3. Configure and prepare the API
cp apps/api/.env.example apps/api/.env
cd apps/api
npm install
npx prisma generate
npx prisma migrate deploy
cd ../..

# 4. Configure the web app
cp apps/web/.env.local.example apps/web/.env.local

# 5. Start the API and web app (separate terminals)
npm run dev:api     # http://localhost:4100
npm run dev:web     # http://localhost:3200

# 6. Set up and start the worker (separate terminal)
cd apps/worker
cp .env.example .env
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt   # Windows
# ./.venv/bin/pip install -r requirements.txt     # macOS/Linux
./.venv/Scripts/python -m singlearn_worker.main   # Windows
# ./.venv/bin/python -m singlearn_worker.main     # macOS/Linux
```

Open http://localhost:3200, paste a YouTube link, and upload an audio file
you own or have permission to process (see [Legal / platform
considerations](#legal--platform-considerations)). The worker fixture at
`apps/worker/fixtures/synthetic_song.wav` — fully synthetic TTS speech over
a synthesized chord, no copyrighted material — is a convenient file to
upload for a first end-to-end smoke test; regenerate it with
`python fixtures/generate_fixture.py` if needed.

## Docker (optional infra)

The root `docker-compose.yml` brings up Postgres, Redis, and MinIO for a
closer-to-production local setup. The web/API/worker processes are
deliberately **not** containerized — running them on the host gives a much
faster edit/reload loop during active development.

```bash
docker compose up -d
```

Then point `apps/api/.env` at them (values match the compose file's
defaults):

```bash
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://singlearn:singlearn@localhost:5432/singlearn
QUEUE_PROVIDER=bullmq
REDIS_URL=redis://localhost:6379
STORAGE_PROVIDER=s3
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=singlearn
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=singlearn
AWS_SECRET_ACCESS_KEY=singlearn-secret
```

Switching `DATABASE_PROVIDER`/`DATABASE_URL` also requires changing
`datasource db { provider = "..." }` in `apps/api/prisma/schema.prisma`
(Prisma requires this to be a static value, not an env var) and generating
a fresh migration — see [Database migrations](#database-migrations). The
schema intentionally avoids Postgres-only column types so this swap never
requires model changes.

## Environment variables

See `apps/api/.env.example`, `apps/web/.env.local.example`, and
`apps/worker/.env.example` for the full, commented list. Highlights:

| Variable | Where | Purpose |
|---|---|---|
| `API_PUBLIC_URL` | api | Absolute origin the API is reachable at. Used to build absolute signed asset URLs so they resolve correctly from the web app's own origin, not just the API's. |
| `DATABASE_PROVIDER` / `DATABASE_URL` | api | `sqlite` (default, zero-infra) or `postgresql` (see Docker section). |
| `STORAGE_PROVIDER` | api | `local` (default) or `s3`. |
| `QUEUE_PROVIDER` / `REDIS_URL` | api | `db` (default, no Redis) or `bullmq`. |
| `WORKER_SHARED_SECRET` | api + worker | Must match on both sides; authenticates the worker's `/internal/*` callbacks. |
| `MAX_UPLOAD_MB` / `MAX_SONG_DURATION_SEC` / `MAX_CONCURRENT_JOBS` | api | Cost/abuse controls (see [Security considerations](#security-considerations)). |
| `PROCESSING_DEVICE` | worker | `cpu` (default) or `cuda`. |
| `WHISPER_MODEL_SIZE` | worker | `tiny`/`base`/`small`/`medium`/`large-v3`; bigger is slower/more accurate. |
| `SEPARATION_ENGINE` | worker | `demucs` (default) or `none`. |

## Database migrations

Prisma manages the schema (`apps/api/prisma/schema.prisma`,
`apps/api/prisma/migrations/`).

```bash
cd apps/api
npx prisma migrate deploy   # apply existing migrations (fresh checkout / CI / prod)
npx prisma migrate dev      # after editing schema.prisma, to create + apply a new migration
npx prisma studio           # inspect data locally
```

## Worker configuration (CPU/GPU)

The worker runs entirely on CPU by default — no GPU is required for local
development. Set `PROCESSING_DEVICE=cuda` (worker `.env`) on a machine with
an NVIDIA GPU and a CUDA-enabled PyTorch build installed to substantially
accelerate Demucs separation and Whisper transcription; pitch detection
(`librosa pyin`) is CPU-only either way and is not a bottleneck.

```bash
# CPU (default)
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install demucs

# CUDA
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install demucs
```

`SEPARATION_ENGINE=none` disables separation entirely (useful on
constrained hardware); the UI honestly reports "isolated vocals unavailable
for this song" instead of fabricating a separated track, and the
Karaoke/Learn/Practice mixer presets fall back to the single reference mix.

## Object storage

Two `StorageProvider` implementations (`apps/api/src/storage/`), selected
by `STORAGE_PROVIDER`:

- **local** (default): files live on disk under `STORAGE_LOCAL_ROOT`
  (`./storage_data`). Never served directly — the `/assets/*` route
  requires an HMAC-signed, time-limited `exp`/`sig` query pair
  (`assetSigning.ts`), the same pattern S3 presigned URLs use, since plain
  `<audio>`/`<img>` tags can't send auth headers. Because the API and
  worker share this filesystem in local dev, the worker operates on files
  directly instead of downloading them over HTTP.
- **s3**: any S3-compatible store (AWS S3, or the MinIO container in
  `docker-compose.yml`). Objects are private by default; the API hands out
  presigned GET URLs the same way. In this mode the API and worker share no
  filesystem, so the worker downloads the source upload via a presigned GET
  (`sourceAudioSignedUrl`) and uploads every asset it produces (prepared
  reference, stems, pitch/waveform JSON) via a presigned PUT it requests
  from `GET /internal/jobs/:jobId/upload-url` — that endpoint checks the
  requested key is scoped to the job's own song before signing anything, so
  a buggy or compromised worker can't obtain a write URL for arbitrary
  objects. See `apps/worker/singlearn_worker/run_pipeline.py`'s
  `finalize_asset`/`_download_source_audio` and
  `tests/test_pipeline_remote_storage.py` (a local HTTP server standing in
  for the object store, so this path is covered without needing a real
  S3/MinIO instance in CI).

## Microphone practice

An entirely client-side feature (`apps/web/src/lib/useMicrophonePitch.ts`,
`apps/web/src/components/MicPracticePanel.tsx`): the microphone is never
requested until the user clicks "Enable microphone practice" (explicit
opt-in, per the spec's privacy requirement), and no audio is ever recorded,
buffered to disk, or sent to the server in any form — only per-frame
`{time, frequencyHz, confidence}` numbers are kept, in memory, for as long
as the feature stays enabled. Disabling it (or navigating away) immediately
stops the media stream and discards that history.

- **Pitch detection** (`packages/shared/src/pitchDetection.ts`): time-domain
  autocorrelation with parabolic sub-sample interpolation, run against an
  `AnalyserNode` buffer roughly 20 times/second. This is a different,
  lighter algorithm than the worker's offline `librosa.pyin` — pyin is more
  accurate but far too slow to run per-frame in a browser tab. Same
  singing-voice frequency range (65–1047Hz) as the worker's `DETECT_PITCH`
  stage for consistency between the two pitch sources being compared. Pure,
  dependency-free, and unit-tested against synthetic tones
  (`pitchDetection.test.ts`), including a check that it doesn't return an
  octave-doubled/halved frequency for a clean tone — a classic
  autocorrelation failure mode.
- **Live comparison**: `PitchVisualizer` overlays the user's real-time path
  (red) on the fixed target melody (grey/white) — see command.txt's own ASCII
  sketch of "target = fixed path, user = real-time path" — plus a live
  "You: +N cents" / "-N cents" readout (`centsOffFromMidi`) while a
  confident target note is active, and an always-visible "Listening —
  detected \<note\>" status the rest of the time (e.g. during an
  instrumental section) so the user can tell the mic is actually picking
  something up.
- **Singing feedback** (`packages/shared/src/singingScore.ts`): "Get
  feedback on this take" turns the accumulated samples into a short list of
  specific sentences (pitch tendency, a specific note that's consistently
  off, late/early phrase entrance, note coverage) — never a single
  unexplained score, per the spec. Deliberately averages over a whole
  phrase/note rather than judging every frame, so normal vibrato (which
  oscillates roughly symmetrically around the target) washes out in the
  mean instead of being flagged as an error; `singingScore.test.ts` asserts
  this directly with a synthetic vibrato signal. Low-confidence target
  notes and low-confidence detected samples are both excluded before any
  comparison happens, rather than comparing against — or reporting on — a
  guess.
- **Testing a browser microphone in CI**:
  `tests/e2e/microphonePractice.spec.ts` runs against a real Chromium fake
  audio-capture device fed a synthetic WAV tone
  (`--use-fake-device-for-media-stream` +
  `--use-file-for-fake-audio-capture`), exercising the real
  `getUserMedia` → `AudioContext` → `AnalyserNode` → `autocorrelate()` →
  React pipeline rather than mocking any of it — the same "test for real"
  approach as the rest of the suite. Getting the fake device to actually
  resolve `getUserMedia()` (rather than reject with `NotSupportedError`)
  additionally requires `--use-fake-ui-for-media-stream`, undocumented
  anywhere obvious; found by bisecting flag combinations. The test checks
  the always-visible "Listening — detected \<note\>" status rather than the
  target-melody overlay, since the checked-in fixture is TTS-spoken rather
  than sung and doesn't reliably produce a confident target note to compare
  against — that's a property of the test fixture, not something specific
  to the mic feature.

## Transpose / key shift

Per command.txt's "SPECIAL FEATURE — KEY / TRANSPOSITION": a -3..+3
semitone control (`apps/web/src/components/TransposeControl.tsx`) shifts
the **practice guide** — the target melody in `PitchVisualizer`, the live
microphone comparison, and the displayed key/vocal range
(`packages/shared/src/music.ts`'s `transposeMelodyNotes`/
`transposePitchClass`) — instantly and entirely client-side.

**The backing audio itself is not re-pitched.** Doing that well (real
pitch-shifting that preserves tempo, not just `playbackRate`, which changes
both) is a substantially bigger feature: a new worker pipeline stage, a new
cached-asset type per semitone, and — since `ProcessingJob` is currently
hard one-to-one with a `Song` — a schema change to support it, all for a
result the user would wait several seconds to hear each time they changed
the shift amount. Scoped down deliberately (see command.txt's own
conditional phrasing: "*if* transposed backing audio is implemented, use
high-quality pitch shifting...") to the practice guide, which needs none of
that and ships instantly: singing along with a recording in a different
key than you'll perform it in, using the app purely as a visual/reference
guide, is itself a real and common practice technique.

## Difficulty rating & practice history

Two command.txt FUTURE FEATURES items, both implemented from data/schema
that already existed rather than needing new analysis or migrations:

- **Difficulty rating** (`packages/shared/src/difficulty.ts`): an overall
  Easy/Moderate/Challenging/Difficult estimate computed client-side from
  data the pipeline already produces — vocal range (40% weight), difficult
  passages' severity (35%), and lyric density in words/sec (25%) — shown
  with its contributing factors as plain sentences, never a bare score, the
  same "explain the estimate" principle as the singing feedback and
  per-passage difficult parts. Requires a confident vocal range and returns
  `null` rather than guessing when one isn't available (this repo's TTS
  test fixture is exactly such a case — see its own honest "not enough
  data" UI state, covered in `karaoke.spec.ts`).
- **Practice history**: the `PracticeSession` Prisma model already existed
  in the schema (part of the original DATABASE MODEL scaffolding) but had
  no working endpoints or UI. `usePracticeSession.ts` starts a session when
  the practice page mounts and heartbeat-extends it (`PATCH
  /api/songs/:id/practice-sessions/:sessionId`) every 30s while it stays
  open, rather than relying on a single "end" call a closed tab would never
  get to send — the worst case of a missed final heartbeat is a session
  under-counted by one interval, not one left open indefinitely.
  `SongDTO.practiceSummary` and the library list both surface session
  count/total time/last-practiced, scoped per client (never shared across
  users). **In `next dev` specifically**, expect session counts to run
  slightly ahead of the number of times you actually opened the page:
  Next's dev server runs React StrictMode, which deliberately mounts every
  component twice to surface effect bugs, so each dev-mode page load
  creates one real session plus one honestly-short (near-zero-duration)
  StrictMode artifact session — this doesn't happen in production builds.

## Vocal range fit check

Command.txt's stated purpose for vocal range detection is direct: "this
helps the user understand whether the song fits their range." Before this
feature, the song's range was displayed as plain text with nothing to
compare it against — this closes that loop:

- **Visual range bar** (`VocalRangeCard.tsx`): renders the song's detected
  range and, once calibrated, the user's own range on the same MIDI scale,
  plus an outlined overlay showing where the song's range lands after the
  current practice-guide transpose (see "Transpose / key shift" above) —
  all on one shared scale so over/under-lap is visible at a glance.
- **Mic-based range calibration**: reuses `useMicrophonePitch` (same
  privacy guarantee as microphone practice — pitch numbers only, audio is
  never recorded or sent anywhere) for a short two-step capture: hold your
  lowest comfortable note, then your highest. Each step samples for a fixed
  window and takes the **mode** of the confident samples' rounded MIDI
  value (`estimateHeldNoteMidi` in `packages/shared/src/vocalRangeFit.ts`)
  rather than a mean, so a moment of vibrato at the end of a held note
  doesn't skew the result between two real semitones. A step that got too
  little confident signal, or a "highest" note that didn't actually come
  out higher than the "lowest" one, surfaces a plain retry rather than
  silently saving a bad range. The result persists in `localStorage`
  (`apps/web/src/lib/vocalRangeStorage.ts`) — there's no account system to
  attach it to, and it's just two numbers, so a server round-trip isn't
  worth it.
- **Fit check** (`evaluateVocalRangeFit`): compares the song's range
  against the calibrated one and searches the app's supported -3..+3
  transpose window for the shift that best fits the song inside it,
  preferring the smallest shift that fully works. Reports one of three
  outcomes — fits as-is, fits with a suggested shift (with a one-click
  "Apply suggested transpose" button wired straight into the existing
  transpose control), or still out of range even at the best available
  shift (the song's own span is simply wider than the user's range, no
  transpose fixes that) — and never overstates confidence: this is a
  practice aid, not a vocal coach.

Covered in `tests/e2e/vocalRangeFit.spec.ts`. The synthetic test fixture's
TTS-spoken "singing" doesn't reliably produce a confident melody (the same
limitation `difficulty rating` above documents), so `song.vocalRange` is
null against the real pipeline output for it — the tests intercept the
song fetch to inject a fixed, known range instead, exercising the fit-check
and calibration UI for real (real mic pipeline, real browser rendering)
without depending on the fixture producing a specific melody.

## Vocal exercises for difficult passages

Per command.txt FUTURE FEATURES's "vocal exercises based on difficult
notes": turns the existing DIFFICULT PARTS list (large jumps, highest/
lowest notes, long sustains, rapid changes - already surfaced with a
one-click "Loop" per command.txt's own spec) into an actual practice loop
instead of just a listening aid.

Clicking **"Practice this"** on a flagged passage (`DifficultPartsPanel.tsx`):

- Loops that passage (reusing the existing loop-region mechanism) and
  automatically drops playback to 0.75x, restoring whatever speed was
  active before once you click "Done practicing".
- Enables the same microphone pipeline used by regular mic practice
  (`useMicrophonePitch`, in the `Player` component) rather than a second
  one, so pitch samples are timestamped against the same canonical
  playback clock the loop is using.
- On **"Check this attempt"**, judges the accumulated samples against the
  passage's target notes (`evaluateExerciseAttempt` in
  `packages/shared/src/exercisePractice.ts`) using a simple, generous
  in-tune-and-covered threshold - deliberately a plain pass/fail signal,
  not a full explanation (that's what the existing singing-feedback panel
  is for). A clean attempt increments a cumulative "clean pass" counter
  persisted per song/passage in `localStorage`
  (`apps/web/src/lib/exerciseProgress.ts`, same no-account-system rationale
  as the vocal range calibration above); reaching 3 marks the passage
  **Mastered** with a small badge that persists even after you stop
  practicing. A rough attempt doesn't reset the counter - the goal is
  "have you nailed this enough times," not punishing one bad take after
  good ones.

Like the difficulty rating and vocal range features, the synthetic e2e
fixture doesn't reliably produce a confident melody, so `difficultParts`
is normally empty for it; `tests/e2e/vocalExercise.spec.ts` forces one
difficult passage and a matching target note via route interception (same
technique as `vocalRangeFit.spec.ts`) to exercise the full flow for real.

## Spaced repetition for review

Per command.txt FUTURE FEATURES's "spaced repetition for lyrics":
`computeReviewSchedule` (`packages/shared/src/reviewSchedule.ts`) reuses
the existing `PracticeSummaryDTO` (`sessionCount`/`lastPracticedAt` -
already tracked by practice history above, no new schema) to compute a
per-**song** next-review date on a simple, increasing-interval schedule
(1, 3, 7, 14, 30, 60 days, indexed by how many times you've practiced it -
the same shape as a basic Leitner system). This is deliberately scoped to
whole songs, not individual lines: there's no per-line practice history to
key a finer schedule off, and no "how well did you recall it" signal to
calibrate a full SM-2-style ease factor from (this is singing practice,
not flashcard grading) - a fixed schedule keyed only by repetition count
is the honest amount of sophistication the available data supports.

- The **library** (homepage) sorts songs due for review to the top (stable
  sort - everything else keeps the server's newest-first order) and shows
  a red "Due for review" badge; songs not yet due show a muted "next
  review due in Nd" instead.
- The **practice page**'s Song insights panel shows the same badge/estimate
  next to the existing practice-count line.
- A never-practiced song has no schedule at all (nothing to review yet) -
  it's neither due nor "not due," it just doesn't show either indicator.

## Tests

```bash
npm run test              # shared package + API unit/integration tests (Vitest)
npm run test:shared       # URL validation, Hz<->MIDI/note-name conversion,
                           # timeline/loop-boundary math, playback-speed
                           # calculations, pitch/melody helpers
npm run test:api          # audio probing, rate limiting, and a real SQLite-
                           # backed integration test of song creation +
                           # content-hash caching
npm run test:e2e          # Playwright: paste link -> upload -> full real
                           # pipeline -> play/highlight/loop/speed/transpose/
                           # section-jump/difficulty-estimate/practice-
                           # history, against the synthetic no-copyright
                           # fixture; plus microphone-practice, vocal-range-
                           # calibration, difficult-passage-exercise, and
                           # spaced-repetition-schedule tests (the last two
                           # of those against a real Chromium fake audio-
                           # capture device where relevant - see "Microphone
                           # practice", "Vocal range fit check", "Vocal
                           # exercises for difficult passages", and "Spaced
                           # repetition for review" above)

cd apps/worker
pytest                    # unit tests per pipeline stage, plus real
                           # integration tests that run actual ffmpeg,
                           # faster-whisper, and pyin against the synthetic
                           # fixture (skipped automatically if the fixture
                           # or ffmpeg isn't present)
ruff check .               # lint
ruff format --check .      # formatting
```

`npm run test:e2e` starts the API and web dev servers itself
(`playwright.config.ts`'s `webServer`) and the Python worker
(`tests/e2e/global-setup.ts`, since it's a poll loop rather than an HTTP
server Playwright can health-check) — nothing needs to be running
beforehand, though it will reuse already-running dev servers if present.
No copyrighted or downloaded material is used anywhere in the test suite;
`apps/worker/fixtures/generate_fixture.py` synthesizes the one fixture
file from local TTS + a synthesized chord.

## Security considerations

- YouTube URLs are validated and normalized to a canonical `watch?v=<11
  chars>` form before any outbound request is made from them
  (`packages/shared/src/youtube.ts`); the API only ever calls YouTube's own
  oEmbed host with that canonicalized URL, never an arbitrary user-supplied
  one, which forecloses SSRF via this input.
- Uploaded audio is probed with `ffprobe` before being trusted — the
  declared MIME type and duration are never taken at face value
  (`audioProbe.ts`).
- Uploads are capped (`MAX_UPLOAD_MB`, default 60MB) and processing job
  creation is rate-limited per client (`rateLimiter.ts`, 5/hour by default)
  and capped for total concurrency (`MAX_CONCURRENT_JOBS`) to bound worker
  cost.
- All request bodies are validated with `zod` schemas
  (`apps/api/src/validation/schemas.ts`); the worker's own callbacks
  (`/internal/*`) require `WORKER_SHARED_SECRET` and are validated the same
  way.
- Object storage is private by default; the browser only ever receives
  short-lived signed URLs, never a public/static file path.
- The web app never holds API secrets — only `NEXT_PUBLIC_API_BASE_URL`.

## Known limitations

- Transcription and pitch detection are automated best-effort estimates,
  not ground truth — confidence is stored per word/note/section and
  surfaced in the UI (e.g. "Estimated key... (75% confidence, estimate)",
  "Possible transcription error") rather than presented as fact. Users can
  correct transcription via the built-in Edit Lyrics mode without breaking
  synchronization.
- Section detection (verse/chorus/bridge/...) is a conservative heuristic
  based on line-timing gaps, not music-informed structural analysis; it's
  presented as an estimate and is manually adjustable.
- `LicensedAudioProvider`/`AuthorizedRemoteAudioProvider` are architectural
  seams, not functioning integrations — no licensed audio partner is wired
  up out of the box, so user upload is the only audio source that actually
  works today.
- Live microphone pitch comparison and singing-score feedback are
  implemented (see [Microphone practice](#microphone-practice)) as an
  entirely client-side feature: no microphone audio is ever recorded,
  stored, or sent to the server, satisfying the privacy requirement by
  construction rather than needing an opt-in/retention policy for
  recordings that don't exist. Detection accuracy depends on the
  browser's autocorrelation-based pitch tracker, which is less accurate
  than the worker's offline `pyin` pipeline (a deliberate speed/accuracy
  tradeoff for something that has to run every frame in a tab — see
  `packages/shared/src/pitchDetection.ts`).
- `BullMqQueueProvider` is exercised by a dedicated CI job against a real
  Redis service container (`.github/workflows/ci.yml`'s `bullmq-smoke-test`
  job) — switching `QUEUE_PROVIDER=bullmq` is safe to rely on.
- `STORAGE_PROVIDER=s3` is implemented end-to-end, including the worker's
  side (download via presigned GET, upload every produced asset via
  presigned PUT — see [Object storage](#object-storage)), covered by
  `apps/worker/tests/test_pipeline_remote_storage.py` against a fake local
  object store, and exercised against a real MinIO instance by a dedicated
  CI job (`.github/workflows/ci.yml`'s `s3-smoke-test`; MinIO runs there as
  a plain background container rather than a `services:` entry, since that
  mechanism can't override an image's default command and MinIO's image
  needs an explicit `server /data`).

## Repository structure

```
apps/
  web/      Next.js/React frontend
  api/      Express/TypeScript API (Prisma + SQLite/Postgres)
  worker/   Python audio/ML pipeline (polls the queue over HTTP)

packages/
  shared/   Types + pure functions shared by web and api (timeline math,
            Hz<->MIDI/note-name conversion, YouTube URL validation)

tests/e2e/  Playwright end-to-end test + its own worker/server lifecycle
docker-compose.yml   Optional Postgres/Redis/MinIO infra
```
