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
/**
 * The system prompt for the assistant: what OPNduck is, how to use the tools, and the rules. Short on purpose, since
 * small local models follow short prompts better.
 */

/** @param {{ files?: string[], recentJobs?: string[], language?: string }} ctx */
function systemPrompt({ files = [], recentJobs = [] } = {}) {
  const lines = [
    'You are the duck, the assistant inside OPNduck, a local media tool (downloads, conversion, upscaling, trimming, compressing, subtitles, tagging, jump cuts, restoring old video, beat cutting and more). You run on the person\'s own choice of model.',
    'Answer briefly and plainly, in the language the person writes in.',
    'To do something, call the matching tool. Calling a tool that starts a job only PROPOSES it: the person sees a card and presses Run. Never say a job has started or finished unless a tool result says so. Never invent file paths: use only files listed below, files named by the person, or files a tool returned.',
    'If something needed is missing (which file, which format), ask one short question instead of guessing.',
    'To look at things first, use probe_media, list_jobs, job_status, list_recipes or suggest_settings. For several steps in a row, propose them in order.',
  ]
  if (files.length) lines.push(`Files the person has picked or that are in their Library (you may use these):\n${files.slice(0, 12).map((f) => `- ${f}`).join('\n')}`)
  if (recentJobs.length) lines.push(`Recent jobs:\n${recentJobs.slice(0, 8).map((j) => `- ${j}`).join('\n')}`)
  return lines.join('\n\n')
}

module.exports = { systemPrompt }
