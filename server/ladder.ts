export interface Rendition {
  /** Folder / playlist name inside storage/videos/<id>/ */
  name: string
  /** Target height in pixels */
  height: number
  /** Target width in pixels (always even) */
  width: number
  /** Target video bitrate in bits per second (used when `crf` is unset) */
  videoBitrate: number
  /** Video maxrate in bits per second (used when `crf` is unset) */
  maxrate: number
  /** Video buffer size in bits per second (used when `crf` is unset) */
  bufsize: number
  /** Audio bitrate in bits per second */
  audioBitrate: number
  /** Constant quality mode override; unset means bitrate (ABR) mode */
  crf?: number
}

export const NATIVE_CRF = 20
const NATIVE_AUDIO_BITRATE = 192_000
const MIN_RATE = 4_000_000
const MAX_RATE = 30_000_000

export const MAX_RENDITION_HEIGHT = Math.max(0, Number(process.env.MAX_RENDITION_HEIGHT ?? 2160))

interface FixedRendition extends Omit<Rendition, 'width' | 'crf'> {}

const FIXED_RENDITIONS: FixedRendition[] = [
  { name: '240p', height: 240, videoBitrate: 400_000, maxrate: 450_000, bufsize: 800_000, audioBitrate: 64_000 },
  { name: '360p', height: 360, videoBitrate: 900_000, maxrate: 1_000_000, bufsize: 1_600_000, audioBitrate: 96_000 },
  { name: '720p', height: 720, videoBitrate: 2_500_000, maxrate: 2_800_000, bufsize: 4_200_000, audioBitrate: 128_000 },
  { name: '1080p', height: 1080, videoBitrate: 4_500_000, maxrate: 5_000_000, bufsize: 8_000_000, audioBitrate: 160_000 },
]

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

function nativeMaxRate(sourceBitrate: number, height: number): number {
  if (sourceBitrate > 0) {
    return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(sourceBitrate * 1.2)))
  }
  const table: Record<number, number> = {
    1080: 6_000_000,
    1440: 10_000_000,
    2160: 20_000_000,
  }
  return table[height] ?? 6_000_000
}

/**
 * Builds the HLS rendition ladder for a source.
 *
 * The ladder always ends with a `full` rendition at the source resolution (capped
 * by MAX_RENDITION_HEIGHT), so the top quality is never downgraded below what the
 * original upload contains. Fixed bit-rate rungs below the source height are only
 * kept when they are actually smaller than the source (never upscaled).
 */
export function buildLadder(sourceWidth: number, sourceHeight: number, sourceBitrate = 0): Rendition[] {
  const topHeight = sourceHeight > 0 ? Math.min(sourceHeight, MAX_RENDITION_HEIGHT) : sourceHeight
  const renditions: Rendition[] = []

  for (const fixed of FIXED_RENDITIONS) {
    if (fixed.height < topHeight) {
      renditions.push({
        ...fixed,
        width: even((sourceWidth * fixed.height) / sourceHeight),
      })
    }
  }

  renditions.push({
    name: 'full',
    height: topHeight,
    width: even((sourceWidth * topHeight) / sourceHeight),
    videoBitrate: 0,
    maxrate: nativeMaxRate(sourceBitrate, topHeight),
    bufsize: nativeMaxRate(sourceBitrate, topHeight) * 2,
    audioBitrate: NATIVE_AUDIO_BITRATE,
    crf: NATIVE_CRF,
  })

  return renditions
}

export function ladderNames(sourceWidth: number, sourceHeight: number, sourceBitrate = 0): string[] {
  return buildLadder(sourceWidth, sourceHeight, sourceBitrate).map((rendition) => rendition.name)
}
