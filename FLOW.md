# ClipLoop — Detailed Project Flow

ClipLoop is a local-first, TikTok-style vertical video app. A user uploads a video; the server encodes it into **240p, 360p, and 720p HLS renditions**; the React frontend plays the adaptive stream in a full-screen vertical feed.

- **Frontend:** React 19 + Vite + TypeScript + Tailwind 4 + hls.js
- **Backend:** Express 5 + multer + ffmpeg-static / ffprobe-static
- **Database:** Node's built-in `node:sqlite`
- **Storage:** local disk (`storage/`)
- **Dev ports:** web `5173`, API `8787`
- **Production:** Express serves `dist/` and the API together on `8787`

---

## 1. High-level architecture

```text
┌──────────────────────────── Browser ────────────────────────────┐
│  React SPA                                                       │
│                                                                  │
│  /             TikTok-style vertical feed                        │
│  /upload       Upload + encoding progress + media library        │
│                                                                  │
│  hls.js ──────► /api/hls/<id>/master.m3u8                        │
│                  ├── 240p/index.m3u8 + segments                  │
│                  ├── 360p/index.m3u8 + segments                  │
│                  └── 720p/index.m3u8 + segments                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │ HTTP (JSON + multipart + HLS files)
┌──────────────────────────────▼───────────────────────────────────┐
│  Express API                                                     │
│                                                                  │
│  POST   /api/videos          upload                              │
│  GET    /api/videos          list                                │
│  GET    /api/videos/:id      status / progress                   │
│  POST   /api/videos/:id/retry                                    │
│  POST   /api/videos/:id/view                                     │
│  DELETE /api/videos/:id                                          │
│  GET    /api/hls/*           static HLS + poster serving         │
│                                                                  │
│  ├── multer ───────────────► storage/uploads/                    │
│  ├── SQLite ───────────────► data/app.db                         │
│  ├── in-process job queue ─► server/transcode.ts                 │
│  └── ffmpeg ───────────────► storage/videos/<id>/                │
└──────────────────────────────────────────────────────────────────┘
```

In development, Vite runs on `5173` and proxies `/api` to `8787`.

In production, `npm run build` creates `dist/`, then `npm start` makes Express serve those static assets with an SPA fallback, so the app and API share one origin.

---

## 2. Project structure

```text
video-testing/
├── client/
│   ├── index.html
│   ├── public/favicon.svg
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                  # pathname routing: / and /upload
│       ├── index.css                # Tailwind + custom animations
│       ├── components/
│       │   ├── Feed.tsx             # feed state, polling, navigation
│       │   ├── VideoCard.tsx        # video, overlays, actions, progress
│       │   └── UploadPage.tsx       # dropzone, progress, library
│       ├── hooks/
│       │   ├── useHls.ts            # hls.js setup + quality control
│       │   └── useToast.ts
│       ├── lib/
│       │   ├── api.ts               # fetch + XHR upload client
│       │   └── format.ts
│       └── types.ts
├── server/
│   ├── index.ts                     # Express routes + HLS static serving
│   ├── paths.ts                     # storage paths + env config
│   ├── db.ts                        # schema + queries
│   ├── queue.ts                     # in-process transcode queue
│   ├── transcode.ts                 # ffprobe, poster, ffmpeg pipeline
│   └── ffprobe-static.d.ts
├── scripts/seed.ts                  # generates and encodes demo clips
├── storage/                         # generated runtime data
├── data/app.db                      # generated SQLite database
├── dist/                            # generated production build
├── README.md
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 3. Database model

Table: `videos`

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | TEXT PK | UUID, also used as the storage folder name |
| `caption` | TEXT | User caption, max 280 chars |
| `original_name` | TEXT | Original upload filename |
| `original_path` | TEXT | Absolute path to source file |
| `size` | INTEGER | Original file size in bytes |
| `duration` | REAL | Seconds, from ffprobe |
| `width` / `height` | INTEGER | Display dimensions after rotation handling |
| `poster_path` | TEXT | Path to extracted `poster.jpg` |
| `hls_path` | TEXT | Path to `master.m3u8` |
| `status` | TEXT | `queued`, `processing`, `ready`, `failed` |
| `progress` | INTEGER | 0–100 encoding progress |
| `error` | TEXT | Failure reason |
| `views` | INTEGER | Incremented by playback |
| `created_at` | INTEGER | Unix milliseconds; feed sorts DESC |

SQLite is opened in WAL mode. On server boot, any row left in `processing` is reset to `queued` and re-enqueued.

---

## 4. Upload flow

### 4.1 Client

Entry point: `/upload` (`client/src/components/UploadPage.tsx`)

1. User drags a file or selects one with the file picker.
2. Client-side validation:
   - max **300 MB** (`MAX_UPLOAD_MB`)
   - MIME starts with `video/` or extension is one of mp4/m4v/mov/webm/mkv/avi/ogv
3. Optional caption is entered (280 char limit).
4. On **Upload & encode**, an `XMLHttpRequest` sends `multipart/form-data`:
   - field `video`: the file
   - field `caption`: text
5. `xhr.upload.onprogress` drives the upload percentage bar.
6. The response is a `video` object with `status: "queued"`.
7. The upload page stores `selectedId`, refreshes the library, and starts polling every **1.5 s** while anything is `queued`/`processing`.

The XHR is used instead of `fetch` so upload progress is available.

### 4.2 Server

Endpoint: `POST /api/videos` in `server/index.ts`

```text
Request
  Content-Type: multipart/form-data
  video=<file>
  caption=<text>

