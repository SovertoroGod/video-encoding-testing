import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import multer from 'multer'
import {
  createVideo,
  deleteVideoRow,
  getVideo,
  incrementViews,
  listQueuedVideoIds,
  listVideos,
  resetInterruptedJobs,
  updateVideo,
  type VideoRow,
} from './db.ts'
import {
  DIST_DIR,
  MAX_UPLOAD_MB,
  PORT,
  TRANSCODE_CONCURRENCY,
  UPLOAD_DIR,
  VIDEO_DIR,
  ensureStorage,
  videoDir,
} from './paths.ts'
import { enqueueVideo, queueStats } from './queue.ts'

ensureStorage()

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const rawExt = path.extname(file.originalname).toLowerCase()
      const ext = /^\.[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : '.mp4'
      cb(null, `${randomUUID()}${ext}`)
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const validMime = file.mimetype.startsWith('video/')
    const validExt = /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i.test(file.originalname)
    if (!validMime && !validExt) {
      cb(new Error('That file does not look like a video. Use MP4, MOV, WebM or MKV.'))
      return
    }
    cb(null, true)
  },
})

function serializeVideo(row: VideoRow) {
  return {
    id: row.id,
    caption: row.caption,
    originalName: row.original_name,
    size: row.size,
    duration: row.duration,
    width: row.width,
    height: row.height,
    status: row.status,
    progress: row.progress,
    error: row.error,
    views: row.views,
    createdAt: row.created_at,
    posterUrl: row.poster_path ? `/api/hls/${row.id}/poster.jpg` : null,
    playbackUrl: row.status === 'ready' ? `/api/hls/${row.id}/master.m3u8` : null,
    variants: row.status === 'ready' ? ['240p', '360p', '720p'] : [],
  }
}

const asyncHandler =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ffmpegPath: process.env.FFMPEG_PATH ? 'env' : 'bundled/default',
    transcode: queueStats(),
    concurrency: TRANSCODE_CONCURRENCY,
  })
})

app.get('/api/videos', (_req, res) => {
  res.json({ videos: listVideos().map(serializeVideo) })
})

app.get('/api/videos/:id', (req, res) => {
  const row = getVideo(String(req.params.id))
  if (!row) {
    res.status(404).json({ error: 'Video not found' })
    return
  }
  res.json({ video: serializeVideo(row) })
})

app.post(
  '/api/videos',
  (req, res, next) => {
    upload.single('video')(req, res, (error) => {
      if (error) {
        next(error)
        return
      }
      void (async () => {
        const file = req.file
        if (!file) {
          res.status(400).json({ error: 'No video file was uploaded' })
          return
        }

        const id = path.parse(file.filename).name
        const caption = String(req.body?.caption ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 280)

        try {
          const row = createVideo({
            id,
            caption,
            originalName: file.originalname.slice(0, 200),
            originalPath: file.path,
            size: file.size,
          })
          enqueueVideo(id)
          res.status(201).json({ video: serializeVideo(row) })
        } catch (error) {
          await fsPromises.rm(file.path, { force: true }).catch(() => undefined)
          throw error
        }
      })().catch(next)
    })
  },
)

app.post('/api/videos/:id/retry', (req, res) => {
  const row = getVideo(String(req.params.id))
  if (!row) {
    res.status(404).json({ error: 'Video not found' })
    return
  }
  if (row.status !== 'failed') {
    res.status(409).json({ error: 'Only failed videos can be retried' })
    return
  }
  if (!fs.existsSync(row.original_path)) {
    res.status(410).json({ error: 'The original file is missing, so this cannot be retried' })
    return
  }
  updateVideo(row.id, { status: 'queued', progress: 0, error: null })
  enqueueVideo(row.id)
  res.json({ video: serializeVideo(getVideo(row.id)!) })
})

app.post('/api/videos/:id/view', (req, res) => {
  const row = getVideo(String(req.params.id))
  if (!row) {
    res.status(404).json({ error: 'Video not found' })
    return
  }
  const views = incrementViews(row.id)
  res.json({ views })
})

app.delete(
  '/api/videos/:id',
  asyncHandler(async (req, res) => {
    const row = getVideo(String(req.params.id))
    if (!row) {
      res.status(404).json({ error: 'Video not found' })
      return
    }
    if (row.status === 'processing') {
      res.status(409).json({ error: 'This video is still being processed. Try again in a moment.' })
      return
    }

    await fsPromises.rm(videoDir(row.id), { recursive: true, force: true })
    await fsPromises.rm(row.original_path, { force: true })
    deleteVideoRow(row.id)
    res.status(204).end()
  }),
)

app.use(
  '/api/hls',
  express.static(VIDEO_DIR, {
    index: false,
    dotfiles: 'deny',
    fallthrough: false,
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase()
      if (ext === '.m3u8') {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
        res.setHeader('Cache-Control', 'no-store')
      } else if (ext === '.ts') {
        res.setHeader('Content-Type', 'video/mp2t')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else if (ext === '.jpg' || ext === '.jpeg') {
        res.setHeader('Cache-Control', 'public, max-age=3600')
      }
    },
  }),
)

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false }))
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next()
      return
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return
  const code = (error as { code?: string })?.code
  if (code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: `Video is too large. The limit is ${MAX_UPLOAD_MB} MB.` })
    return
  }
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.message })
    return
  }
  console.error('[server]', error)
  const status = Number(
    (error as { status?: number; statusCode?: number })?.status ??
      (error as { statusCode?: number })?.statusCode ??
      500,
  )
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: error instanceof Error ? error.message : 'Something went wrong',
  })
}
app.use(errorHandler)

resetInterruptedJobs()
for (const id of listQueuedVideoIds()) {
  enqueueVideo(id)
}

const server = app.listen(PORT, () => {
  console.log(`ClipLoop API listening on http://localhost:${PORT}`)
  console.log(`Storage: ${VIDEO_DIR}`)
  const pending = listQueuedVideoIds().length
  if (pending > 0) console.log(`Requeued ${pending} unfinished job(s)`)
})

server.on('error', (error) => {
  console.error(`[server] Could not listen on port ${PORT}:`, error.message)
  process.exit(1)
})
