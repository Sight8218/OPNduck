import { featureRegistry } from '../features/registry'

/**
 * Picks the xl column count (2 or 3) that leaves the most-filled last row,
 * so e.g. 5 cards become a 3+2 grid instead of a lone card orphaned alone
 * on its own row after a full row of 4. Ties (an evenly-divisible count,
 * like 6) prefer the wider column count.
 */
function bestColumnCount(n: number, max: number): number {
  let best = 2
  let bestFill = -1
  for (let c = 2; c <= Math.min(n, max); c++) {
    const remainder = n % c
    const lastRowFill = remainder === 0 ? 1 : remainder / c
    if (lastRowFill >= bestFill) {
      bestFill = lastRowFill
      best = c
    }
  }
  return best
}

/**
 * Home dashboard grid.
 * Renders one card per enabled feature in the registry and adapts the column
 * count to how many cards are present — a single card spans wide, several
 * cards flow into 2–3 columns, picked to keep the last row as full as
 * possible. Cards re-flow automatically as features/plugins are added or
 * removed ("adaptive" by construction).
 */
export default function AdaptiveCardGrid() {
  const features = featureRegistry.filter((f) => f.enabled)
  const count = features.length

  if (count === 0) {
    return (
      <div className="glass rounded-3xl p-8 text-center text-sm text-[var(--text-dim)]">
        No features installed yet. Install a tool or a community plugin to see cards here.
      </div>
    )
  }

  // Adaptive column layout based on card count — capped at 3 columns so
  // cards keep enough width for their controls (a 4th column was crowding
  // titles into wrapping onto two lines).
  const cols =
    count === 1
      ? 'grid-cols-1'
      : bestColumnCount(count, 3) === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'

  return (
    <div className={`grid gap-5 ${cols}`}>
      {features.map((feature, i) => {
        const Card = feature.render
        // A lone card gets extra breathing room (max-width so it doesn't stretch
        // awkwardly full-bleed).
        const wide = count === 1 ? 'xl:max-w-3xl xl:mx-auto' : ''
        return (
          <div
            key={feature.id}
            className={`pop-in ${wide}`}
            style={{ ['--pop-delay' as string]: `${i * 60}ms` }}
          >
            <Card feature={feature} />
          </div>
        )
      })}
    </div>
  )
}