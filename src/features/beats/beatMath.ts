/** The tempo from tapping along: the average gap between the last few taps (milliseconds in, BPM out), or null with fewer than 3 taps. */
export function tapBpm(taps: number[]): number | null {
  const recent = taps.slice(-9)
  if (recent.length < 3) return null
  const gaps = recent.slice(1).map((t, i) => t - recent[i])
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
  return avg > 0 ? Math.round((60000 / avg) * 10) / 10 : null
}

/** An even beat grid at `bpm` that keeps the first beat where the analysis found it, across `duration` seconds. */
export function gridFrom(first: number, bpm: number, duration: number): number[] {
  const step = 60 / bpm
  const out: number[] = []
  for (let t = first; t < duration; t += step) out.push(Math.round(t * 1000) / 1000)
  return out
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const clock = (s: number) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}.${pad(Math.round((s % 1) * 1000), 3)}`

/** The beats as a CSV file (one row per beat). */
export const beatsCsv = (beats: number[]): string => ['beat,seconds,time', ...beats.map((b, i) => `${i + 1},${b.toFixed(3)},${clock(b)}`)].join('\n') + '\n'

/** The beats as FFmpeg chapter metadata (`ffmpeg -i song.mp3 -i this.txt -map_metadata 1 ...`), one chapter per bar of `perBar` beats. */
export function beatsChapters(beats: number[], duration: number, perBar = 4): string {
  const lines = [';FFMETADATA1']
  for (let i = 0; i < beats.length; i += perBar) {
    const start = Math.round(beats[i] * 1000)
    const end = Math.round((beats[i + perBar] ?? duration) * 1000)
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${start}`, `END=${Math.max(start + 1, end)}`, `title=Bar ${i / perBar + 1}`)
  }
  return lines.join('\n') + '\n'
}
