import type { BatchInfo } from '../host'

/**
 * Starts one job per item and returns the ids of the ones that actually started. Uses
 * allSettled so a single failed start doesn't make the card lose track of the others (which are
 * already running by then). When there are 2+ items they share a `BatchInfo`, so the Library can
 * show them as one group ("5 files — Convert to WEBM").
 */
export async function startBatch<T>(
  items: T[],
  label: string,
  start: (item: T, batch: BatchInfo | undefined) => Promise<string>,
): Promise<string[]> {
  const batch = items.length > 1 ? { id: crypto.randomUUID(), label: `${items.length} files — ${label}`, size: items.length } : undefined
  const results = await Promise.allSettled(items.map((item) => start(item, batch)))
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
}
