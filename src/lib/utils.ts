import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const uid = () => crypto.randomUUID()

export function timeAgo(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return new Date(at).toLocaleDateString()
}

/** Every space-separated term must appear somewhere in the text. */
export function matches(text: string, search: string): boolean {
  const haystack = text.toLowerCase()
  return search.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term))
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
export const kbd = (key: string) => `${isMac ? '⌘' : 'Ctrl '}${key}`
