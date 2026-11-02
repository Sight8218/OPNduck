import { host, type PluginSummary } from '../host'
import PluginFrame from './PluginFrame'
import { setSelectorPlugin } from './selectorStore'
import { featureRegistry, registerFeatures, unregisterFeature, type FeatureDefinition } from './registry'

function definitionFor(p: PluginSummary): FeatureDefinition {
  const m = p.manifest!
  const def: FeatureDefinition = {
    id: p.id,
    title: m.name,
    tagline: m.tagline ?? '',
    description: m.description,
    scope: m.scope ?? 'universal',
    icon: m.icon ?? '★',
    accent: m.accent,
    enabled: true,
    render: ({ feature }) => <PluginFrame key={`${p.id}-${m.version}`} pluginId={p.id} version={m.version} entry={m.ui!.entry} feature={feature} />,
    source: 'plugin',
  }
  return def
}

const loadedVersion = new Map<string, string>() // plugin id -> version whose script is registered
let queue: Promise<void> = Promise.resolve()

/** Makes the Home grid match the plugins that are running right now. Safe to call often; runs one at a time. */
export function syncPlugins(): Promise<void> {
  queue = queue.then(doSync, doSync)
  return queue
}

async function doSync(): Promise<void> {
  if (!host.plugins) return
  let list: PluginSummary[]
  try {
    list = await host.plugins.list()
  } catch (err) {
    console.error('plugins: could not list plugins', err)
    return
  }
  const running = list.filter((p) => p.status === 'running' && p.manifest?.ui)
  // A selector plugin replaces the tile row on Home instead of being a tile; the first one wins.
  const selector = running.find((p) => p.manifest!.ui!.slot === 'selector')
  setSelectorPlugin(selector ? { pluginId: selector.id, name: selector.manifest!.name, version: selector.manifest!.version, entry: selector.manifest!.ui!.entry } : null)
  const wanted = running.filter((p) => p.manifest!.ui!.slot !== 'selector')
  for (const f of [...featureRegistry]) {
    if (f.source === 'plugin' && !wanted.some((p) => p.id === f.id)) {
      unregisterFeature(f.id)
      loadedVersion.delete(f.id)
    }
  }
  for (const p of wanted) {
    const m = p.manifest!
    if (loadedVersion.get(p.id) === m.version && featureRegistry.some((f) => f.id === p.id)) continue
    unregisterFeature(p.id)
    registerFeatures([definitionFor(p)])
    loadedVersion.set(p.id, m.version)
  }
}

/** Called once at startup (desktop only): shows running plugins on Home and follows changes. A card's code runs in a sandboxed frame (PluginFrame), never in this window. */
export function startPluginLoader(): void {
  if (!host.plugins) return
  void syncPlugins()
  host.plugins.onChanged(() => void syncPlugins())
}
