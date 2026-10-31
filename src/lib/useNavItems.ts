import { ARCADE_ITEM, NAV_ITEMS, type NavItem } from './nav'
import { useArcadePinned } from './arcadeStore'

const WITH_ARCADE = [...NAV_ITEMS, ARCADE_ITEM]

/** The menu entries to show: the four pages, plus Arcade once the user has pinned it in Settings. */
export function useNavItems(): NavItem[] {
  return useArcadePinned() ? WITH_ARCADE : NAV_ITEMS
}
