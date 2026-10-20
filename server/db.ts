import { DatabaseSync } from 'node:sqlite'
import { DB_PATH, ensureStorage } from './paths.ts'

ensureStorage()

export type VideoStatus = 'queued' | 'processing' | 'ready' | 'failed'

export interface VideoRow {
  id: string
  caption: string
  original_name: string
  original_path: string
  size: number
  duration: number | null
  width: number | null
  height: number | null
  poster_path: string | null
  hls_path: string | null
  status: VideoStatus
  progress: number
  error: string | null
  views: number
  created_at: number
}

const db = new DatabaseSync(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    caption TEXT NOT NULL DEFAULT '',
    original_name TEXT NOT NULL,
    original_path TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    duration REAL,
    width INTEGER,
    height INTEGER,
    poster_path TEXT,
    hls_path TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_videos_created ON videos (created_at DESC);
`)

export function createVideo(input: {
  id: string
  caption: string
  originalName: string
  originalPath: string
  size: number
}): VideoRow {
  const createdAt = Date.now()
  db.prepare(
    `INSERT INTO videos (id, caption, original_name, original_path, size, status, progress, views, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 0, 0, ?)`,
  ).run(input.id, input.caption, input.originalName, input.originalPath, input.size, createdAt)
  return getVideo(input.id)!
}

export function getVideo(id: string): VideoRow | undefined {
  return db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as VideoRow | undefined
}

export function listVideos(): VideoRow[] {
  return db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all() as unknown as VideoRow[]
}

export function listQueuedVideoIds(): string[] {
  const rows = db
    .prepare("SELECT id FROM videos WHERE status IN ('queued', 'processing') ORDER BY created_at ASC")
    .all() as unknown as Array<{ id: string }>
  return rows.map((row) => row.id)
}

type Updatable = Pick<
  VideoRow,
  | 'status'
  | 'progress'
  | 'error'
  | 'duration'
  | 'width'
  | 'height'
  | 'poster_path'
  | 'hls_path'
>

export function updateVideo(id: string, patch: Partial<Updatable>): void {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ')
  const values = entries.map(([, value]) => value)
  db.prepare(`UPDATE videos SET ${assignments} WHERE id = ?`).run(...(values as never[]), id)
}

export function deleteVideoRow(id: string): void {
  db.prepare('DELETE FROM videos WHERE id = ?').run(id)
}

export function incrementViews(id: string): number {
  db.prepare('UPDATE videos SET views = views + 1 WHERE id = ?').run(id)
  const row = db.prepare('SELECT views FROM videos WHERE id = ?').get(id) as { views: number } | undefined
  return row?.views ?? 0
}

export function resetInterruptedJobs(): void {
  db.prepare("UPDATE videos SET status = 'queued', progress = 0 WHERE status = 'processing'").run()
}
