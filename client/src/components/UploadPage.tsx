import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleAlert,
  CloudUpload,
  Eye,
  Film,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../hooks/useToast.ts'
import {
  MAX_UPLOAD_MB,
  deleteVideo,
  fetchVideos,
  retryVideo,
  uploadVideo,
} from '../lib/api.ts'
import { formatBytes, formatCount, formatDuration, timeAgo } from '../lib/format.ts'
import type { Video } from '../types.ts'

interface UploadPageProps {
  navigate: (path: string) => void
}

function validateFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `That file is ${formatBytes(file.size)}. The limit is ${MAX_UPLOAD_MB} MB.`
  }
  const videoMime = file.type.startsWith('video/')
  const videoExt = /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i.test(file.name)
  if (!videoMime && !videoExt) {
    return 'That does not look like a video. Use MP4, MOV, WebM or MKV.'
  }
  return null
}

function StatusBadge({ video }: { video: Video }) {
  if (video.status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
        <Check className="h-3 w-3" /> Ready
      </span>
    )
  }
  if (video.status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
        <Loader2 className="h-3 w-3 animate-spin" /> {video.progress}%
      </span>
    )
  }
  if (video.status === 'queued') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
        <Loader2 className="h-3 w-3 animate-spin" /> Queued
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-400/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
      <CircleAlert className="h-3 w-3" /> Failed
    </span>
  )
}