1. multer streams the file directly to disk:
     storage/uploads/<uuid>.<ext>
   - file size limited to MAX_UPLOAD_MB
   - extension sanitized to /^\.[a-z0-9]{1,10}$/ (fallback .mp4)
   - basic video MIME/extension filter

2. id = basename(uploaded file)
3. Insert a SQLite row with status='queued'
4. enqueueVideo(id)
5. Respond 201 immediately:
     { "video": { id, status: "queued", progress: 0, ... } }
```

The upload response does not wait for encoding.

Equivalent CLI test:

```bash
curl -X POST http://localhost:8787/api/videos \
  -F "caption=My clip" \
  -F "video=@clip.mp4"
```

---

## 5. Encoding flow

Worker: `processVideo(id)` in `server/transcode.ts`

### 5.1 Queue

`server/queue.ts` is an in-process FIFO queue.

- concurrency defaults to **1** (`TRANSCODE_CONCURRENCY`)
- duplicate IDs are prevented with a pending set
- on boot, unfinished jobs are requeued
- no Redis / external worker: this is intentionally single-instance

### 5.2 Steps

```text
1. Load row from SQLite
2. status = processing, progress = 0
3. Delete any previous output folder
4. Create:
     storage/videos/<id>/240p/
     storage/videos/<id>/360p/
     storage/videos/<id>/720p/
5. ffprobe:
     duration, width, height, rotation, hasAudio
   Rotation of 90/270 swaps width/height
6. Extract poster:
     seek min(1s, duration/2)
     scale width to 720, JPEG quality 3
     save poster.jpg
   Update poster_path early so the UI can show a thumbnail
7. Run one ffmpeg command (details below)
8. Verify master.m3u8 exists
9. status = ready, progress = 100, hls_path = master.m3u8
```

On any failure:

```text
- partial output folder is removed
- status = failed
- error = last useful ffmpeg/probe message
- original file stays on disk for retry
```

### 5.3 FFmpeg command shape

The source is decoded once, split, scaled to three heights, and encoded in one pass:

```bash
ffmpeg -i <original> \
  -filter_complex \
    "[0:v]split=3[v240in][v360in][v720in];\
     [v240in]scale=-2:240,setsar=1[v240];\
     [v360in]scale=-2:360,setsar=1[v360];\
     [v720in]scale=-2:720,setsar=1[v720]" \
  -map "[v240]" -map 0:a:0 \
  -map "[v360]" -map 0:a:0 \
  -map "[v720]" -map 0:a:0 \
  -c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p \
  -sc_threshold 0 -force_key_frames "expr:gte(t,n_forced*4)" \
  -b:v:0 400k -b:v:1 900k -b:v:2 2500k \
  -c:a aac -b:a:0 64k -b:a:1 96k -b:a:2 128k \
  -f hls -hls_time 4 -hls_playlist_type vod \
  -hls_flags independent_segments \
  -hls_segment_filename "<out>/%v/segment_%03d.ts" \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0,name:240p v:1,a:1,name:360p v:2,a:2,name:720p" \
  "<out>/%v/index.m3u8"
