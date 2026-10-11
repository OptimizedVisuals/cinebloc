import { useEffect, useState } from 'react'
import { getServices } from '@/state/services'

/**
 * Blob → object URL with proper revocation (claim 2): no leaks when rows
 * recycle while scrolling the mobile list, and fully offline (no network).
 */
export function useAssetUrl(key: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!key) {
      setUrl(null)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false

    void (async () => {
      try {
        const blob = await getServices().storage.getBlob(key)
        if (cancelled) return
        if (blob) {
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        } else {
          setUrl(null)
        }
      } catch (cause) {
        console.error('asset load failed', cause)
        if (!cancelled) setUrl(null)
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [key])

  return url
}
