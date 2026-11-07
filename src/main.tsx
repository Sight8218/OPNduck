/*
 * OPNduck — local-first media processing suite.
 * Copyright (C) 2026 Aaron Jonsson
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */


import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { trackWindowVisibility } from './lib/windowVisible'

// Dev only, and only when asked for (VITE_REACT_SCAN=1 npm run desktop:dev): highlights components as they re-render.
// import.meta.env.DEV is false in a production build, so this whole branch (and react-scan) is removed from the bundle.
if (import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN) {
  void import('react-scan').then(({ scan }) => scan({ enabled: true }))
}

trackWindowVisibility()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)