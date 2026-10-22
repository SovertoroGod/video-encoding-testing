import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import ffmpegStatic from 'ffmpeg-static'
import { createVideo, getVideo, listVideos } from '../server/db.ts'
import { UPLOAD_DIR, ensureStorage } from '../server/paths.ts'
import { processVideo } from '../server/transcode.ts'

const execFileAsync = promisify(execFile)
const ffmpeg = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg'

interface DemoClip {
  originalName: string
  caption: string
  source: string
  tone: number
}

const clips: DemoClip[] = [
  {
    originalName: 'aurora-demo.mp4',
    caption: 'Aurora drift — one upload, every quality.',
    source:
      'gradients=s=1080x1920:d=9:speed=0.08:c0=0x020617:c1=0x4c1d95:c2=0x0e7490:n=3',
    tone: 196,
  },
  {
    originalName: 'sunset-demo.mp4',
    caption: 'Sunset loop. Swipe through the feed.',
    source:
      'gradients=s=1080x1920:d=9:speed=0.06:c0=0x1c1917:c1=0xbe123c:c2=0xf59e0b:n=3',
    tone: 294,
  },
]

async function makeClip(clip: DemoClip, filePath: string): Promise<void> {
  await execFileAsync(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    clip.source,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${clip.tone}:duration=9`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    filePath,
  ])
}

async function main() {
  ensureStorage()

  try {
    await execFileAsync(ffmpeg, ['-version'])
  } catch {
    console.error(`Could not run ffmpeg at "${ffmpeg}". Run "npm rebuild ffmpeg-static" or set FFMPEG_PATH.`)
    process.exit(1)
  }

  for (const clip of clips) {
    if (listVideos().some((video) => video.original_name === clip.originalName)) {
      console.log(`Skipping ${clip.originalName} (already seeded)`)
      continue
    }

    const id = randomUUID()
    const filePath = path.join(UPLOAD_DIR, `${id}.mp4`)
    console.log(`Generating ${clip.originalName}…`)
    await makeClip(clip, filePath)

    createVideo({
      id,
      caption: clip.caption,
      originalName: clip.originalName,
      originalPath: filePath,
      size: fs.statSync(filePath).size,
    })

    console.log(`Encoding adaptive renditions (240p / 360p / 720p / 1080p / full) for ${clip.originalName}…`)
    await processVideo(id)
    const row = getVideo(id)
    if (row?.status !== 'ready') {
      console.error(`Seed failed for ${clip.originalName}: ${row?.error || 'unknown error'}`)
      process.exit(1)
    }
    console.log(`  ready → /api/hls/${id}/master.m3u8`)
  }

  console.log('\nDone. Start the app with "npm run dev".')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
