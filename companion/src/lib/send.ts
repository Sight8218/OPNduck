import { firstUrl, sendLink as sendEncrypted } from '../../../extension/lib/envelope.mjs'
import { parsePairLink } from '../../../extension/lib/envelope.mjs'
import { engine } from './engine'
import type { Host } from './hosts'

export const PRESETS = [
  { id: 'smart', label: 'Best video (MP4)', req: { format: 'MP4', videoQuality: 'best' } },
  { id: '1080', label: 'MP4 1080p', req: { format: 'MP4', videoQuality: '1080' } },
  { id: '720', label: 'MP4 720p', req: { format: 'MP4', videoQuality: '720' } },
  { id: 'mp3', label: 'Audio (MP3)', req: { format: 'MP3', audioQuality: 'best' } },
] as const

export type PresetId = (typeof PRESETS)[number]['id']

/** The first link in a pasted or shared text, or null. */
export const linkIn = (text: string): string | null => firstUrl(text) || null

/**
 * Sends a link to a computer. Straight to its engine when it answers (so the format preset applies and the job shows in
 * the queue), otherwise through the encrypted channel (direct, then relay), where the computer picks the format.
 * Returns how it went, for the message under the button.
 */
export async function sendTo(host: Host, text: string, preset: PresetId, deviceName: string): Promise<{ via: 'engine' | 'direct' | 'relay'; id?: string }> {
  const url = linkIn(text)
  if (!url) throw new Error('There is no web link in that.')
  let engineError: Error | null = null
  if (host.engine) {
    try {
      const req = PRESETS.find((p) => p.id === preset)!.req
      const { id } = await engine.start(host, { url, ...req })
      return { via: 'engine', id }
    } catch (e) {
      engineError = e as Error
      if (!host.send) throw e
    }
  }
  if (!host.send) throw engineError ?? new Error('Pair this phone with a computer first.')
  const pair = parsePairLink(host.send.link)
  if (!pair) throw new Error('The saved send link is damaged. Pair again.')
  const how = await sendEncrypted(pair, url, deviceName)
  return { via: how === 'relay' ? 'relay' : 'direct' }
}