```

If the source has **no audio**:

- no audio streams are mapped
- `var_stream_map` becomes `v:0,name:240p v:1,name:360p v:2,name:720p`
- the generated playlists are video-only, which browsers still play

### 5.4 Encoding ladder

| Rendition | Height | Video bitrate | Maxrate | Audio | Approx. master bandwidth |
| --- | --- | --- | --- | --- | --- |
| 240p | 240 | 400 kbps | 450 kbps | 64 kbps | ~510 kbps |
| 360p | 360 | 900 kbps | 1000 kbps | 96 kbps | ~1.1 Mbps |
| 720p | 720 | 2500 kbps | 2800 kbps | 128 kbps | ~2.9 Mbps |

Width is automatic and always even (`scale=-2:<height>`). Portrait, square, and landscape sources all work. Sources smaller than a target are upscaled.

### 5.5 Progress reporting

FFmpeg is spawned with:

```bash
-progress pipe:1 -nostats
```

The server parses `out_time_us=...` from stdout, compares it to the probed duration, and updates SQLite `progress` from 0–99. On success it becomes 100.

Polling endpoint:

```bash
GET /api/videos/<id>
```

### 5.6 Output layout

```text
storage/videos/<id>/
├── master.m3u8
├── poster.jpg
├── 240p/
│   ├── index.m3u8
│   ├── segment_000.ts
│   ├── segment_001.ts
│   └── ...
├── 360p/
│   └── ...
└── 720p/
    └── ...
```

`master.m3u8` example:

```text
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=510400,RESOLUTION=136x240,CODECS="avc1.4d400d,mp4a.40.2"
240p/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=1095600,RESOLUTION=202x360,CODECS="avc1.4d4014,mp4a.40.2"
360p/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2890800,RESOLUTION=406x720,CODECS="avc1.4d401e,mp4a.40.2"
720p/index.m3u8
```

---

## 6. Playback flow

### 6.1 Feed data

`client/src/components/Feed.tsx`

1. `GET /api/videos` on mount.
2. Only videos with `status === "ready"` are rendered in the feed.
3. While any video is `queued`/`processing`, the feed polls every **2.5 s**.
4. A processing banner links back to `/upload`.
5. Deep links work: `/?v=<id>` finds the video and scrolls the feed to it.

### 6.2 Feed interaction

- Full-screen vertical `scroll-snap` container.
- Each card occupies the full frame height.
- `IntersectionObserver` at 60% visibility:
  - plays the visible card
  - pauses cards that leave the viewport
- `shouldLoad` keeps hls.js alive only for the active card plus **±1** neighbour.
- Active index is derived from `scrollTop / clientHeight`.
- Keyboard: `ArrowUp` / `ArrowDown` navigate, `M` mutes.
- Tap tracking:
  - single tap toggles play/pause (after a 220 ms double-tap window)
  - double tap likes the video with a heart animation
- Like state is stored in `localStorage` per video (`cliploop:like:<id>`).
- View tracking fires `POST /api/videos/:id/view` once per mounted card; the local count updates optimistically.

### 6.3 HLS setup

`client/src/hooks/useHls.ts`

```text
If MSE is supported:
  use hls.js (preferred → gives manual quality control)
  - maxBufferLength: 24s
  - backBufferLength: 10s
  - startLevel: 2 (720p)
  - enableWorker: true
  - on manifest parsed: expose levels [{index, height, bitrate}]
  - on fatal media error: recoverMediaError()
  - on other fatal errors: show playback error

Else if native HLS is supported:
  video.src = master.m3u8
  (used on older iOS Safari; quality menu hidden)
