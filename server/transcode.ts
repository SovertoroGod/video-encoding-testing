import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { getVideo, updateVideo } from './db.ts'
import { videoDir } from './paths.ts'

const execFileAsync = promisify(execFile)

function resolveBinary(preferred: string | null | undefined, fallback: string): string {
  if (preferred && (!preferred.includes(path.sep) || fs.existsSync(preferred))) {
    return preferred
  }
  return fallback
}

const FFMPEG = resolveBinary(process.env.FFMPEG_PATH || ffmpegStatic, 'ffmpeg')
const FFPROBE = resolveBinary(process.env.FFPROBE_PATH || ffprobeStatic?.path, 'ffprobe')

export interface ProbeResult {
  duration: number
  width: number
  height: number
  hasAudio: boolean
}

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
  tags?: Record<string, string>
  side_data_list?: Array<{ rotation?: number }>
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string }
}

export async function probeVideo(filePath: string): Promise<ProbeResult> {
  let stdout: string
  try {
    const result = await execFileAsync(
      FFPROBE,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { maxBuffer: 20 * 1024 * 1024 },
    )
    stdout = result.stdout
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not inspect video. Is ffprobe available? ${message}`)
  }

  let data: FfprobeOutput
  try {
    data = JSON.parse(stdout) as FfprobeOutput
  } catch {
    throw new Error('ffprobe returned invalid metadata')
  }

  const video = data.streams?.find((stream) => stream.codec_type === 'video')
  if (!video?.width || !video?.height) {
    throw new Error('No video stream found in this file')
  }

  let width = video.width
  let height = video.height
  const rotationValue = video.side_data_list?.find((side) => typeof side.rotation === 'number')?.rotation
  const rotation = Math.abs(Number(rotationValue ?? video.tags?.rotate ?? 0))
  if (Math.round(rotation) % 180 === 90) {
    ;[width, height] = [height, width]
  }

  return {
    duration: Number(data.format?.duration ?? 0) || 0,
    width,
    height,
    hasAudio: data.streams?.some((stream) => stream.codec_type === 'audio') ?? false,
  }
}

function ffmpegArgs(input: string, outDir: string, meta: ProbeResult): string[] {
  const filter = [
    '[0:v]split=3[v240in][v360in][v720in]',
    '[v240in]scale=-2:240,setsar=1[v240]',
    '[v360in]scale=-2:360,setsar=1[v360]',
    '[v720in]scale=-2:720,setsar=1[v720]',
  ].join(';')

  const args = [
    '-hide_banner',
    '-y',
    '-progress',
    'pipe:1',
    '-nostats',
    '-i',
    input,
    '-filter_complex',
    filter,
    '-map',
    '[v240]',
  ]

  if (meta.hasAudio) args.push('-map', '0:a:0')
  args.push('-map', '[v360]')
  if (meta.hasAudio) args.push('-map', '0:a:0')
  args.push('-map', '[v720]')
  if (meta.hasAudio) args.push('-map', '0:a:0')

  args.push(
    '-sn',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-profile:v',
    'main',
    '-pix_fmt',
    'yuv420p',
    '-sc_threshold',
    '0',
    '-force_key_frames',
    'expr:gte(t,n_forced*4)',
    '-b:v:0',
    '400k',
    '-maxrate:v:0',
    '450k',
    '-bufsize:v:0',
    '800k',
    '-b:v:1',
    '900k',
    '-maxrate:v:1',
    '1000k',
    '-bufsize:v:1',
    '1600k',
    '-b:v:2',
    '2500k',
    '-maxrate:v:2',
    '2800k',
    '-bufsize:v:2',
    '4200k',
  )

  if (meta.hasAudio) {
    args.push(
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-b:a:0',
      '64k',
      '-b:a:1',
      '96k',
      '-b:a:2',
      '128k',
    )
  }

  args.push(
    '-max_muxing_queue_size',
    '1024',
    '-f',
    'hls',
    '-hls_time',
    '4',
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_list_size',
    '0',
    '-hls_segment_filename',
    path.join(outDir, '%v', 'segment_%03d.ts'),
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    meta.hasAudio
      ? 'v:0,a:0,name:240p v:1,a:1,name:360p v:2,a:2,name:720p'
      : 'v:0,name:240p v:1,name:360p v:2,name:720p',
    path.join(outDir, '%v', 'index.m3u8'),
  )

  return args
}

function runFfmpeg(
  args: string[],
  options: { onProgress?: (percent: number) => void; duration?: number } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let stdoutBuffer = ''
    let lastPercent = -1

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const [key, value] = line.split('=', 2)
        if (key === 'out_time_us' && options.duration && options.onProgress) {
          const seconds = Number(value) / 1_000_000
          if (Number.isFinite(seconds)) {
            const percent = Math.max(0, Math.min(99, Math.round((seconds / options.duration) * 100)))
            if (percent !== lastPercent) {
              lastPercent = percent
              options.onProgress(percent)
            }
          }
        }
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > 24_000) stderr = stderr.slice(-24_000)
    })

    child.on('error', (error) => {
      reject(
        new Error(
          `Could not start ffmpeg (${FFMPEG}). Install ffmpeg or set FFMPEG_PATH. ${error.message}`,
        ),
      )
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      const details =
        stderr
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-6)
          .join(' | ') || `ffmpeg exited with code ${code}`
      reject(new Error(details.slice(0, 900)))
    })
  })
}

async function makePoster(input: string, outPath: string, duration: number): Promise<void> {
  const seek = duration > 1 ? Math.min(1, duration / 2) : 0
  await runFfmpeg([
    '-hide_banner',
    '-y',
    '-ss',
    seek.toFixed(2),
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    'scale=720:-2',
    '-q:v',
    '3',
    outPath,
  ])
}

export async function processVideo(id: string): Promise<void> {
  const row = getVideo(id)
  if (!row) return

  updateVideo(id, { status: 'processing', progress: 0, error: null })

  const outDir = videoDir(id)

  try {
    await rm(outDir, { recursive: true, force: true })
    await Promise.all(
      ['240p', '360p', '720p'].map((variant) => mkdir(path.join(outDir, variant), { recursive: true })),
    )

    const meta = await probeVideo(row.original_path)
    updateVideo(id, {
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      progress: 1,
    })

    const posterPath = path.join(outDir, 'poster.jpg')
    await makePoster(row.original_path, posterPath, meta.duration)
    if (fs.existsSync(posterPath)) {
      updateVideo(id, { poster_path: posterPath })
    }

    updateVideo(id, { progress: 2 })
    await runFfmpeg(ffmpegArgs(row.original_path, outDir, meta), {
      duration: meta.duration,
      onProgress: (percent) => updateVideo(id, { progress: Math.max(2, percent) }),
    })

    const master = path.join(outDir, 'master.m3u8')
    if (!fs.existsSync(master)) {
      throw new Error('Transcoding finished but master.m3u8 is missing')
    }

    updateVideo(id, {
      status: 'ready',
      progress: 100,
      hls_path: master,
      error: null,
    })
    console.log(`[transcode] ${id} ready (${meta.width}x${meta.height}, ${meta.duration.toFixed(1)}s)`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[transcode] ${id} failed: ${message}`)
    await rm(outDir, { recursive: true, force: true }).catch(() => undefined)
    updateVideo(id, {
      status: 'failed',
      progress: 0,
      error: message.slice(0, 900),
      poster_path: null,
      hls_path: null,
    })
  }
}
