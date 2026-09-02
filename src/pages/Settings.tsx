import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconAdjustmentsHorizontal, IconCpu, IconInfoCircle, IconKeyboard } from '@tabler/icons-react'
import HardwareAllocation from '../components/HardwareAllocation'
import InfoCard from '../components/InfoCard'
import NavDisplayCard from '../components/NavDisplayCard'
import MotionCard from '../components/MotionCard'
import StorageCard from '../components/StorageCard'
import DevTools from '../components/DevTools'
import { DEV_BIND, useDevMode } from '../lib/devMode'
import SettingsNav, { type SettingsCategory } from '../components/SettingsNav'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../themes/useTheme'

/** Repeats the category name as a divider at the top of its scrolling
 * section, so it's clear what you're looking at independent of the fixed
 * panel's highlight — helpful once a category holds several cards. */
function CategoryLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-semibold text-[var(--text-faint)]">{label}</span>
      <div className="h-px flex-1 bg-[var(--glass-border)]" />
    </div>
  )
}

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
      // Whichever section's box actually contains the vertical middle of the
      // viewport is "the one you're looking at" — a fixed distance-from-top
      // threshold instead falsely jumps to the next category the moment it
      // peeks in at the top, well before it's actually what's on screen, and
      // could skip a section entirely if it's shorter than the threshold.
      const midpoint = window.innerHeight / 2
      let current = CATEGORIES[0].id
      for (const c of CATEGORIES) {
        const el = sectionRefs.current[c.id]
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (rect.top <= midpoint && rect.bottom >= midpoint) {
          current = c.id
          break
        }
        // Past this section's bottom already: keep it as the running
        // candidate in case nothing fully straddles the midpoint (e.g. the
        // last, short section once you've scrolled past its own middle).
        if (rect.top <= midpoint) current = c.id
      }
      setActiveId((prev) => (prev === current ? prev : current))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="px-4 py-6 sm:px-5">
      {/* pl-72 clears the fixed category panel (w-60 starting at left-4/5) —
          without it this heading sat right underneath the panel. */}
      <div className="mb-6 max-w-6xl pl-72">
        <h1 className="text-2xl font-extrabold text-[var(--text)] sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          Global configuration, separate from the main workspace.
        </p>
      </div>

      {/* Category rail: portaled straight to document.body, fixed to the
          viewport like NavBar — never following scroll via a mechanism,
          just permanently pinned in place, from just below the top bar to
          just above the bottom of the screen (viewport-relative, not
          document-relative — no need to scroll to the very end to see it). */}
      {createPortal(
        <div className="fixed left-4 top-24 bottom-6 z-30 w-60 sm:left-5">
          <SettingsNav categories={CATEGORIES} activeId={activeId} onSelect={select} />
        </div>,
        document.body,
      )}

      <div className="relative mt-2">
      {/* Settings column: centered on the viewport (matches the OPNDuck wordmark) */}
      <div className="flex w-full flex-col items-center">
        <div className="flex w-full max-w-3xl flex-col gap-6">
          <section
            id="settings-appearance"
            ref={(el) => {
              sectionRefs.current.appearance = el
            }}
            className="scroll-mt-24 flex flex-col gap-6"
          >
            <CategoryLabel label="Appearance" />
            <ThemeToggle theme={theme} onChange={setTheme} />
            <NavDisplayCard />
            <MotionCard />

            {devMode && <DevTools theme={theme} />}
          </section>
          <section
            id="settings-keybinds"
            ref={(el) => {
              sectionRefs.current.keybinds = el
            }}
            className="scroll-mt-24 flex flex-col gap-6"
          >
            <CategoryLabel label="Keybinds" />
            <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
              <span className="text-sm font-semibold text-[var(--text)]">Keybinds</span>
              <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-border)] pb-3">
                <div className="flex flex-col">
                  <span className="text-sm text-[var(--text)]">Command palette</span>
                  <span className="text-xs text-[var(--text-dim)]">Jump to any page or action.</span>
                </div>
                <kbd className="rounded-md border border-[var(--glass-border)] bg-[var(--input-bg)] px-2 py-1 font-mono text-xs tracking-wider text-[var(--text)]">
                  Ctrl+K
                </kbd>
              </div>
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
            className="scroll-mt-24 flex flex-col gap-6"
          >
            <CategoryLabel label="System" />
            <HardwareAllocation />
            <StorageCard />
          </section>
          <section
            id="settings-about"
            ref={(el) => {
              sectionRefs.current.about = el
            }}
            className="scroll-mt-24 flex flex-col gap-6"
          >
            <CategoryLabel label="About" />
            <InfoCard />
          </section>
          </div>
        </div>
      </div>
    </div>
  )
}