```

Playback URL:

```text
/api/hls/<id>/master.m3u8
```

The master playlist points at relative variant playlists, which point at relative segment files. Express serves them from `storage/videos` with:

| File | Content-Type | Cache-Control |
| --- | --- | --- |
| `.m3u8` | `application/vnd.apple.mpegurl` | `no-store` |
| `.ts` | `video/mp2t` | `public, max-age=31536000, immutable` |
| `.jpg` | `image/jpeg` | `public, max-age=3600` |

### 6.4 Quality selection

- The quality button appears when hls.js reports more than zero levels.
- Menu options: **Auto**, **720p**, **360p**, **240p** (derived from actual manifest heights).
- Selecting a level sets `hls.currentLevel = index`.
- Selecting Auto sets `hls.currentLevel = -1` to return to ABR.
- Playback begins at 720p and can downgrade automatically if bandwidth falls.

### 6.5 Video card UI

- Video is `object-contain`, over a blurred, scaled poster background.
- Top gradient keeps header controls legible.
- Bottom info: `@you`, caption, views, duration, source dimensions, file size, rendition chips.
- Right rail: mute, quality, like, share.
- Bottom edge: clickable seek/progress bar.
- Share copies `origin/?v=<id>`; falls back to a prompt if clipboard access fails.

---

## 7. API reference

### `GET /api/health`

```json
{
  "ok": true,
  "ffmpegPath": "bundled/default",
  "transcode": { "running": 0, "waiting": 0 },
  "concurrency": 1
}
```

### `GET /api/videos`

Returns every video, newest first, including queued/failed.

```json
{
  "videos": [
    {
      "id": "uuid",
      "caption": "Sunset loop",
      "originalName": "clip.mp4",
      "size": 352770,
      "duration": 8,
      "width": 720,
      "height": 1280,
      "status": "ready",
      "progress": 100,
      "error": null,
      "views": 3,
      "createdAt": 1792483339041,
      "posterUrl": "/api/hls/uuid/poster.jpg",
      "playbackUrl": "/api/hls/uuid/master.m3u8",
      "variants": ["240p", "360p", "720p"]
    }
  ]
}
```

### `GET /api/videos/:id`

```json
{ "video": { "...": "same shape as above" } }
```

Used for encoding progress.

### `POST /api/videos`

Multipart form:

- `video` — required file
- `caption` — optional string

Response: `201 Created`

```json
{ "video": { "status": "queued", "progress": 0, "...": "..." } }
```

### `POST /api/videos/:id/retry`

Only valid for `failed` videos. Resets to `queued`, clears progress/error, enqueues again.

- `409` if the video is not failed
- `410` if the original file is gone

### `POST /api/videos/:id/view`

```json
{ "views": 4 }
```

### `DELETE /api/videos/:id`

- `204` on success
- `409` while the video is actively encoding
- deletes the DB row, original upload, poster, playlists, and segments

### `GET /api/hls/:id/...`

Serves the HLS tree and poster from `storage/videos`. Path traversal is confined by `express.static`. Missing files return JSON 404.

---

## 8. Frontend routing and state

`App.tsx` uses the browser pathname and `history.pushState` instead of a router dependency.

| Path | Component |
| --- | --- |
| `/` | `Feed` |
| `/upload` | `UploadPage` |
| anything else | `Feed` |

`popstate` updates the pathname for browser back/forward.

### Feed state

- `videos` — full API list
- `readyVideos` — filtered from `videos`
- `pendingVideos` — queued/processing
- `activeIndex` — snap position
- `muted` — global feed mute
- polling interval — active only while jobs are pending
- toast — share feedback

### Upload state

- `file`, `caption`, `dragging`
- `uploading`, `uploadProgress`
- `selectedId` — currently highlighted job
- `videos` — library
- `busyId` — delete/retry in progress
- polling interval — active only while jobs are pending

---

## 9. Storage lifecycle

```text
Upload
  storage/uploads/<uuid>.<ext>
      │
      │  encoding succeeds
      ▼
  storage/videos/<uuid>/...
  original retained for retry/debug

Encoding failure
  storage/videos/<uuid>/ removed
  original retained, status=failed

Delete
  storage/uploads/<uuid>.<ext> removed
  storage/videos/<uuid>/ removed recursively
  DB row removed

Server restart
  processing → queued
  queued jobs re-enqueued
