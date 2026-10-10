import { useEffect } from 'react'
import { HashRouter, Navigate, Route } from 'react-router-dom'
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
import Home from './pages/Home'
import Library from './pages/Library'
import Plugins from './pages/Plugins'
import Settings from './pages/Settings'
import { readStoredTheme, applyTheme } from './themes/theme'
import { useOmarchyThemeSync } from './themes/useTheme'

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

  // Dropping a file anywhere that isn't a card would make Electron navigate the window to
  // it (replacing the whole UI). Cards that accept drops preventDefault() themselves.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])

  // Always-on, independent of which page's Settings/useTheme() may or may
  // not be mounted — see useOmarchyThemeSync()'s own doc comment.
  useOmarchyThemeSync()

  return (
    // BrowserRouter needs a real HTTP server to resolve paths like /library.
    // The packaged app loads index.html straight off disk via file:// (no
    // server at all), where BrowserRouter can't match any route — nothing
    // renders past the first paint and in-app navigation does nothing.
    // HashRouter keeps all routing state after a `#`, which is pure
    // client-side and needs no server, so it works identically in the Vite
    // dev server, the browser preview, and the packaged file:// app.
    <HashRouter>
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
                  <Route path="/library" element={<Library />} />
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
    </HashRouter>
  )
}