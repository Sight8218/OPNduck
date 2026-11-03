import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconAdjustmentsHorizontal, IconCpu, IconDownload, IconGauge, IconInfoCircle, IconKeyboard, IconPlugConnected, IconSparkles } from '@tabler/icons-react'
import GpuPerformanceCard from '../components/GpuPerformanceCard'
import MusicTaggingCard from '../components/MusicTaggingCard'
import SendToOpnduckCard from '../components/SendToOpnduckCard'
import ServersCard from '../components/ServersCard'
import SchedulingCard from '../components/SchedulingCard'
import AiCard from '../components/AiCard'
import NotificationsCard from '../components/NotificationsCard'
import McpCard from '../components/McpCard'
import PluginSafeMode from '../components/PluginSafeMode'
import QueueCard from '../components/QueueCard'
import WatchFolderCard from '../components/WatchFolderCard'
import SetupCard from '../components/SetupCard'
import HardwareAllocation from '../components/HardwareAllocation'
import InfoCard from '../components/InfoCard'
import KeybindsCard from '../components/KeybindsCard'
import NavDisplayCard from '../components/NavDisplayCard'
import ArcadeCard from '../components/ArcadeCard'
import MotionCard from '../components/MotionCard'
import BackgroundCard from '../components/BackgroundCard'
import UpdatesCard from '../components/UpdatesCard'
import DownloadsCard from '../components/DownloadsCard'
import { host } from '../host'
import StorageCard from '../components/StorageCard'
import DevTools from '../components/DevTools'
import { useDevMode } from '../lib/devMode'
import SettingsNav, { type SettingsCategory } from '../components/SettingsNav'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../themes/useTheme'

/** One category of the settings column: its scroll target and its divider label. */
function Section({ id, label, refs, children }: { id: string; label: string; refs: React.MutableRefObject<Record<string, HTMLElement | null>>; children: React.ReactNode }) {
  return (
    <section
      id={`settings-${id}`}
      ref={(el) => {
        refs.current[id] = el
      }}
      className="scroll-mt-24 flex flex-col gap-6"
    >
      <CategoryLabel label={label} />
      {children}
    </section>
  )
}

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
  { id: 'downloads', label: 'Downloads & files', icon: IconDownload },
  { id: 'performance', label: 'Queue & performance', icon: IconGauge },
  { id: 'ai', label: 'AI assistant', icon: IconSparkles },
  { id: 'connections', label: 'Connections', icon: IconPlugConnected },
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
  const { theme, setTheme, omarchy } = useTheme()
  const { devMode } = useDevMode()
  const [activeId, setActiveId] = useState('appearance')
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  /** Categories that have nothing to show here (the browser has no settings file, only the desktop has an assistant) are left out. */
  const visible = (id: string) => (id === 'downloads' || id === 'performance' || id === 'connections' ? !!host.settings : id === 'ai' ? !!host.settings && host.isDesktop : true)

  const select = (id: string) => {
    setActiveId(id)
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    // A fixed "top line" just below the sticky area: the active category is
    // the last one whose top has scrolled up past that line. Using the
    // viewport midpoint instead broke on short sections (e.g. Keybinds) —
    // scrollIntoView aligns a section's top near this same line, but if the
    // section is shorter than half the viewport its bottom never reaches the
    // midpoint, so the midpoint sits in the *next* section and the nav jumps
    // straight past the one you just clicked.
    const TOP_LINE = 110
    const onScroll = () => {
      let current = CATEGORIES[0].id
      for (const c of CATEGORIES) {
        if (!visible(c.id)) continue
        const el = sectionRefs.current[c.id]
        if (!el) continue
        if (el.getBoundingClientRect().top <= TOP_LINE) current = c.id
      }
      setActiveId((prev) => (prev === current ? prev : current))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="px-4 py-6 sm:px-5">
      <div className="mx-auto mb-6 max-w-3xl">
        <h1 className="text-2xl font-extrabold text-[var(--text)] sm:text-3xl">Settings</h1>
      </div>

      {/* Category rail: portaled straight to document.body, fixed to the
          viewport like NavBar — never following scroll via a mechanism,
          just permanently pinned in place, from just below the top bar to
          just above the bottom of the screen (viewport-relative, not
          document-relative — no need to scroll to the very end to see it). */}
      {createPortal(
        <div className="fixed left-4 top-24 bottom-6 z-30 w-56 sm:left-5">
          <SettingsNav categories={CATEGORIES.filter((c) => visible(c.id))} activeId={activeId} onSelect={select} />
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
            <ThemeToggle theme={theme} onChange={setTheme} omarchy={omarchy} />
            <BackgroundCard />
            <NavDisplayCard />
            <ArcadeCard />
            <MotionCard />

            {devMode && <DevTools />}
          </section>
          <Section id="keybinds" label="Keybinds" refs={sectionRefs}>
            <KeybindsCard />
          </Section>
          {visible('downloads') && (
            <Section id="downloads" label="Downloads & files" refs={sectionRefs}>
              <DownloadsCard />
              <MusicTaggingCard />
              <WatchFolderCard />
            </Section>
          )}
          {visible('performance') && (
            <Section id="performance" label="Queue & performance" refs={sectionRefs}>
              <QueueCard />
              {host.isDesktop && <SchedulingCard />}
              <HardwareAllocation />
              <GpuPerformanceCard />
              <NotificationsCard />
            </Section>
          )}
          {visible('ai') && (
            <Section id="ai" label="AI assistant" refs={sectionRefs}>
              <AiCard />
            </Section>
          )}
          {visible('connections') && (
            <Section id="connections" label="Connections" refs={sectionRefs}>
              <SendToOpnduckCard />
              <ServersCard />
              {host.mcp && <McpCard />}
            </Section>
          )}
          <Section id="system" label="System" refs={sectionRefs}>
            <SetupCard />
            {host.plugins && <PluginSafeMode />}
            <StorageCard />
            <UpdatesCard />
          </Section>
          <Section id="about" label="About" refs={sectionRefs}>
            <InfoCard />
          </Section>
          </div>
        </div>
      </div>
    </div>
  )
}