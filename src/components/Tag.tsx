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

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

/** Small squircle-cornered metadata chip — format/quality/size labels on task rows and cards. */
export default function Tag({ children }: { children: ReactNode }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.75 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      className="inline-flex items-center rounded-[7px] border border-[var(--glass-border)] bg-[var(--input-bg)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-dim)]"
    >
      {children}
    </motion.span>
  )
}