export function UploadPage({ navigate }: UploadPageProps) {
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [dragging, setDragging] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const { message, show } = useToast()

  const loadVideos = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const next = await fetchVideos()
      setVideos(next)
      setLoadError(null)
    } catch (error) {
      if (!silent) {
        setLoadError(error instanceof Error ? error.message : 'Could not load your videos')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadVideos()
  }, [loadVideos])

  const hasPending = videos.some(
    (video) => video.status === 'queued' || video.status === 'processing',
  )

  useEffect(() => {
    if (!hasPending) return
    const timer = window.setInterval(() => void loadVideos(true), 1500)
    return () => window.clearInterval(timer)
  }, [hasPending, loadVideos])

  const selected = videos.find((video) => video.id === selectedId) ?? null

  const pickFile = (next: File | undefined) => {
    if (!next) return
    const validation = validateFile(next)
    if (validation) {
      setFormError(validation)
      return
    }
    setFormError(null)
    setFile(next)
    setSelectedId(null)
  }

  const handleSubmit = async () => {
    if (!file || uploading) return
    setUploading(true)
    setUploadProgress(0)
    setFormError(null)

    try {
      const video = await uploadVideo(file, caption.trim(), setUploadProgress)
      setSelectedId(video.id)
      setFile(null)
      setCaption('')
      setUploadProgress(0)
      if (inputRef.current) inputRef.current.value = ''
      await loadVideos(true)
      show('Upload complete — encoding started')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (video: Video) => {
    if (!window.confirm(`Delete "${video.caption || video.originalName}" and all its renditions?`)) {
      return
    }
    setBusyId(video.id)
    try {
      await deleteVideo(video.id)
      setVideos((current) => current.filter((item) => item.id !== video.id))
      if (selectedId === video.id) setSelectedId(null)
      show('Video deleted')
    } catch (error) {
      show(error instanceof Error ? error.message : 'Could not delete the video')
    } finally {
      setBusyId(null)
    }
  }

  const handleRetry = async (video: Video) => {
    setBusyId(video.id)
    try {
      await retryVideo(video.id)
      setSelectedId(video.id)
      await loadVideos(true)
      show('Retrying encode')
    } catch (error) {
      show(error instanceof Error ? error.message : 'Could not retry')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#09090b] text-white">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-gradient-to-b from-indigo-500/10 via-cyan-500/[0.04] to-transparent" />

      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#09090b]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-white/60 transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Feed
          </button>
          <span className="text-sm font-semibold text-white/80">New upload</span>
          <span className="w-14" />
        </div>
      </header>

      <main className="relative mx-auto max-w-2xl px-4 pb-24 pt-8 sm:pt-12">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80">
          <Sparkles className="h-3.5 w-3.5" />
          Adaptive streaming pipeline
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Drop a clip. Get a feed.</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-white/50">
          Your video is transcoded into adaptive HLS renditions up to full resolution, then plays in a
          TikTok-style vertical feed.
        </p>

        <div className="mt-6 grid grid-cols-3 gap-2">
          {[
            { icon: Upload, label: 'Upload' },
            { icon: Sparkles, label: 'Adaptive' },
            { icon: Play, label: 'Watch' },
          ].map(({ icon: Icon, label }, index) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-[10px] font-bold text-white/40">
                {index + 1}
              </span>
              <span className="truncate text-[11px] font-medium text-white/60">{label}</span>
              <Icon className="ml-auto hidden h-3.5 w-3.5 shrink-0 text-white/25 sm:block" />
            </div>
          ))}
        </div>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.025] p-4 shadow-2xl shadow-black/40 sm:p-6">
          <div
            role="button"
            tabIndex={0}
            onClick={() => !uploading && inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (!uploading) inputRef.current?.click()
              }
            }}
            onDragOver={(event) => {
              event.preventDefault()
              if (!uploading) setDragging(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setDragging(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              if (!uploading) pickFile(event.dataTransfer.files?.[0])
            }}
            className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-9 text-center outline-none transition ${
              dragging
                ? 'border-cyan-400/70 bg-cyan-400/[0.08]'
                : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.03]'
            } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/*"
              className="hidden"
              onChange={(event) => pickFile(event.target.files?.[0])}
            />

            {file ? (
              <>
                <div className="grid h-12 w-12 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-400/10">
                  <Film className="h-5 w-5 text-cyan-300" />
                </div>
                <p className="mt-3 max-w-full truncate px-4 text-sm font-semibold text-white">
                  {file.name}
                </p>
                <p className="mt-1 text-xs text-white/40">{formatBytes(file.size)} · click to replace</p>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setFile(null)
                    if (inputRef.current) inputRef.current.value = ''
                  }}
                  className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-black/40 text-white/60 transition hover:bg-black/70 hover:text-white"
                  aria-label="Remove selected file"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <div className="grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
                  <CloudUpload className="h-5 w-5 text-white/60" />
                </div>
                <p className="mt-3 text-sm font-semibold text-white">
                  Drag &amp; drop a video, or click to browse
                </p>
                <p className="mt-1 text-xs text-white/40">
                  MP4, MOV, WebM or MKV · up to {MAX_UPLOAD_MB} MB
                </p>
              </>
            )}
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="caption" className="text-xs font-medium text-white/60">
                Caption
              </label>
              <span className="text-[10px] tabular-nums text-white/30">{caption.length}/280</span>
            </div>
            <input
              id="caption"
              value={caption}
              maxLength={280}
              disabled={uploading}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Say something about this clip…"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/10 disabled:opacity-50"
            />
          </div>

          {formError && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2.5 text-xs leading-relaxed text-rose-200">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {formError}
            </div>
          )}

          <button
            type="button"
            disabled={!file || uploading}
            onClick={() => void handleSubmit()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-accent px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:opacity-95 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-35"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading {uploadProgress}%
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload &amp; encode
              </>
            )}
          </button>

          {uploading && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-gradient-accent transition-[width] duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
        </section>

        {selected && (
          <section className="animate-rise mt-5 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]">
            <div className="flex gap-4 p-4 sm:p-5">
              <div className="relative h-24 w-[72px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black">
                {selected.posterUrl ? (
                  <img
                    src={selected.posterUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center">
                    <Film className="h-5 w-5 text-white/25" />
                  </div>
                )}
                {selected.status !== 'ready' && (
                  <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[1px]">
                    {selected.status === 'failed' ? (
                      <CircleAlert className="h-5 w-5 text-rose-300" />
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
                    )}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusBadge video={selected} />
                  <span className="truncate text-[11px] text-white/35">
                    {timeAgo(selected.createdAt)}
                  </span>
                </div>
                <p className="mt-1.5 truncate text-sm font-semibold text-white">
                  {selected.caption || selected.originalName}
                </p>

                {selected.status === 'ready' ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] text-white/45">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      240p · 360p · 720p · 1080p · Full ready
                    </span>
                    {selected.duration && (
                      <span className="text-[11px] text-white/35">
                        {formatDuration(selected.duration)}
                      </span>
                    )}
                  </div>
                ) : selected.status === 'failed' ? (
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-rose-300/90">
                    {selected.error || 'Encoding failed'}
                  </p>
                ) : (
                  <>
                    <p className="mt-1.5 text-[11px] text-white/40">
                      {selected.status === 'queued'
                        ? 'Waiting for an encoder…'
                        : 'Creating adaptive renditions…'}
                    </p>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full bg-gradient-accent transition-[width] duration-500"
                        style={{ width: `${Math.max(3, selected.progress)}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {selected.status === 'ready' && (
              <button
                type="button"
                onClick={() => navigate(`/?v=${selected.id}`)}
                className="flex w-full items-center justify-center gap-2 border-t border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.07]"
              >
                <Play className="h-4 w-4" fill="currentColor" />
                Watch in feed
              </button>
            )}
            {selected.status === 'failed' && (
              <button
                type="button"
                disabled={busyId === selected.id}
                onClick={() => void handleRetry(selected)}
                className="flex w-full items-center justify-center gap-2 border-t border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.07] disabled:opacity-50"
              >
                {busyId === selected.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Retry encoding
              </button>
            )}
          </section>
        )}

        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">Your library</h2>
            <span className="text-[11px] text-white/30">
              {videos.length} {videos.length === 1 ? 'video' : 'videos'}
            </span>
          </div>

          {loadError && (
            <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-xs text-rose-200">
              {loadError}
            </div>
          )}

          {loading ? (
            <div className="mt-4 flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] py-12">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : videos.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-6 py-10 text-center">
              <Film className="mx-auto h-6 w-6 text-white/25" />
              <p className="mt-3 text-sm text-white/45">Nothing here yet. Upload your first clip above.</p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
              {videos.map((video) => (
                <li key={video.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                  <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black">
                    {video.posterUrl ? (
                      <img src={video.posterUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center">
                        <Film className="h-4 w-4 text-white/20" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-white/90">
                        {video.caption || video.originalName}
                      </p>
                      <span className="shrink-0">
                        <StatusBadge video={video} />
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-white/35">
                      <span>{timeAgo(video.createdAt)}</span>
                      {video.duration && <span>{formatDuration(video.duration)}</span>}
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {formatCount(video.views)}
                      </span>
                      <span>{formatBytes(video.size)}</span>
                    </div>
                    {video.status === 'processing' && (
                      <div className="mt-1.5 h-0.5 w-full max-w-40 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full bg-gradient-accent transition-[width] duration-500"
                          style={{ width: `${Math.max(2, video.progress)}%` }}
                        />
                      </div>
                    )}
                    {video.status === 'failed' && video.error && (
                      <p className="mt-1 line-clamp-1 text-[10px] text-rose-300/80">{video.error}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {video.status === 'ready' && (
                      <button
                        type="button"
                        onClick={() => navigate(`/?v=${video.id}`)}
                        className="grid h-8 w-8 place-items-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white"
                        aria-label="Watch video"
                      >
                        <Play className="h-4 w-4" fill="currentColor" />
                      </button>
                    )}
                    {video.status === 'failed' && (
                      <button
                        type="button"
                        disabled={busyId === video.id}
                        onClick={() => void handleRetry(video)}
                        className="grid h-8 w-8 place-items-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                        aria-label="Retry encoding"
                      >
                        {busyId === video.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === video.id || video.status === 'processing'}
                      onClick={() => void handleDelete(video)}
                      className="grid h-8 w-8 place-items-center rounded-full text-white/35 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-25"
                      aria-label="Delete video"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-8 text-center text-[11px] leading-relaxed text-white/25">
          Uploads are stored locally. Each ready video keeps its original file plus adaptive HLS
          renditions (240p / 360p / 720p / 1080p and full resolution) up to the source quality.
        </p>
      </main>

      {message && (
        <div className="animate-toast fixed bottom-6 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-xs font-semibold text-black shadow-2xl">
          {message}
        </div>
      )}
    </div>
  )
}
