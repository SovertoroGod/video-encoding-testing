import type { Video } from '../types.ts'

export const MAX_UPLOAD_MB = 300

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function fetchVideos(): Promise<Video[]> {
  const data = await request<{ videos: Video[] }>('/api/videos')
  return data.videos
}

export async function fetchVideo(id: string): Promise<Video> {
  const data = await request<{ video: Video }>(`/api/videos/${id}`)
  return data.video
}

export async function deleteVideo(id: string): Promise<void> {
  await request<void>(`/api/videos/${id}`, { method: 'DELETE' })
}

export async function retryVideo(id: string): Promise<Video> {
  const data = await request<{ video: Video }>(`/api/videos/${id}/retry`, { method: 'POST' })
  return data.video
}

export async function trackView(id: string): Promise<void> {
  try {
    await request<{ views: number }>(`/api/videos/${id}/view`, { method: 'POST' })
  } catch {
    // view counts are non-critical
  }
}

export function uploadVideo(
  file: File,
  caption: string,
  onProgress: (percent: number) => void,
): Promise<Video> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/videos')
    xhr.responseType = 'text'

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
      }
    }

    xhr.onload = () => {
      let body: { video?: Video; error?: string } | null = null
      try {
        body = JSON.parse(xhr.responseText) as { video?: Video; error?: string }
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.video) {
        onProgress(100)
        resolve(body.video)
      } else {
        reject(new Error(body?.error || `Upload failed (${xhr.status})`))
      }
    }

    xhr.onerror = () => reject(new Error('Network error while uploading. Is the API running?'))
    xhr.onabort = () => reject(new Error('Upload cancelled'))

    const form = new FormData()
    form.append('caption', caption)
    form.append('video', file)
    xhr.send(form)
  })
}
