import { useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useFeatures } from '../features/useFeatures'
import { FeatureIcon } from './featureIcons'
import PluginFrame from '../features/PluginFrame'
import { useSlotPlugin } from '../features/selectorStore'

/**
 * Home launcher. Every enabled feature in the registry gets a small tile (icon, title,
 * tagline); picking one opens just that tool's card underneath, so the page shows one set of
 * controls at a time instead of eight. The open tool lives in the URL (`?tool=<id>`), so the
 * command palette can link straight to it. Plugins show up as tiles automatically.
 */
export default function AdaptiveCardGrid() {
  const [params, setParams] = useSearchParams()
  const features = useFeatures().filter((f) => f.enabled)
  const selector = useSlotPlugin('selector')
  const stage = useSlotPlugin('stage')
  const cardBox = useRef<HTMLDivElement>(null)
  // A stage plugin fades the real tool card in once its wheel has settled; set on the element, no re-render per frame.
  const setCardOpacity = useCallback((o: number) => {
    const el = cardBox.current
    if (!el) return
    el.style.opacity = String(o)
    el.style.pointerEvents = o > 0.95 ? 'auto' : 'none'
  }, [])

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

  // While a tool is open the tiles shrink to a one-line strip, so the tool itself is in view instead of below the fold.
  const compact = !!open

  return (
    <div className={`flex flex-col ${compact ? 'gap-3' : 'gap-6'}`}>
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
      <div className={compact ? 'grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'}>
        {features.map((f, i) => {
          const active = f.id === open?.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => choose(active ? null : f.id)}
              aria-pressed={active}
              title={compact ? `${f.title}: ${f.tagline}` : undefined}
              className={`glass tile-glow-hover pop-in flex items-center text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 ${
                compact ? 'gap-2 rounded-xl px-2 py-1' : 'gap-3 rounded-2xl p-3'
              } ${
                active ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]' : ''
              }`}
              style={{ ['--pop-delay' as string]: `${i * 40}ms` }}
            >
              <span className={`glass flex shrink-0 items-center justify-center rounded-xl ${compact ? 'h-6 w-6' : 'h-10 w-10'}`}>
                <FeatureIcon name={f.icon} size={compact ? 14 : 20} />
              </span>
              <span className="min-w-0">
                <span className={`block truncate font-bold leading-tight ${compact ? 'text-xs' : 'text-sm'}`}>{f.title}</span>
                {!compact && <span className="block truncate text-xs text-[var(--text-dim)]">{f.tagline}</span>}
              </span>
            </button>
          )
        })}
      </div>
      )}

      {stage ? (
        <div className="relative min-h-[560px]">
          <PluginFrame
            key={`${stage.pluginId}-${stage.version}`}
            pluginId={stage.pluginId}
            version={stage.version}
            entry={stage.entry}
            feature={{ id: stage.pluginId, title: stage.name, tagline: '', description: '', scope: 'universal', icon: '', enabled: true, render: () => null, source: 'plugin' }}
            app={{ features, selected: openId, onSelect: choose }}
            fill
            onCardOpacity={setCardOpacity}
          />
          {open ? (
            <div key={open.id} ref={cardBox} className="relative z-10 mx-auto w-full max-w-3xl" style={{ opacity: 0, pointerEvents: 'none' }}>
              <open.render feature={open} />
            </div>
          ) : null}
        </div>
      ) : open ? (

        <div key={open.id} className={`pop-in mx-auto w-full ${open.id === 'gif' ? 'max-w-6xl' : 'max-w-3xl'}`}>
          <open.render feature={open} />
        </div>
      ) : (
        <p className="text-center text-sm text-[var(--text-dim)]">Pick a tool above.</p>
      )}
    </div>
  )
}