```

Originals are intentionally kept after success. Deleting the video removes them.

---

## 10. "Buffer" behavior

The project does **not**:

- read whole videos into a Node `Buffer`
- store videos as SQLite BLOBs
- keep entire uploads in API memory

It does:

- stream multipart uploads to disk with multer
- segment video into 4-second HLS chunks
- let the browser buffer chunks progressively
- adapt rendition based on network conditions

A 1 GB upload therefore does not consume 1 GB of server RAM, and a 100 MB video does not bloat SQLite.

---

## 11. Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API / production port |
| `STORAGE_DIR` | `./storage` | uploads + HLS output |
| `DATA_DIR` | `./data` | SQLite directory |
| `MAX_UPLOAD_MB` | `300` | upload limit |
| `TRANSCODE_CONCURRENCY` | `1` | parallel ffmpeg jobs |
| `FFMPEG_PATH` | bundled | override ffmpeg |
| `FFPROBE_PATH` | bundled | override ffprobe |

---

## 12. Running and testing

```bash
npm install
npm run seed      # optional demo clips
npm run dev       # API :8787 + Vite :5173
```

```bash
npm run typecheck
npm run build
npm start         # serves dist + API on :8787
```

### Verified scenarios

- Upload via curl → `queued → processing → ready`
- All three playlists and segments generated
- Master playlist resolutions: `136x240`, `202x360`, `406x720` for portrait
- HTTP MIME types and cache headers correct
- Browser upload through the real dropzone
- Feed autoplays at 720p (`406x720` decoded)
- Swiping pauses the previous video and starts the next
- Manual switch to 360p changes decoded size to `202x360`
- Silent landscape video (`640x360`, no audio) encodes correctly
- Production build serves feed, upload page, HLS, favicon, and SPA fallback
- No browser console or page errors in the tested flows

---

## 13. Failure handling summary

| Scenario | Behavior |
| --- | --- |
| Unsupported/corrupt video | Job becomes `failed`, error stored, original kept, Retry available |
| ffmpeg missing | Job fails with a clear ffmpeg path message |
| Upload too large | multer rejects, API returns an error (413 for size limit) |
| Server restart mid-encode | Job resets to `queued` and restarts |
| Delete while processing | API returns 409; UI disables delete |
| Retry non-failed video | API returns 409 |
| Feed API offline | Feed shows a retry screen |
| One video fails in feed | Per-card playback error message |
| Clipboard unavailable | Share falls back to a prompt |

---

## 14. Sequence diagram

```text
User        Browser                   Express                 SQLite       ffmpeg
 │            │                         │                       │             │
 │ select     │                         │                       │             │
 ├───────────►│ validate                │                       │             │
 │            │ POST multipart          │                       │             │
 │            ├────────────────────────►│ multer → disk         │             │
 │            │                         ├──────────────────────►│ queued      │
 │            │ ◄──── 201 queued ───────┤ enqueue               │             │
 │            │                         │                       │             │
 │            │ poll GET /videos/:id    │                       │             │
 │            ├────────────────────────►│ processing            │             │
 │            │                         ├──────────────────────────────────►  │
 │            │                         │                       │  probe      │
 │            │                         │                       │  poster     │
 │            │                         │ ◄──── progress ────────────────────  │
 │            │ ◄──── progress% ────────┤ update progress       │             │
 │            │                         │ ◄──── master.m3u8 ────────────────  │
 │            │ ◄──── ready + URLs ─────┤ ready                 │             │
 │            │                         │                       │             │
 │            │ GET master.m3u8         │                       │             │
 │            ├────────────────────────►│ express.static        │             │
 │            │ ◄──── playlist ─────────┤                       │             │
 │            │ GET variant + segments  │                       │             │
 │            ├────────────────────────►│                       │             │
 │            │ ◄──── HLS chunks ───────┤                       │             │
 │            │ hls.js plays 720p       │                       │             │
 │            │ ABR/manual switch       │                       │             │
```

---

## 15. Production boundaries

ClipLoop is designed as a local/demo app, not a multi-tenant service.

Current limitations:

- no authentication or ownership
- local disk only
- single Express process and in-process queue
- no CDN / signed URLs
- likes are client-side only
- no comments, follows, or recommendation engine
- deleting a video while encoding is blocked, not cancelled

A production version would typically:

1. Upload originals to S3/R2 with multipart signed URLs.
2. Queue jobs in Redis/SQS with dedicated transcoder workers.
3. Store HLS output in object storage and serve it through a CDN.
4. Store metadata in Postgres.
5. Add authentication, ownership, moderation, and analytics.
6. Delete originals after successful encoding (or move to cold storage).
