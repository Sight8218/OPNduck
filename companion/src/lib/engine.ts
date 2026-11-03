import type { Host } from './hosts'

export interface Task {
  id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled'
  progress: number
  label: string
  error?: string
  sizeBytes?: number | null
  createdAt?: number
  stage?: string | null
  host?: string
  /** False once the file is gone (a recipe's working files); nothing to download. */
  downloadable?: boolean
}

/** `opnduck://pair?u=<address>&c=<code>&n=<name>`, made by the server or by a desktop that shares its engine. */
export function parseEnginePairLink(text: string): { baseUrl: string; code: string; name: string } | null {
  try {
    const u = new URL(String(text).trim())
    if (u.protocol !== 'opnduck:' || u.hostname !== 'pair') return null
    const base = new URL(u.searchParams.get('u') ?? '')
    const code = u.searchParams.get('c') ?? ''
    if (!['http:', 'https:'].includes(base.protocol) || !/^[A-Za-z0-9_-]{16,64}$/.test(code)) return null
    return { baseUrl: base.origin, code, name: (u.searchParams.get('n') ?? '').slice(0, 60) }
  } catch {
    return null
  }
}

/**
 * Plain http is allowed only where the connection is already encrypted or never leaves the phone: this phone itself, a
 * Tailscale address (100.64.0.0/10 or *.ts.net). Anything else needs https. (Android must allow cleartext traffic in
 * general, so this check is what keeps a typo or a hostile link from sending the token over an open network.)
 */
export function transportAllowed(baseUrl: string): boolean {
  const u = new URL(baseUrl)
  if (u.protocol === 'https:') return true
  const h = u.hostname
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || /\.ts\.net$/i.test(h)) return true
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(h)
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127
}

async function request(baseUrl: string, method: string, path: string, token: string | null, body?: unknown, timeoutMs = 8000) {
  let res: Response
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new Error('Cannot reach your computer. Is OPNduck running, and is Tailscale on?')
  }
  const json = await res.json().catch(() => null)
  if (res.status === 401) throw new Error('This phone is no longer paired. Remove it here and pair again.')
  if (!res.ok) throw new Error(json?.error || `The server answered ${res.status}`)
  return json
}

export async function pairWithEngine(baseUrl: string, code: string, deviceName: string): Promise<{ deviceId: string; deviceToken: string }> {
  if (!transportAllowed(baseUrl)) throw new Error('That address uses plain http on your network, which is not encrypted. Use Tailscale or an https address.')
  try {
    return await request(baseUrl, 'POST', '/v1/pair', null, { code, deviceName, deviceKind: 'phone' }, 10000)
  } catch (e) {
    if (e instanceof Error && /no longer paired/.test(e.message)) throw new Error('The pairing code is wrong or older than 5 minutes. Make a new one.')
    throw e
  }
}

const call = (h: Host, method: string, path: string, body?: unknown) => {
  if (!h.engine) throw new Error('This computer is paired for sending links only.')
  return request(h.engine.baseUrl, method, path, h.engine.token, body)
}

export const engine = {
  health: (h: Host) => request(h.engine!.baseUrl, 'GET', '/v1/health', null, undefined, 3000),
  info: (h: Host) => call(h, 'GET', '/v1/info'),
  tasks: async (h: Host): Promise<Task[]> => (await call(h, 'GET', '/v1/tasks')).tasks,
  start: (h: Host, req: Record<string, unknown>) => call(h, 'POST', '/v1/tasks', { kind: 'download', req }) as Promise<{ id: string }>,
  /** Runs a saved recipe that starts from a link, such as the phone-friendly download. */
  startRecipe: (h: Host, recipeId: string, url: string) => call(h, 'POST', '/v1/tasks', { kind: 'recipe', req: { recipeId, url } }) as Promise<{ id: string }>,
  cancel: (h: Host, id: string) => call(h, 'POST', `/v1/tasks/${encodeURIComponent(id)}/cancel`),
  rerun: (h: Host, id: string) => call(h, 'POST', `/v1/tasks/${encodeURIComponent(id)}/rerun`),
  remove: (h: Host, id: string) => call(h, 'DELETE', `/v1/tasks/${encodeURIComponent(id)}`),
  /** A short-lived signed address for the finished file, safe to hand to the system downloader. */
  fileLink: async (h: Host, id: string): Promise<string> => h.engine!.baseUrl + (await call(h, 'POST', `/v1/files/${encodeURIComponent(id)}/link`)).url,
}
