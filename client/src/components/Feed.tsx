import { Clapperboard, Loader2, RefreshCw, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../hooks/useToast.ts'
import { fetchVideos } from '../lib/api.ts'
import type { Video } from '../types.ts'
import { VideoCard } from './VideoCard.tsx'

interface FeedProps {
  navigate: (path: string) => void
}

export function Feed({ navigate }: FeedProps) {
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [muted, setMuted] = useState(true)

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const scrollFrame = useRef<number | null>(null)
  const deepLinked = useRef(false)
  const { message, show } = useToast()

  const readyVideos = useMemo(() => videos.filter((video) => video.status === 'ready'), [videos])
  const pendingVideos = useMemo(
    () => videos.filter((video) => video.status === 'queued' || video.status === 'processing'),
    [videos],
  )
  const hasPending = pendingVideos.length > 0
  const currentPending = pendingVideos[0]

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const next = await fetchVideos()
      setVideos(next)
      setError(null)
    } catch (loadError) {
      if (!silent) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load videos')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!hasPending) return
    const timer = window.setInterval(() => void load(true), 2500)
    return () => window.clearInterval(timer)
  }, [hasPending, load])

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, readyVideos.length - 1)))
  }, [readyVideos.length])

  useEffect(() => {
    if (deepLinked.current || readyVideos.length === 0) return
    const id = new URLSearchParams(window.location.search).get('v')
    if (!id) {
      deepLinked.current = true
      return
    }
    const index = readyVideos.findIndex((video) => video.id === id)
    if (index < 0) return
    deepLinked.current = true
    requestAnimationFrame(() => {
      const scroller = scrollerRef.current
      if (!scroller) return
      scroller.scrollTop = index * scroller.clientHeight
      setActiveIndex(index)
    })
  }, [readyVideos])

  const handleScroll = () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = requestAnimationFrame(() => {
      const scroller = scrollerRef.current
      if (!scroller || scroller.clientHeight === 0) return
      const index = Math.max(
        0,
        Math.min(readyVideos.length - 1, Math.round(scroller.scrollTop / scroller.clientHeight)),
      )
      setActiveIndex((current) => (current === index ? current : index))
    })
  }

  const toggleMute = useCallback(() => {
    const next = !muted
    setMuted(next)
    const video = scrollerRef.current?.querySelector<HTMLVideoElement>('video[data-active="true"]')
    if (video) {
      video.muted = next
      if (!next && video.paused) void video.play().catch(() => undefined)
    }
  }, [muted])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) {
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const scroller = scrollerRef.current
        if (!scroller) return
        const direction = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = Math.max(0, Math.min(readyVideos.length - 1, activeIndex + direction))
        scroller.scrollTo({ top: nextIndex * scroller.clientHeight, behavior: 'smooth' })
      }
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault()
        toggleMute()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, readyVideos.length, toggleMute])

  const pendingPercent = currentPending
    ? currentPending.status === 'queued'
      ? 0
      : currentPending.progress
    : 0

  return (
    <div className="relative flex h-[100dvh] items-center justify-center overflow-hidden bg-[#09090b] sm:p-6">
      <div className="pointer-events-none absolute inset-10 hidden rounded-[48px] bg-gradient-accent opacity-20 blur-3xl sm:block" />

      <div className="relative z-10 h-[100dvh] w-full max-w-[440px] overflow-hidden bg-black shadow-2xl sm:h-[calc(100dvh-3rem)] sm:rounded-[32px] sm:ring-1 sm:ring-white/10">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/75 via-black/35 to-transparent px-4 pb-6 pt-[max(0.85rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="pointer-events-auto flex items-center gap-2 outline-none"
          >
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-accent shadow-lg shadow-indigo-500/20">
              <Clapperboard className="h-[17px] w-[17px] text-white" />
            </span>
            <span className="text-[17px] font-bold tracking-tight text-white">
              Clip<span className="text-gradient">Loop</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/upload')}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-black shadow-lg transition hover:bg-white/90 active:scale-95"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </button>
        </div>

        {readyVideos.length > 0 ? (
          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            className="no-scrollbar h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain"
          >
            {readyVideos.map((video, index) => (
              <VideoCard
                key={video.id}
                video={video}
                muted={muted}
                active={index === activeIndex}
                shouldLoad={Math.abs(index - activeIndex) <= 1}
                onToggleMute={toggleMute}
                onToast={show}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            {loading ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-white/50" />
                <p className="mt-4 text-sm text-white/50">Loading your feed…</p>
              </>
            ) : error ? (
              <>
                <div className="grid h-14 w-14 place-items-center rounded-2xl border border-rose-400/20 bg-rose-500/10">
                  <RefreshCw className="h-6 w-6 text-rose-300" />
                </div>
                <h2 className="mt-5 text-lg font-semibold">Could not reach the API</h2>
                <p className="mt-2 max-w-[260px] text-sm leading-relaxed text-white/50">{error}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-6 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90"
                >
                  Try again
                </button>
              </>
            ) : currentPending ? (
              <>
                <div className="relative grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
                  <Loader2 className="h-7 w-7 animate-spin text-cyan-300" />
                  <span className="absolute inset-0 rounded-full bg-cyan-400/10 blur-xl" />
                </div>
                <h2 className="mt-5 text-lg font-semibold">
                  {currentPending.status === 'queued' ? 'Waiting for an encoder' : 'Preparing your clip'}
                </h2>
                <p className="mt-2 text-sm text-white/50">
                  Creating adaptive renditions up to full resolution.
                </p>
                <div className="mt-5 h-1.5 w-52 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-accent transition-[width] duration-500"
                    style={{ width: `${Math.max(4, pendingPercent)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs tabular-nums text-white/40">
                  {currentPending.status === 'queued' ? 'Queued' : `${pendingPercent}%`}
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/upload')}
                  className="mt-6 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  View uploads
                </button>
              </>
            ) : (
              <>
                <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
                  <Clapperboard className="h-7 w-7 text-white/50" />
                </div>
                <h2 className="mt-5 text-xl font-bold">Your feed is empty</h2>
                <p className="mt-2 max-w-[250px] text-sm leading-relaxed text-white/50">
                  Upload a video and ClipLoop will create adaptive HLS renditions for it, topped with a
                  full-resolution stream.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/upload')}
                  className="mt-7 inline-flex items-center gap-2 rounded-full bg-gradient-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:opacity-95 active:scale-95"
                >
                  <Upload className="h-4 w-4" />
                  Upload a video
                </button>
              </>
            )}
          </div>
        )}

        {hasPending && readyVideos.length > 0 && (
          <button
            type="button"
            onClick={() => navigate('/upload')}
            className="absolute left-1/2 top-[4.5rem] z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3.5 py-2 text-[11px] font-medium text-white/85 shadow-xl backdrop-blur-md transition hover:bg-black/75"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />
            {pendingVideos.length} {pendingVideos.length === 1 ? 'video' : 'videos'} processing
          </button>
        )}

        {message && (
          <div className="animate-toast absolute bottom-24 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-xs font-semibold text-black shadow-2xl">
            {message}
          </div>
        )}
      </div>
    </div>
  )
}
