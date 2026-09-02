import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route } from 'react-router-dom'
import CommandPalette from './components/CommandPalette'
import FluidBackground from './components/FluidBackground'
import NavBar from './components/NavBar'
import PageTransition from './components/PageTransition'
import PreAlphaBanner from './components/PreAlphaBanner'
import VersionFooter from './components/VersionFooter'
import { registerCoreFeatures } from './features/modules'
import { DevModeProvider } from './lib/devMode'
import { NavProvider } from './lib/navContext'
import { ReduceMotionProvider } from './lib/motionPrefs'
import Downloads from './pages/Downloads'
import Home from './pages/Home'
import Plugins from './pages/Plugins'
import Settings from './pages/Settings'
import { readStoredTheme, applyTheme } from './themes/theme'

// Register core adaptive cards once at startup.
registerCoreFeatures()

function hideSplash() {
  const splash = document.getElementById('startup-splash')
  if (splash) {
    splash.style.opacity = '0'
    splash.style.visibility = 'hidden'
    // Remove after transition so it never intercepts clicks.
    setTimeout(() => splash.remove(), 500)
  }
}

export default function App() {
  // Apply persisted theme before first paint so there's no flash of the wrong one.
  useEffect(() => {
    applyTheme(readStoredTheme())
    hideSplash()
  }, [])

  return (
    <BrowserRouter>
      <DevModeProvider>
        <ReduceMotionProvider>
          <NavProvider>
            <FluidBackground />
            <div className="relative flex min-h-screen flex-col">
              <NavBar />
              <PreAlphaBanner />
              <main className="flex-1 overflow-x-hidden overflow-y-visible">
                <PageTransition>
                  <Route path="/" element={<Home />} />
                  <Route path="/downloads" element={<Downloads />} />
                  <Route path="/plugins" element={<Plugins />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </PageTransition>
              </main>
              <VersionFooter />
            </div>
            <CommandPalette />
          </NavProvider>
        </ReduceMotionProvider>
      </DevModeProvider>
    </BrowserRouter>
  )
}