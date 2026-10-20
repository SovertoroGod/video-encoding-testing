import { useCallback, useEffect, useState } from 'react'
import { Feed } from './components/Feed.tsx'
import { UploadPage } from './components/UploadPage.tsx'

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((to: string) => {
    const url = new URL(to, window.location.origin)
    if (url.pathname === window.location.pathname && url.search === window.location.search) return
    window.history.pushState({}, '', url)
    setPath(url.pathname)
    window.scrollTo({ top: 0 })
  }, [])

  if (path === '/upload') return <UploadPage navigate={navigate} />
  return <Feed navigate={navigate} />
}
