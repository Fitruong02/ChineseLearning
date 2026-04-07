import { startTransition, useEffect, useState } from 'react'
import { loadContentLibrary } from '../lib/content'
import type { ContentLibrary } from '../types'

interface UseContentLibraryState {
  status: 'loading' | 'ready' | 'error'
  library: ContentLibrary | null
  error: string | null
}

export const useContentLibrary = () => {
  const [state, setState] = useState<UseContentLibraryState>({
    status: 'loading',
    library: null,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    const hydrate = async () => {
      try {
        const library = await loadContentLibrary()

        if (cancelled) {
          return
        }

        startTransition(() => {
          setState({
            status: 'ready',
            library,
            error: null,
          })
        })
      } catch (error) {
        if (cancelled) {
          return
        }

        setState({
          status: 'error',
          library: null,
          error:
            error instanceof Error
              ? error.message
              : 'Không tải được dữ liệu nội dung.',
        })
      }
    }

    hydrate()

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
