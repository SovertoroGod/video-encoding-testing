import { TRANSCODE_CONCURRENCY } from './paths.ts'
import { processVideo } from './transcode.ts'

const queue: string[] = []
const pending = new Set<string>()
let running = 0

export function enqueueVideo(id: string): void {
  if (pending.has(id)) return
  pending.add(id)
  queue.push(id)
  pump()
}

function pump(): void {
  while (running < TRANSCODE_CONCURRENCY && queue.length > 0) {
    const id = queue.shift()!
    pending.delete(id)
    running += 1
    void processVideo(id)
      .catch((error) => {
        console.error(`[queue] unexpected failure for ${id}:`, error)
      })
      .finally(() => {
        running -= 1
        pump()
      })
  }
}

export function queueStats(): { running: number; waiting: number } {
  return { running, waiting: queue.length }
}
