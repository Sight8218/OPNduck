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
import type { PluginPermission } from './registry'

export type PermissionRisk = 'low' | 'medium' | 'high'

export interface PermissionInfo {
  label: string
  detail: string
  risk: PermissionRisk
}

/** What each permission means in plain words, shown in the review panel. Mirrors PLUGINS.md. */
export const PERMISSION_INFO: Record<PluginPermission, PermissionInfo> = {
  jobs: { label: 'Run jobs', detail: 'Start downloads, conversions and other jobs, and see and cancel its own.', risk: 'medium' },
  'files:read': { label: 'Read files', detail: 'Read files you pick for it, and your download folder.', risk: 'medium' },
  'files:write': { label: 'Write files', detail: 'Write files into your download folder or a folder you pick.', risk: 'medium' },
  network: { label: 'Use the network', detail: 'Contact the websites listed below, and nothing else.', risk: 'medium' },
  exec: { label: 'Run OPNduck\'s tools', detail: 'Run ffmpeg, yt-dlp and similar programs with any options it likes. Those can read and write any file and yt-dlp can run commands, so this is nearly the same as running any program.', risk: 'high' },
  'exec:any': { label: 'Run any program', detail: 'Run any program on your computer. Only allow this if you trust the author.', risk: 'high' },
  settings: { label: 'Its own settings', detail: 'Save and read the plugin\'s own settings.', risk: 'low' },
  notify: { label: 'Notifications', detail: 'Show desktop notifications.', risk: 'low' },
  hooks: { label: 'Watch events', detail: 'See when any job finishes or fails, and when the watch folder gets a file.', risk: 'low' },
  tools: { label: 'Add tools', detail: 'Add its tools for MCP clients and the terminal app.', risk: 'low' },
}

/** Permissions that start unticked in the review panel. */
export const OFF_BY_DEFAULT: PluginPermission[] = ['exec', 'exec:any']

export function permissionInfo(p: string): PermissionInfo {
  return (PERMISSION_INFO as Record<string, PermissionInfo>)[p] ?? { label: p, detail: 'Unknown permission.', risk: 'high' }
}
