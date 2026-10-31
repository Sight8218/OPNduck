import * as React from 'react'
import { host, type PluginSummary } from '../host'
import PluginCardHost, { type PluginApi, type PluginCardComponent } from './PluginCardHost'
import { featureRegistry, registerFeatures, unregisterFeature, type FeatureDefinition } from './registry'

declare global {
  interface Window {
    /** What a plugin card reads: the host's own React (a second copy would break hooks). */
    OPNduck?: { readonly React: typeof React }
  }
}

/** The card-safe API for one plugin; every call carries that plugin's id into the host's permission checks. */
function makeApi(id: string): PluginApi {
  const call = (method: string, ...args: unknown[]) => host.plugins!.call(id, method, args)
  return {
    jobs: {
      start: (tool, args) => call('jobs.start', tool, args) as Promise<string>,
      list: () => call('jobs.list') as Promise<unknown[]>,
      cancel: (jobId) => call('jobs.cancel', jobId) as Promise<void>,
    },
    files: { pick: (opts) => call('files.pick', opts ?? {}) as Promise<string | null> },
    settings: { get: (key) => call('settings.get', key), set: (key, value) => call('settings.set', key, value) as Promise<void> },
    notify: (opts) => call('notify', opts) as Promise<void>,
    rpc: { call: (name, arg) => call('rpc.call', name, arg) },
  }
}

function definitionFor(p: PluginSummary, card: PluginCardComponent): FeatureDefinition {
  const m = p.manifest!
  const api = makeApi(p.id)
  const def: FeatureDefinition = {
    id: p.id,
    title: m.name,
    tagline: m.tagline ?? '',
    description: m.description,
    scope: m.scope ?? 'universal',
    icon: m.icon ?? '★',
    accent: m.accent,
    enabled: true,
    render: ({ feature }) => <PluginCardHost feature={feature} card={card} api={api} />,
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
  const wanted = list.filter((p) => p.status === 'running' && p.manifest?.ui)
  for (const f of [...featureRegistry]) {
    if (f.source === 'plugin' && !wanted.some((p) => p.id === f.id)) {
      unregisterFeature(f.id)
      loadedVersion.delete(f.id)
    }
  }
  for (const p of wanted) {
    const m = p.manifest!
    if (loadedVersion.get(p.id) === m.version && featureRegistry.some((f) => f.id === p.id)) continue
    try {
      // The host serves this URL from the plugin's own folder (opnduck-plugin:// in electron/main.cjs).
      const mod = (await import(/* @vite-ignore */ `opnduck-plugin://${p.id}/${m.ui!.entry}?v=${encodeURIComponent(m.version)}-${Date.now()}`)) as { default?: unknown }
      if (typeof mod.default !== 'function') throw new Error('the UI entry must default-export a component')
      unregisterFeature(p.id)
      registerFeatures([definitionFor(p, mod.default as PluginCardComponent)])
      loadedVersion.set(p.id, m.version)
    } catch (err) {
      console.error(`[plugin ${p.id}] could not load its card:`, err)
    }
  }
}

/** Called once at startup (desktop only): exposes `window.OPNduck`, loads running plugins, and follows changes. */
export function startPluginLoader(): void {
  if (!host.plugins || window.OPNduck) return
  Object.defineProperty(window, 'OPNduck', { value: Object.freeze({ React }), enumerable: true })
  void syncPlugins()
  host.plugins.onChanged(() => void syncPlugins())
}
