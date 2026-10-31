import { Component, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import type { FeatureDefinition } from './registry'

/** What a plugin card receives next to `feature`: the card-safe host API, already bound to that plugin. */
export interface PluginApi {
  jobs: { start(tool: string, args: object): Promise<string>; list(): Promise<unknown[]>; cancel(id: string): Promise<void> }
  files: { pick(opts?: { save?: boolean; directory?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> }
  settings: { get(key: string): Promise<unknown>; set(key: string, value: string | number | boolean): Promise<void> }
  notify(opts: { title?: string; body: string }): Promise<void>
  rpc: { call(name: string, arg?: unknown): Promise<unknown> }
}

export type PluginCardComponent = ComponentType<{ feature: FeatureDefinition; api: PluginApi }>

interface Props {
  feature: FeatureDefinition
  card: PluginCardComponent
  api: PluginApi
}

/** A plugin card that throws must not take the Home page down with it. */
export default class PluginCardHost extends Component<Props, { error: string | null }> {
  state = { error: null as string | null }

  static getDerivedStateFromError(err: unknown): { error: string } {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  componentDidCatch(err: unknown, info: ErrorInfo): void {
    console.error(`[plugin ${this.props.feature.id}] card crashed:`, err, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="glass rounded-2xl p-4 text-sm text-[var(--text-dim)]" role="alert">
          <p className="font-semibold text-[var(--text)]">{this.props.feature.title} stopped working.</p>
          <p className="mt-1 break-words">{this.state.error}</p>
          <button type="button" className="glass-btn mt-3" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      )
    }
    const Card = this.props.card
    return <Card feature={this.props.feature} api={this.props.api} />
  }
}
