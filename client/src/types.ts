export type VideoStatus = 'queued' | 'processing' | 'ready' | 'failed'

export interface Video {
  id: string
  caption: string
  originalName: string
  size: number
  duration: number | null
  width: number | null
  height: number | null
  status: VideoStatus
  progress: number
  error: string | null
  views: number
  createdAt: number
  posterUrl: string | null
  playbackUrl: string | null
  variants: string[]
}
