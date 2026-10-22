# ClipLoop

Upload a video once and stream it in a TikTok-style vertical feed, with **240p / 360p / 720p / 1080p and full resolution** adaptive HLS playback.

- Vertical, snap-scrolling feed with autoplay, tap to pause, progress seek, mute, likes and share links
- Automatic quality menu (`Auto / Full / 1080p / 720p / 360p / 240p`) driven by HLS.js
- One ffmpeg pass produces all renditions plus a master playlist and poster
- Upload progress, live encoding progress, retry, delete and a media library
- Local-first: SQLite metadata + files on disk, no cloud account required

## Requirements

- **Node.js 24+** (uses the built-in `node:sqlite` module)
- npm

FFmpeg and ffprobe are bundled through `ffmpeg-static` / `ffprobe-static`, so you do **not** need a system install.

## Quick start

```bash
npm install
npm run seed   # optional: two generated demo clips
npm run dev
```

Open **http://localhost:5173**. The API runs on **http://localhost:8787** and Vite proxies `/api` to it.

Go to `/upload` (or press **Upload** in the feed) and drop a video. It appears in the feed as soon as encoding finishes.

### Production

```bash
npm run build
npm start
```

The Express server then serves the built frontend and the API together at **http://localhost:8787**.

## How it works

For a deeper walkthrough — including the database schema, ffmpeg command, API reference, state flow, failure matrix and sequence diagram — see [FLOW.md](./FLOW.md).

```
POST /api/videos
      │  streamed to disk (multer — not held in memory)
      ▼
storage/uploads/<id>.<ext>
      │  queued (in-process worker, concurrency 1)
      ▼
ffprobe metadata → poster.jpg → single ffmpeg transcode pass
      │
      ├── 240p/index.m3u8 + 4s .ts segments
      ├── 360p/index.m3u8 + 4s .ts segments
      ├── 720p/index.m3u8 + 4s .ts segments
      └── master.m3u8
      │
      ▼
status = ready → vertical feed plays /api/hls/<id>/master.m3u8
```

### "Convert to a buffer"

The app deliberately does **not** load whole videos into a Node `Buffer` or store them as database blobs. That would exhaust memory and bloat the database for real video files. Instead:

- uploads stream directly to disk
- FFmpeg splits the video into short HLS segments
- the browser buffers those segments progressively and switches quality automatically

This gives the same "buffered" playback behavior, safely.

### Encoding ladder

The ladder is computed per upload from the probed source dimensions.

| Rendition | Video | Audio | Scale rule |
| --- | --- | --- | --- |
| 240p | ~400 kbps H.264 | 64 kbps AAC | height 240, width auto |
| 360p | ~900 kbps H.264 | 96 kbps AAC | height 360, width auto |
| 720p | ~2500 kbps H.264 | 128 kbps AAC | height 720, width auto |
| 1080p | ~4500 kbps H.264 | 160 kbps AAC | height 1080, width auto |
| Full | source bitrate (CRF 20) | ~192 kbps AAC | exact source resolution, capped by `MAX_RENDITION_HEIGHT` |

- H.264 `main` profile, `yuv420p`, AAC — broad browser support
- 4-second segments with forced keyframes at segment boundaries
- Portrait, landscape, rotation metadata and videos without audio are handled
- ffmpeg runs one decode pass and splits into scaled/encoded outputs
- The `Full` rendition is encoded at the source resolution with a constant-quality target (CRF 20) at ~1.2× the source bitrate, so nothing is downscaled below what the upload contains
- Fixed rungs are only produced when their height is smaller than the source height; nothing is ever upscaled
- Playback starts at the highest rendition (usually `Full`), then ABR can downgrade if bandwidth drops

### Storage layout

```
storage/
├── uploads/<uuid>.mp4                  original upload (kept for retry)
└── videos/<uuid>/
    ├── master.m3u8
    ├── poster.jpg
    ├── 240p/index.m3u8 + segment_*.ts
    ├── 360p/index.m3u8 + segment_*.ts
    ├── 720p/index.m3u8 + segment_*.ts
    ├── 1080p/index.m3u8 + segment_*.ts
    └── full/index.m3u8 + segment_*.ts
data/app.db                             SQLite metadata
```

