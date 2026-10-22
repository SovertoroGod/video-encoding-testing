import fs from 'node:fs'
import { getVideo, listVideos } from '../server/db.ts'
import { processVideo } from '../server/transcode.ts'

/**
 * Re-runs the transcode pipeline over stored videos.
 *
 * Useful after the encoding ladder changed (e.g. the move to a full-resolution
 * top rendition + 1080p). Originals are retained after successful encodes, so
 * every ready/failed video can simply be processed again.
 */
async function main(): Promise<void> {
  const videos = listVideos()
  const targets = videos.filter((video) => Boolean(video.original_path) && fs.existsSync(video.original_path))

  if (targets.length === 0) {
    console.log('Nothing to re-encode — no videos with an existing original file.')
    return
  }

  for (const video of targets) {
    console.log(`[reencode] ${video.id} (${video.original_name})…`)
    await processVideo(video.id)
    const row = getVideo(video.id)
    console.log(`[reencode] ${video.id} → ${row?.status ?? 'unknown'}`)
  }

  console.log('\nDone. Re-encoded renditions are picked up on the next feed / library load.')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
