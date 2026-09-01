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

import { IconMinus, IconSquare, IconX } from '@tabler/icons-react'
import { host } from '../host'

/**
 * macOS-style "traffic light" window controls (minimize / maximize / close).
 *
 * Compact coloured dots (yellow / green / red) sitting tight in the top-right.
 * Hovering one makes it expand a touch, brighten with a soft glow and reveal
 * its icon. Hidden when not running inside the desktop shell.
 */

const CONTROLS = [
  {
    label: 'Minimize',
    color: '#e8c14c',
    hoverColor: '#f6d76d',
    icon: IconMinus,
    action: () => host.window.minimize(),
  },
  {
    label: 'Maximize',
    color: '#4bca71',
    hoverColor: '#6fe296',
    icon: IconSquare,
    action: () => host.window.maximize(),
  },
  {
    label: 'Close',
    color: '#e05555',
    hoverColor: '#f07575',
    icon: IconX,
    action: () => host.window.close(),
  },
]

export default function WindowControls() {
  if (!host.isDesktop) return null

  return (
    <div className="titlebar-no-drag flex items-center gap-1.5 pr-5">
      {CONTROLS.map((c) => {
        const Icon = c.icon
        return (
          <button
            key={c.label}
            type="button"
            aria-label={c.label}
            onClick={c.action}
            className="group grid h-3.5 w-3.5 place-items-center rounded-full transition-all duration-150 hover:h-[18px] hover:w-[18px]"
            style={{ backgroundColor: c.color, WebkitTapHighlightColor: 'transparent' }}
          >
            <span
              aria-hidden="true"
              className="grid h-full w-full place-items-center rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              style={{
                backgroundColor: c.hoverColor,
                boxShadow: `0 0 14px ${c.color}`,
              }}
            >
              <Icon size={11} stroke={2.5} className="text-[#1a0a04]" aria-hidden="true" />
            </span>
          </button>
        )
      })}
    </div>
  )
}