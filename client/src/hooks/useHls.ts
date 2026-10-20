import Hls from 'hls.js'
import { useEffect, useRef, useState, type RefObject } from 'react'

export interface HlsLevel {
  index: number
  height: number
  bitrate: number
}

export interface UseHlsResult {
  levels: HlsLevel[]
  native: boolean
  quality: 'auto' | number
  error: string | null
  setQuality: (height: number | 'auto') => void
}

export function useHls(
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | null,
  enabled: boolean,
): UseHlsResult {
  const hlsRef = useRef<Hls | null>(null)
  const [levels, setLevels] = useState<HlsLevel[]>([])
  const [native, setNative] = useState(false)
  const [quality, setQualityState] = useState<'auto' | number>('auto')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLevels([])
    setQualityState('auto')
    setError(null)

    const video = videoRef.current
    if (!video || !src || !enabled) return

    const canPlayNative = video.canPlayType('application/vnd.apple.mpegurl') !== ''
    const mseSupported = Hls.isSupported()

    // Prefer hls.js so we get ABR control and a quality menu. Fall back to
    // native HLS only when MSE is unavailable (notably older iOS Safari).
    if (!mseSupported && canPlayNative) {
      setNative(true)
      video.src = src
      return () => {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    }

    setNative(false)
    if (!mseSupported) {
      setError('This browser cannot play HLS video.')
      return
    }

    const hls = new Hls({
      maxBufferLength: 24,
      backBufferLength: 10,
      // 240p, 360p, 720p → start on the highest rendition, then let ABR
      // downgrade if the network can't keep up.
      startLevel: 2,
      enableWorker: true,
    })
    hlsRef.current = hls

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const nextLevels = hls.levels
        .map((level, index) => ({
          index,
          height: Math.round(level.height || 0),
          bitrate: Math.round(level.bitrate || 0),
        }))
        .filter((level) => level.height > 0)
      setLevels(nextLevels)
    })

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError()
        return
      }
      setError('Playback failed. Try again.')
      hls.destroy()
      hlsRef.current = null
    })

    hls.loadSource(src)
    hls.attachMedia(video)

    return () => {
      hls.destroy()
      hlsRef.current = null
      setLevels([])
    }
  }, [src, enabled, videoRef])

  const setQuality = (height: number | 'auto') => {
    const hls = hlsRef.current
    if (!hls) return
    if (height === 'auto') {
      hls.currentLevel = -1
      setQualityState('auto')
      return
    }
    const level = levels.find((candidate) => candidate.height === height)
    if (level) {
      hls.currentLevel = level.index
      setQualityState(height)
    }
  }

  return { levels, native, quality, error, setQuality }
}
