import { native } from './native'
import { parsePairLink } from '../../../extension/lib/envelope.mjs'
import { pairWithEngine, parseEnginePairLink } from './engine'

/** A computer or server this phone is paired with. `engine` lets the app list and start jobs; `send` is the end-to-end encrypted link channel. */
export interface Host {
  id: string
  name: string
  engine?: { baseUrl: string; token: string }
  send?: { link: string }
}

const KEY = 'hosts.v1'
let cache: Host[] | null = null

export async function loadHosts(): Promise<Host[]> {
  if (cache) return cache
  try {
    const { value } = await native.secureGet({ key: KEY })
    const list = value ? JSON.parse(value) : []
    cache = Array.isArray(list) ? list : []
  } catch {
    cache = []
  }
  return cache!
}

async function save(list: Host[]): Promise<Host[]> {
  cache = list
  await native.secureSet({ key: KEY, value: JSON.stringify(list) })
  return list
}

/** Pairs from either kind of link and returns the updated list. A second link for the same computer joins the first. */
export async function addHostFromLink(text: string, deviceName: string): Promise<{ hosts: Host[]; added: Host }> {
  const list = [...(await loadHosts())]
  const engineLink = parseEnginePairLink(text)
  const sendLink = engineLink ? null : parsePairLink(text)
  if (!engineLink && !sendLink) throw new Error("That is not a pair link from OPNduck.")
  const name = (engineLink?.name || sendLink?.name || 'My computer').slice(0, 60)
  let host = list.find((h) => h.name === name)
  if (!host) {
    host = { id: crypto.randomUUID(), name }
    list.push(host)
  }
  if (engineLink) {
    const { deviceToken } = await pairWithEngine(engineLink.baseUrl, engineLink.code, deviceName)
    host.engine = { baseUrl: engineLink.baseUrl, token: deviceToken }
  } else if (sendLink) host.send = { link: text.trim() }
  return { hosts: await save(list), added: host }
}

export async function removeHost(id: string): Promise<Host[]> {
  return save((await loadHosts()).filter((h) => h.id !== id))
}

export const DEVICE_NAME_KEY = 'device-name'
