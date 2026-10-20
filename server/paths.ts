import fs from 'node:fs'
import path from 'node:path'

export const ROOT_DIR = process.cwd()

function resolveDir(value: string | undefined, fallback: string): string {
  return value ? path.resolve(value) : path.join(ROOT_DIR, fallback)
}

export const STORAGE_DIR = resolveDir(process.env.STORAGE_DIR, 'storage')
export const UPLOAD_DIR = path.join(STORAGE_DIR, 'uploads')
export const VIDEO_DIR = path.join(STORAGE_DIR, 'videos')
export const DATA_DIR = resolveDir(process.env.DATA_DIR, 'data')
export const DB_PATH = path.join(DATA_DIR, 'app.db')
export const DIST_DIR = path.join(ROOT_DIR, 'dist')

export const PORT = Number(process.env.PORT || 8787)
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 300)
export const TRANSCODE_CONCURRENCY = Math.max(1, Number(process.env.TRANSCODE_CONCURRENCY || 1))

export function ensureStorage(): void {
  for (const dir of [STORAGE_DIR, UPLOAD_DIR, VIDEO_DIR, DATA_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function videoDir(id: string): string {
  return path.join(VIDEO_DIR, id)
}
