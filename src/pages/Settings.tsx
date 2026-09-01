import { useEffect, useRef, useState } from 'react'
import { IconAdjustmentsHorizontal, IconCpu, IconInfoCircle, IconKeyboard } from '@tabler/icons-react'
import HardwareAllocation from '../components/HardwareAllocation'
import InfoCard from '../components/InfoCard'
import NavDisplayCard from '../components/NavDisplayCard'
import GlassTune from '../components/GlassTune'
import { DEV_BIND, useDevMode } from '../lib/devMode'
import SettingsNav, { type SettingsCategory } from '../components/SettingsNav'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../themes/useTheme'

const CATEGORIES: SettingsCategory[] = [
  { id: 'appearance', label: 'Appearance', icon: IconAdjustmentsHorizontal },
  { id: 'keybinds', label: 'Keybinds', icon: IconKeyboard },
  { id: 'system', label: 'System', icon: IconCpu },
  { id: 'about', label: 'About', icon: IconInfoCircle },
]

/**
 * Settings page: a category rail pinned near the left edge and a
 * right-aligned column of cards. The whole page scrolls so every card —
 * including the Info readout at the bottom — is reachable. As you scroll, the
 * highlighted category follows via a sliding indicator.
 */
export default function Settings() {
  const { theme, setTheme } = useTheme()
  const { devMode } = useDevMode()
  const [activeId, setActiveId] = useState('appearance')
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  const select = (id: string) => {
    setActiveId(id)
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    const onScroll = () => {
      const last = CATEGORIES[CATEGORIES.length - 1]
      const lastEl = sectionRefs.current[last.id]
      // Reached the bottom: the last section is shorter than the viewport, so
      // its top never crosses the threshold — activate it at the very end.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      if (atBottom && lastEl) {
        setActiveId((prev) => (prev === last.id ? prev : last.id))
        return
      }
      let current = CATEGORIES[0].id
      for (const c of CATEGORIES) {
        const el = sectionRefs.current[c.id]
        if (el && el.getBoundingClientRect().top <= 160) current = c.id
      }
      setActiveId((prev) => (prev === current ? prev : current))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="px-4 py-6 sm:px-5">
      <div className="mb-6 max-w-6xl">
        <h1 className="text-2xl font-extrabold text-[var(--text)] sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          Global configuration, separate from the main workspace.
        </p>
      </div>

      <div className="mt-2 flex gap-8">
        {/* Category rail pinned near the left edge with breathing room */}
        <SettingsNav categories={CATEGORIES} activeId={activeId} onSelect={select} />

        {/* Right-aligned settings column */}
        <div className="ml-auto flex w-full max-w-2xl flex-col gap-6">
          <section
            id="settings-appearance"
            ref={(el) => {
              sectionRefs.current.appearance = el
            }}
            className="scroll-mt-24 flex flex-col gap-6"
          >
            <ThemeToggle theme={theme} onChange={setTheme} />
            <NavDisplayCard />

            {devMode && <GlassTune />}
          </section>
          <section
            id="settings-keybinds"
            ref={(el) => {
              sectionRefs.current.keybinds = el
            }}
            className="scroll-mt-24 flex flex-col gap-6"
          >
            <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
              <span className="text-sm font-semibold text-[var(--text)]">Keybinds</span>
              <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-border)] pb-3">
                <div className="flex flex-col">
                  <span className="text-sm text-[var(--text)]">Toggle developer / debug mode</span>
                  <span className="text-xs text-[var(--text-dim)]">Fixed for now (not changeable)</span>
                </div>
                <kbd className="rounded-md border border-[var(--glass-border)] bg-[var(--input-bg)] px-2 py-1 font-mono text-xs tracking-wider text-[var(--text)]">
                  {DEV_BIND}
                </kbd>
              </div>
              <p className="text-xs text-[var(--text-dim)]">
                More changeable keybinds arrive with the keybindings menu later.
              </p>
            </div>
          </section>
          <section
            id="settings-system"
            ref={(el) => {
              sectionRefs.current.system = el
            }}
            className="scroll-mt-24"
          >
            <HardwareAllocation />
          </section>
          <section
            id="settings-about"
            ref={(el) => {
              sectionRefs.current.about = el
            }}
            className="scroll-mt-24"
          >
            <InfoCard />
          </section>
        </div>
      </div>
    </div>
  )
}