## Project structure

```
client/
├── src/components/   Feed, VideoCard, UploadPage
├── src/hooks/        useHls, useToast
├── src/lib/          API client + formatting helpers
└── public/           favicon
server/
├── index.ts          Express API + HLS static serving
├── db.ts             node:sqlite schema and queries
├── transcode.ts      ffprobe, poster, ffmpeg HLS pipeline
├── queue.ts          in-process transcode queue
└── paths.ts          storage/config paths
scripts/seed.ts       generates + encodes demo clips
FLOW.md               detailed project flow and API reference
README.md             setup and overview
```

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Status + queue info |
| `GET` | `/api/videos` | All videos, newest first |
| `GET` | `/api/videos/:id` | One video / processing progress |
| `POST` | `/api/videos` | Multipart upload (`video`, `caption`) |
| `POST` | `/api/videos/:id/retry` | Re-run a failed encode |
| `POST` | `/api/videos/:id/view` | Increment view counter |
| `DELETE` | `/api/videos/:id` | Delete metadata + original + renditions |
| `GET` | `/api/hls/:id/...` | Master/variant playlists, segments, poster |

Video status flows through `queued → processing → ready` (or `failed`). Progress is stored as 0–100 and polled by the upload page.

## Configuration

Environment variables (all optional):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API / production server port |
| `STORAGE_DIR` | `./storage` | Upload + rendition storage |
| `DATA_DIR` | `./data` | SQLite database directory |
| `MAX_UPLOAD_MB` | `300` | Per-file upload limit |
| `TRANSCODE_CONCURRENCY` | `1` | Parallel ffmpeg jobs |
| `MAX_RENDITION_HEIGHT` | `2160` | Cap for the full-resolution rendition (source height up to 2160p; `0` = uncapped) |
| `FFMPEG_PATH` | bundled | Override ffmpeg binary |
| `FFPROBE_PATH` | bundled | Override ffprobe binary |

In development the web app runs on `5173`; set `PORT` to change the API and update the Vite proxy if needed.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | API (watch mode) + Vite dev server |
| `npm run dev:api` | API only |
| `npm run dev:web` | Vite only |
| `npm run build` | Build the frontend to `dist/` |
| `npm start` | Serve `dist/` + API from Express |
| `npm run seed` | Generate and encode demo clips |
| `npm run reencode` | Re-run the transcode pipeline over stored videos |
| `npm run typecheck` | TypeScript check |

## Notes and limits

- Designed for local/single-instance use: no authentication, no multi-user accounts, local disk storage
- The transcode queue lives in process memory; interrupted jobs are requeued on restart
- Uploads are retained after encoding so failed jobs can be retried. Deleting a video removes both the original and every rendition.
- Deletion is blocked while a video is actively encoding
- Likes are stored per-browser in `localStorage`; view counts are stored in SQLite
- On browsers without MSE (older iOS Safari), native HLS is used and the manual quality menu is hidden
- Uploads are limited by `MAX_UPLOAD_MB`; use a reverse proxy/CDN for large-scale production traffic

## Troubleshooting

**ffmpeg is missing / not executable**

```bash
npm rebuild ffmpeg-static
```

Alternatively install FFmpeg (`brew install ffmpeg`) and run with `FFMPEG_PATH=/opt/homebrew/bin/ffmpeg FFPROBE_PATH=/opt/homebrew/bin/ffprobe npm run dev`.

**Port already in use**

```bash
PORT=8788 npm run dev:api
```

Remember to update the Vite proxy target in `vite.config.ts` if you change the API port.

**Upload returns 413**

The file exceeds `MAX_UPLOAD_MB` (300 MB by default).

**`node:sqlite` not found**

Use Node.js 24 or newer.

## Production ideas

For a real deployment, move originals and HLS output to S3/R2, put a CDN in front of `/api/hls`, use a durable job queue and separate workers, add auth/ownership, and clean up original uploads after successful encodes.
