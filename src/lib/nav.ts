import {
  IconHome2,
  IconDownload,
  IconPlug,
  IconSettings,
  IconMenu2,
  type Icon,
} from '@tabler/icons-react'

/**
 * Navigation model shared by the top-bar menu, the hamburger menu, and the
 * swipe page transition. Each page has a fixed index so we can derive swipe
 * direction and speed from the distance between the previous and next menu.
 */

export interface NavItem {
  /** zero-based position in the menu, used for swipe direction/speed */
  index: number
  to: string
  label: string
  end: boolean
  /** Tabler outline icon for the menu card / hamburger link */
  icon: Icon
}

export const NAV_ITEMS: NavItem[] = [
  { index: 0, to: '/', label: 'Home', end: true, icon: IconHome2 },
  { index: 1, to: '/downloads', label: 'Downloads', end: false, icon: IconDownload },
  { index: 2, to: '/plugins', label: 'Plugins', end: false, icon: IconPlug },
  { index: 3, to: '/settings', label: 'Settings', end: false, icon: IconSettings },
]

export interface SocialItem {
  label: string
  url: string
  /** path (from public/) to the brand PNG provided by the user */
  icon: string
}

export const SOCIALS: SocialItem[] = [
  { label: 'Linktree', url: 'https://linktr.ee/DuckyDuckson', icon: '/icons/linktree.png' },
  { label: 'X (Twitter)', url: 'https://x.com/Ducky_swe', icon: '/icons/x.png' },
  { label: 'YouTube', url: 'https://www.youtube.com/@Ducky_Swe', icon: '/icons/youtube.png' },
  { label: 'TikTok', url: 'https://www.tiktok.com/@mr.ducky.editz', icon: '/icons/tiktok.png' },
]

/** Icon used for the hamburger menu toggle (classic three lines). */
export const HAMBURGER_ICON = IconMenu2

/**
 * Style of the menu cards' icon/text presentation.
 *  - text   = labels only (icons hidden)
 *  - hybrid = icon + label (default)
 *  - icon   = icons only
 */
export type NavDisplay = 'text' | 'hybrid' | 'icon'

export const NAV_STORAGE_KEY = 'opnduck.navDisplay'

export function readNavDisplay(): NavDisplay {
  if (typeof window === 'undefined') return 'hybrid'
  try {
    const stored = localStorage.getItem(NAV_STORAGE_KEY)
    if (stored === 'text' || stored === 'hybrid' || stored === 'icon') return stored
  } catch {
    /* ignore */
  }
  return 'hybrid'
}

export function writeNavDisplay(mode: NavDisplay): void {
  try {
    localStorage.setItem(NAV_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

/**
 * Transition config for a page swipe. `duration` shrinks as the menus get
 * further apart (adjacent moves stay deliberate, big jumps are fast) and the
 * page slides off/on in the direction of travel.
 */
export interface PageSwipe {
  direction: 1 | -1
  outDuration: number
  inDuration: number
  outDistance: number
}

export function swipeFor(current: number, next: number): PageSwipe {
  const distance = Math.abs(next - current)
  const base = 0.34 // seconds
  const duration = Math.max(0.14, base - distance * 0.05)
  return {
    direction: next < current ? -1 : 1,
    outDuration: duration,
    inDuration: Math.max(0.1, duration * 0.8),
    outDistance: 28 + distance * 16,
  }
}