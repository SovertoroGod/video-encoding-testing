import {
  Eye,
  Heart,
  Loader2,
  Play,
  Share2,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { trackView } from '../lib/api.ts'
import { formatBytes, formatCount, formatDuration } from '../lib/format.ts'
import type { Video } from '../types.ts'
import { useHls } from '../hooks/useHls.ts'

interface VideoCardProps {
  video: Video
  muted: boolean
  active: boolean
  shouldLoad: boolean
  onToggleMute: () => void
  onToast: (message: string) => void
}

function RailButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 outline-none"
    >
      <span className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-black/40 text-white shadow-lg backdrop-blur-md transition hover:bg-black/60 active:scale-95">
        {children}
      </span>
      <span className="text-[10px] font-medium tracking-wide text-white/80 drop-shadow">{label}</span>
    </button>
  )
}

export function VideoCard({
  video,
  muted,
  active,
  shouldLoad,
  onToggleMute,
  onToast,
}: VideoCardProps) {
  const sectionRef = useRef<HTMLElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const tapTimer = useRef<number | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const visibleRef = useRef(false)
  const viewTrackedRef = useRef(false)

  const [paused, setPaused] = useState(true)
  const [progress, setProgress] = useState(0)
  const [buffering, setBuffering] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [views, setViews] = useState(video.views)
  const [liked, setLiked] = useState(() => {
    try {
      return localStorage.getItem(`cliploop:like:${video.id}`) === '1'
    } catch {
      return false
    }
  })
  const [heartBurst, setHeartBurst] = useState(0)

  const { levels, quality, error, setQuality } = useHls(
    videoRef,
    video.playbackUrl,
    shouldLoad,
  )

  const heights = Array.from(new Set(levels.map((level) => level.height))).sort((a, b) => a - b)

  const attemptPlay = useCallback(() => {
    const videoEl = videoRef.current
    if (!videoEl || videoEl.readyState < 2) return
    void videoEl
      .play()
      .then(() => setPaused(false))
      .catch(() => setPaused(true))
  }, [])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted, shouldLoad])

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        const visible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.6)
        visibleRef.current = visible
        const videoEl = videoRef.current
        if (!videoEl) return

        if (visible && shouldLoad) {
          attemptPlay()
          if (!viewTrackedRef.current) {
            viewTrackedRef.current = true
            setViews((current) => current + 1)
            void trackView(video.id)
          }
        } else if (!visible) {
          videoEl.pause()
          setPaused(true)
        }
      },
      { threshold: [0, 0.25, 0.6, 0.9, 1] },
    )
    observer.observe(section)
    return () => observer.disconnect()
  }, [attemptPlay, shouldLoad, video.id])

  useEffect(() => {
    if (!shouldLoad) {
      videoRef.current?.pause()
      setPaused(true)
    }
  }, [shouldLoad])

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return

    const onCanPlay = () => {
      if (visibleRef.current) attemptPlay()
    }
    const onPlaying = () => {
      setPaused(false)
      setBuffering(false)
    }
    const onWaiting = () => setBuffering(true)
    const onPause = () => setPaused(true)

    videoEl.addEventListener('canplay', onCanPlay)
    videoEl.addEventListener('playing', onPlaying)
    videoEl.addEventListener('waiting', onWaiting)
    videoEl.addEventListener('pause', onPause)
    return () => {
      videoEl.removeEventListener('canplay', onCanPlay)
      videoEl.removeEventListener('playing', onPlaying)
      videoEl.removeEventListener('waiting', onWaiting)
      videoEl.removeEventListener('pause', onPause)
    }
  }, [attemptPlay])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => {
    return () => {
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current)
    }
  }, [])

  const togglePlay = () => {
    const videoEl = videoRef.current
    if (!videoEl) return
    if (videoEl.paused) {
      attemptPlay()
    } else {
      videoEl.pause()
      setPaused(true)
    }
  }

  const like = () => {
    setLiked(true)
    setHeartBurst((count) => count + 1)
    try {
      localStorage.setItem(`cliploop:like:${video.id}`, '1')
    } catch {
      // ignore storage failures
    }
  }

  const toggleLike = () => {
    if (liked) {
      setLiked(false)
      try {
        localStorage.removeItem(`cliploop:like:${video.id}`)
      } catch {
        // ignore storage failures
      }
      return
    }
    like()
  }

  const handleSurfaceClick = () => {
    if (tapTimer.current !== null) {
      window.clearTimeout(tapTimer.current)
      tapTimer.current = null
      like()
      return
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null
      togglePlay()
    }, 220)
  }

  const handleTimeUpdate = () => {
    const videoEl = videoRef.current
    if (!videoEl || !Number.isFinite(videoEl.duration) || videoEl.duration === 0) return
    setProgress((videoEl.currentTime / videoEl.duration) * 100)
  }

  const handleSeek = (event: React.MouseEvent<HTMLDivElement>) => {
    const videoEl = videoRef.current
    if (!videoEl || !Number.isFinite(videoEl.duration) || videoEl.duration === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    videoEl.currentTime = ratio * videoEl.duration
    setProgress(ratio * 100)
  }

  const share = async () => {
    const url = `${window.location.origin}/?v=${video.id}`
    try {
      await navigator.clipboard.writeText(url)
      onToast('Link copied')
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  const qualityLabel = quality === 'auto' ? 'Auto' : `${quality}p`

  return (
    <section
      ref={sectionRef}
      data-video-id={video.id}
      className="relative h-full w-full shrink-0 snap-start overflow-hidden bg-black"
    >
      {video.posterUrl && (
        <img
          src={video.posterUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
        />
      )}

      <video
        ref={videoRef}
        data-active={active}
        className="relative z-[1] h-full w-full object-contain"
        poster={video.posterUrl ?? undefined}
        playsInline
        loop
        muted={muted}
        preload={shouldLoad ? 'auto' : 'metadata'}
        onTimeUpdate={handleTimeUpdate}
      />

      <button
        type="button"
        aria-label="Toggle playback"
        onClick={handleSurfaceClick}
        className="absolute inset-0 z-[2] cursor-default bg-transparent outline-none"
      />

      <div className="pointer-events-none absolute inset-0 z-[3] grid place-items-center">
        {paused && !error && (
          <span className="grid h-16 w-16 place-items-center rounded-full border border-white/15 bg-black/35 text-white backdrop-blur-md">
            <Play className="ml-1 h-7 w-7" fill="currentColor" />
          </span>
        )}
        {buffering && !paused && !error && (
          <span className="grid h-12 w-12 place-items-center rounded-full bg-black/40 text-white backdrop-blur-md">
            <Loader2 className="h-6 w-6 animate-spin" />
          </span>
        )}
      </div>

      {heartBurst > 0 && (
        <div
          key={heartBurst}
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center"
        >
          <Heart
            className="animate-heart h-28 w-28 text-rose-500 drop-shadow-[0_4px_24px_rgba(244,63,94,0.55)]"
            fill="currentColor"
          />
        </div>
      )}

      {error && (
        <div className="absolute inset-x-6 top-1/2 z-20 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/75 p-4 text-center text-sm text-white/90 backdrop-blur">
          {error}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[4] h-28 bg-gradient-to-b from-black/65 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[4] h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

      <aside className="absolute bottom-24 right-3 z-20 flex flex-col items-center gap-4">
        <RailButton label={muted ? 'Muted' : 'Sound'} onClick={onToggleMute}>
          {muted ? <VolumeX className="h-[22px] w-[22px]" /> : <Volume2 className="h-[22px] w-[22px]" />}
        </RailButton>

        {heights.length > 0 && (
          <div ref={menuRef} className="relative">
            <RailButton label={qualityLabel} onClick={() => setMenuOpen((open) => !open)}>
              <SlidersHorizontal className="h-[21px] w-[21px]" />
            </RailButton>
            {menuOpen && (
              <div className="animate-rise absolute bottom-0 right-14 w-32 overflow-hidden rounded-2xl border border-white/10 bg-black/85 p-1 shadow-2xl backdrop-blur-xl">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Quality
                </p>
                {(['auto', ...heights.slice().reverse()] as const).map((option) => {
                  const activeOption = option === 'auto' ? quality === 'auto' : quality === option
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setQuality(option)
                        setMenuOpen(false)
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition ${
                        activeOption
                          ? 'bg-white/15 text-white'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {option === 'auto' ? 'Auto' : `${option}p`}
                      {activeOption && <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <RailButton label="Like" onClick={toggleLike}>
          <Heart
            className={`h-[23px] w-[23px] ${liked ? 'text-rose-500' : ''}`}
            fill={liked ? 'currentColor' : 'none'}
          />
        </RailButton>

        <RailButton label="Share" onClick={() => void share()}>
          <Share2 className="h-[21px] w-[21px]" />
        </RailButton>
      </aside>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-6 pt-20">
        <div className="pr-16">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-white">@you</span>
            <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/70">
              Original
            </span>
          </div>

          <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-white/95">
            {video.caption || 'Untitled clip'}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/65">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {formatCount(views)} {views === 1 ? 'view' : 'views'}
            </span>
            <span>{formatDuration(video.duration)}</span>
            {video.width && video.height && (
              <span>
                {video.width}×{video.height}
              </span>
            )}
            <span>{formatBytes(video.size)}</span>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {(video.variants.length > 0 ? video.variants : ['240p', '360p', '720p']).map((variant) => (
              <span
                key={variant}
                className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/55"
              >
                {variant}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div
        role="slider"
        aria-label="Video progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        tabIndex={0}
        onClick={handleSeek}
        className="absolute inset-x-0 bottom-0 z-30 flex h-4 cursor-pointer items-end"
      >
        <div className="h-[3px] w-full bg-white/25">
          <div
            className="h-full bg-white transition-[width] duration-150 ease-linear"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      </div>
    </section>
  )
}
