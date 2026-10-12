import { useEffect, useState } from 'react'
import type { SchemaMatch } from '@shared/types'
import { api } from '@/lib/api'
import { useStore } from '@/store'

const NONE: SchemaMatch[] = []

/**
 * Tables and columns related to a phrase by meaning, from the local index of the current connection.
 * Empty until an index has been built, and while the phrase is too short to mean anything.
 */
export function useSemanticMatches(phrase: string, active: boolean): SchemaMatch[] {
  const connectionId = useStore((s) => s.activeConnectionId)
  const indexed = useStore((s) => s.ai?.configured === true && s.ai.index.state === 'ready')
  const [found, setFound] = useState<{ phrase: string; matches: SchemaMatch[] }>({ phrase: '', matches: NONE })
  const term = phrase.trim()
  const wanted = active && indexed && term.length >= 3

  useEffect(() => {
    if (!wanted) return
    let cancelled = false
    // Wait for a pause in typing: each search is a call to the embedding endpoint.
    const timer = setTimeout(() => {
      api.aiSearch(connectionId, term)
        .then((result) => { if (!cancelled) setFound({ phrase: term, matches: result.semantic ? result.matches : NONE }) })
        .catch(() => { if (!cancelled) setFound({ phrase: term, matches: NONE }) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [wanted, connectionId, term])

  return wanted && found.phrase === term ? found.matches : NONE
}
