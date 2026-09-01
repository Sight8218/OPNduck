import { featureRegistry } from '../features/registry'

/**
 * Home dashboard grid.
 * Renders one card per enabled feature in the registry and adapts the column
 * count to how many cards are present — a single card spans wide, several
 * cards flow into 2–3 columns. Cards re-flow automatically as features/plugins
 * are added or removed ("adaptive" by construction).
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

  // Adaptive column layout based on card count.
  const cols =
    count === 1
      ? 'grid-cols-1'
      : count === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : count <= 4
          ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
          : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'

  return (
    <div className={`grid gap-5 ${cols}`}>
      {features.map((feature) => {
        const Card = feature.render
        // A lone card gets extra breathing room (max-width so it doesn't stretch
        // awkwardly full-bleed).
        const wide = count === 1 ? 'xl:max-w-3xl xl:mx-auto' : ''
        return (
          <div key={feature.id} className={wide}>
            <Card feature={feature} />
          </div>
        )
      })}
    </div>
  )
}