import { useSearchParams } from 'react-router-dom'
import { useFeatures } from '../features/useFeatures'
import { FeatureIcon } from './featureIcons'
import PluginFrame from '../features/PluginFrame'
import { useSelectorPlugin } from '../features/selectorStore'

/**
 * Home launcher. Every enabled feature in the registry gets a small tile (icon, title,
 * tagline); picking one opens just that tool's card underneath, so the page shows one set of
 * controls at a time instead of eight. The open tool lives in the URL (`?tool=<id>`), so the
 * command palette can link straight to it. Plugins show up as tiles automatically.
 */
export default function AdaptiveCardGrid() {
  const [params, setParams] = useSearchParams()
  const features = useFeatures().filter((f) => f.enabled)
  const selector = useSelectorPlugin()

  if (features.length === 0) {
    return (
      <div className="glass rounded-3xl p-8 text-center text-sm text-[var(--text-dim)]">
        No features installed yet. Install a tool or a community plugin to see cards here.
      </div>
    )
  }

  const openId = params.get('tool')
  const open = features.find((f) => f.id === openId) ?? null
  const choose = (id: string | null) => setParams(id ? { tool: id } : {}, { replace: true })

  return (
    <div className="flex flex-col gap-6">
      {selector ? (
        <PluginFrame
          key={`${selector.pluginId}-${selector.version}`}
          pluginId={selector.pluginId}
          version={selector.version}
          entry={selector.entry}
          feature={{ id: selector.pluginId, title: selector.name, tagline: '', description: '', scope: 'universal', icon: '', enabled: true, render: () => null, source: 'plugin' }}
          app={{ features, selected: openId, onSelect: choose }}
        />
      ) : (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {features.map((f, i) => {
          const active = f.id === open?.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => choose(active ? null : f.id)}
              aria-pressed={active}
              className={`glass tile-glow-hover pop-in flex items-center gap-3 rounded-2xl p-3 text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 ${
                active ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]' : ''
              }`}
              style={{ ['--pop-delay' as string]: `${i * 40}ms` }}
            >
              <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <FeatureIcon name={f.icon} size={20} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold leading-tight">{f.title}</span>
                <span className="block truncate text-xs text-[var(--text-dim)]">{f.tagline}</span>
              </span>
            </button>
          )
        })}
      </div>
      )}

      {open ? (
        <div key={open.id} className="pop-in mx-auto w-full max-w-3xl">
          <open.render feature={open} />
        </div>
      ) : (
        <p className="text-center text-sm text-[var(--text-dim)]">Pick a tool above.</p>
      )}
    </div>
  )
}
