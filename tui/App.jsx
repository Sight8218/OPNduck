import { useCallback, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import Header from './ui/Header.jsx'
import Home from './screens/Home.jsx'
import Queue from './screens/Queue.jsx'
import Form from './screens/Form.jsx'
import Library from './screens/Library.jsx'
import Settings from './screens/Settings.jsx'
import Setup from './screens/Setup.jsx'
import Recipes from './screens/Recipes.jsx'
import { makeTheme } from './theme.js'
import { useCoreEvents } from './hooks.js'

const SCREENS = [
  { id: 'home', label: 'Tools' },
  { id: 'queue', label: 'Queue' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'library', label: 'Library' },
  { id: 'settings', label: 'Settings' },
  { id: 'setup', label: 'Setup' },
]

const KEYS = {
  home: '↑↓ move   enter open   tab queue   q quit',
  recipes: '↑↓ move   enter run on a link or file   d remove   tab next   q quit',
  library: '↑↓ move  o folder  r again  d remove  x clear history  tab next  q quit',
  settings: '↑↓ move   ←→ change   enter edit (proxy)   tab next   q quit',
  setup: '↑↓ move   space tick   i install ticked   r recheck   tab next   q quit',
  form: '↑↓ field   ←→ change   tab complete path   enter next / start   esc back',
  queue: '↑↓ move  p pause  c cancel  n next  r again  d remove  x clear  l log  o folder  q quit',
}

/** The screen router and the keys that work everywhere (tab, 1-2, q). */
export default function App({ core, theme: initialTheme, start = 'home' }) {
  const [theme, setTheme] = useState(initialTheme)
  const { exit } = useApp()
  const [screen, setScreen] = useState(start)
  const [note, setNote] = useState('')
  const [tool, setTool] = useState(null)
  const [typing, setTyping] = useState(false)
  const onTyping = useCallback((v) => setTyping(v), [])
  const [confirmQuit, setConfirmQuit] = useState(false)
  useCoreEvents(core.platform)
  // Tools of plugins that are on and approved; the desktop app is where plugins get approved.
  const pluginTools = core.plugins.tools().map((t) => ({ id: t.name, title: t.name, tagline: t.description, def: t }))
  const running = [...core.engine.tasks.values()].filter((t) => t.state.status === 'running').length
  const waiting = [...core.engine.tasks.values()].filter((t) => t.state.status === 'queued').length

  const quit = () => {
    core.shutdown()
    exit()
    // Ink's unmount can race with a killed job's last events and leave the process open; end it for certain.
    setTimeout(() => process.exit(0), 200).unref()
  }
  useInput((input, key) => {
    if (key.ctrl && input === 'c') return quit()
    if (typing) return // a text field is focused: keys belong to the form
    if (key.tab) {
      setScreen((s) => SCREENS[(SCREENS.findIndex((x) => x.id === s) + 1) % SCREENS.length].id)
      return
    }
    const n = Number(input)
    if (Number.isInteger(n) && n >= 1 && n <= SCREENS.length) return setScreen(SCREENS[n - 1].id)
    if (input === 'q' || (key.ctrl && input === 'c')) {
      if (running + waiting > 0 && !confirmQuit) return setConfirmQuit(true)
      quit()
    } else if (confirmQuit) setConfirmQuit(false)
  })

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header theme={theme} screen={screen === 'form' ? 'home' : screen} screens={SCREENS} running={running} />
      <Box marginTop={1} flexDirection="column">
        {screen === 'form' ? (
          <Form
            key={tool.id}
            theme={theme}
            core={core}
            tool={tool}
            onTyping={onTyping}
            onBack={() => setScreen('home')}
            onStarted={(msg) => (setNote(msg), setScreen('queue'))}
          />
        ) : screen === 'home' ? (
          <Home
            theme={theme}
            note={note}
            pluginTools={pluginTools}
            onOpen={(t) => (setTool(t), setScreen('form'))}
          />
        ) : screen === 'recipes' ? (
          <Recipes theme={theme} core={core} onTyping={onTyping} onStarted={(msg) => (setNote(msg), setScreen('queue'))} />
        ) : screen === 'library' ? (
          <Library theme={theme} core={core} />
        ) : screen === 'settings' ? (
          <Settings core={core} theme={theme} themeName={theme.name} onTheme={(name) => setTheme(makeTheme(name))} onTyping={onTyping} />
        ) : screen === 'setup' ? (
          <Setup theme={theme} core={core} onTyping={onTyping} />
        ) : (
          <Queue theme={theme} core={core} note={note} />
        )}
      </Box>
      <Box marginTop={1}>
        {confirmQuit ? (
          <Text color={theme.accent}>{running + waiting} job(s) still running or waiting. Press q again to cancel them and quit, any other key to stay.</Text>
        ) : (
          <Text color={theme.dim}>{KEYS[screen]}</Text>
        )}
      </Box>
    </Box>
  )
}
