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
  presigned GET URLs the same way.

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
                           # pipeline -> play/highlight/loop/speed, against
                           # the synthetic no-copyright fixture

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
- Live microphone pitch comparison and singing-score feedback are designed
  for (see the `PitchFrame`/confidence data model) but not yet implemented.
- `BullMqQueueProvider` is not exercised by the automated test suite, which
  runs without Redis; it's a straightforward swap (same `QueueProvider`
  interface as the default) but should get a manual smoke test before
  relying on it in production.

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
