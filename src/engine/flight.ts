const PUSH = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
const DEHYDRATED = '{"dehydratedAt":'

/** Concatenates the string chunks Next.js streams through `self.__next_f.push([1, "..."])`. */
export function readFlightPayload(html: string): string {
  let payload = ''
  for (const match of html.matchAll(PUSH)) payload += JSON.parse(match[1]!) as string
  return payload
}

function balancedObjectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  return -1
}

/** Finds the dehydrated React Query entry whose `queryKey[0]` equals `key`. */
export function findDehydratedQuery(payload: string, key: string): unknown {
  const marker = `"queryKey":[${JSON.stringify(key)}`
  let from = payload.indexOf(DEHYDRATED)
  while (from >= 0) {
    const end = balancedObjectEnd(payload, from)
    if (end < 0) return undefined
    const raw = payload.slice(from, end)
    if (raw.includes(marker)) return JSON.parse(raw)
    from = payload.indexOf(DEHYDRATED, end)
  }
  return undefined
}
