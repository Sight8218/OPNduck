import wamUrl from '../assets/sounds/wam.mp3?inline'

/** Fade lengths in seconds: a quick ramp up so it doesn't click, and a quick ramp down so it doesn't cut off. */
const FADE_IN = 0.03
const FADE_OUT = 0.15

/** The inlined sound is a base64 data URL. Decoding it by hand keeps the page's CSP (no data: in connect-src) untouched. */
function dataUrlBytes(url: string): ArrayBuffer {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

let ctx: AudioContext | null = null
let buffer: Promise<AudioBuffer> | null = null

/** Plays the little "wam" sound with a fast fade in and fade out. Silent if audio isn't available. */
export async function playWam(): Promise<void> {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    const audio = ctx
    buffer ??= audio.decodeAudioData(dataUrlBytes(wamUrl))
    const decoded = await buffer
    const source = audio.createBufferSource()
    source.buffer = decoded
    const gain = audio.createGain()
    const t = audio.currentTime
    const end = t + decoded.duration
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(1, t + FADE_IN)
    gain.gain.setValueAtTime(1, Math.max(t + FADE_IN, end - FADE_OUT))
    gain.gain.linearRampToValueAtTime(0, end)
    source.connect(gain).connect(audio.destination)
    source.start(t)
  } catch {
    buffer = null // let the next double-click try again
  }
}
