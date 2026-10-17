/**
 * Starts one job per item and returns the ids of the ones that actually started. Uses
 * allSettled so a single failed start doesn't make the card lose track of the others
 * (which are already running by then).
 */
export async function startBatch<T>(items: T[], start: (item: T) => Promise<string>): Promise<string[]> {
  const results = await Promise.allSettled(items.map(start))
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
}
