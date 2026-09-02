import { useMemo } from 'react'
import { version } from '../../package.json'

interface Spec {
  label: string
  value: string
}

function cpuInfo(): string {
  const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number }
  const parts: string[] = []
  if (nav.hardwareConcurrency) parts.push(`${nav.hardwareConcurrency} logical CPUs`)
  if (nav.deviceMemory) parts.push(`${nav.deviceMemory} GB RAM`)
  return parts.join(', ') || 'Detected by the desktop shell'
}

function gpuInfo(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl')
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      const renderer = ext
        ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER))
      return renderer
    }
  } catch {
    /* fall through */
  }
  return 'Detected by the desktop shell'
}

/**
 * Info card in Settings. Reports this machine's specs (browser-detected now;
 * native yt-dlp / ffmpeg versions appear when the desktop shell is wired).
 */
export default function InfoCard() {
  const specs = useMemo<Spec[]>(() => {
    const isDesktop = (globalThis as { process?: { platform?: string } }).process?.platform
    return [
      { label: 'App version', value: `v${version}` },
      { label: 'CPU', value: cpuInfo() },
      { label: 'GPU', value: gpuInfo() },
      {
        label: 'yt-dlp',
        value: isDesktop ? 'Detected with the desktop shell' : 'Bundle with desktop shell (Alpha)',
      },
      {
        label: 'FFmpeg',
        value: isDesktop ? 'Detected with the desktop shell' : 'Bundle with desktop shell (Alpha)',
      },
      { label: 'License', value: 'GPL-3.0' },
      { label: 'Repository', value: 'github.com/Sight8218/OPNduck' },
    ]
  }, [])

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Info</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Your system and bundled tool versions.
      </p>
      <dl className="flex flex-col">
        {specs.map((s, i) => (
          <div
            key={s.label}
            className={`flex items-center justify-between gap-4 py-2.5 ${
              i > 0 ? 'border-t border-[var(--glass-border)]' : ''
            }`}
          >
            <dt className="text-sm text-[var(--text-dim)]">{s.label}</dt>
            <dd className="text-right text-sm font-medium text-[var(--text)]">{s.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}