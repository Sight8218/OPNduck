import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { readNavDisplay, writeNavDisplay, type NavDisplay } from '../lib/nav'

interface NavContextValue {
  navDisplay: NavDisplay
  setNavDisplay: (mode: NavDisplay) => void
}

const NavContext = createContext<NavContextValue | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const [navDisplay, setNavDisplayState] = useState<NavDisplay>('hybrid')

  useEffect(() => {
    setNavDisplayState(readNavDisplay())
  }, [])

  const setNavDisplay = (mode: NavDisplay) => {
    setNavDisplayState(mode)
    writeNavDisplay(mode)
  }

  return (
    <NavContext.Provider value={{ navDisplay, setNavDisplay }}>
      {children}
    </NavContext.Provider>
  )
}

export function useNavDisplay(): NavContextValue {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNavDisplay must be used within a NavProvider')
  return ctx
}