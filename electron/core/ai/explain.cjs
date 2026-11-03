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
 * "Why did this fail?": plain-language reasons for the errors people actually hit, found by rules first. Only when no
 * rule matches is the model asked (if one is set up). A reason may carry a fix the person can click. No Electron.
 */

/** Fix actions the window knows how to do. */
const FIXES = {
  update_ytdlp: { label: 'Update yt-dlp and try again' },
  cookies_firefox: { label: 'Use my Firefox login and try again' },
  cpu_encoder: { label: 'Use the CPU encoder and try again' },
  retry: { label: 'Try again' },
}

/** [pattern, reason, fix action or null]. First match wins, so the specific rules come first. */
const RULES = [
  [/sign in to confirm (you.re not a bot|your age)|confirm your age|age-restricted|login required|please sign in|members-only|private video|--cookies/i, 'The site wants you to be signed in (an age check, a bot check or a members-only video).', 'cookies_firefox'],
  [/video unavailable|this video is not available|not available in your country|geo.?restrict|has been removed|account.*terminated|no longer available/i, 'The video is gone or not available where you are. Nothing OPNduck can change will get it.', null],
  [/http error 429|too many requests|rate.?limit/i, 'The site is limiting how fast you can ask. Wait a few minutes and try again.', 'retry'],
  [/unable to extract|nsig extraction|signature extraction|requested format is not available|http error 403|forbidden|unsupported url.*youtube|player response/i, 'The site changed how it serves videos, which usually means yt-dlp is out of date.', 'update_ytdlp'],
  [/temporary failure in name resolution|network is unreachable|getaddrinfo|econnreset|etimedout|timed out|connection (reset|refused)|unable to download (webpage|json)/i, 'The connection failed. Check your internet (and your proxy setting), then try again.', 'retry'],
  [/no space left on device|enospc|disk quota/i, 'The disk is full. Free some space (or choose another download folder in Settings) and try again.', 'retry'],
  [/permission denied|eacces|read-only file system|erofs/i, 'OPNduck is not allowed to write there. Choose a folder you own in Settings, or fix the folder permissions.', null],
  [/openencodesessionex|nvenc|cannot load libcuda|no capable devices found|cuda.*(driver|version)/i, 'The GPU encoder is not working on this computer right now (drivers, or another program is using it).', 'cpu_encoder'],
  [/out of memory|cuda error|vkallocatememory|vulkan.*(failed|error)|ncnn.*failed|std::bad_alloc/i, 'The graphics card ran out of memory. Close other programs that use the GPU (games, browsers with video), or use the CPU option in Settings, then try again.', 'cpu_encoder'],
  [/moov atom not found|invalid data found when processing input|error while decoding|partial file|end of file/i, 'The file is damaged or was not fully downloaded. Download or copy it again.', null],
  [/no such file or directory|enoent|does not exist/i, 'A file this job needs is missing (moved or deleted). Choose the file again.', null],
  [/ffmpeg.*(not found|command not found)|spawn ffmpeg|'ffmpeg' is not recognized/i, 'FFmpeg is not installed. Install it (see Settings, Setup), then try again.', null],
  [/yt-dlp.*(not found|command not found)|spawn yt-dlp/i, 'yt-dlp is not installed. Install it from the Downloader card, then try again.', null],
  [/no module named|faster_whisper|demucs.*(import|not found)|librosa/i, 'A Python add-on this tool needs is missing. Install it from the tool\'s card.', null],
  [/librosa|beat finder needs/i, 'Beat Finder needs its add-on. Install it from the Beat Finder card.', null],
  [/conversion failed|error opening output|invalid argument|unrecognized option/i, 'FFmpeg could not make the file with these settings. Try another format or other settings.', null],
]

/** The explanation for an error text: { reason, fix } where fix is a key of FIXES or null; null when no rule matches. */
function explainByRules(text) {
  const t = String(text ?? '')
  for (const [re, reason, fix] of RULES) if (re.test(t)) return { reason, fix, source: 'rule' }
  return null
}

const aiSchema = { type: 'object', properties: { reason: { type: 'string' }, fix: { type: 'string', enum: ['', ...Object.keys(FIXES)] } }, required: ['reason', 'fix'], additionalProperties: false }

/**
 * @param {{ kind: string, error?: string, label?: string, format?: string }} task
 * @param {string[]} log  the last lines of the job's log
 * @param {{ chat: Function } | null} ai  the AI runtime, or null when no model is set up
 */
async function explain(task, log = [], ai = null) {
  const text = [task.error, ...log.slice(-30)].filter(Boolean).join('\n')
  const ruled = explainByRules(text)
  if (ruled) return { ...ruled, fixLabel: ruled.fix ? FIXES[ruled.fix].label : null }
  if (!ai) return { reason: task.error ? `OPNduck does not recognise this error: ${String(task.error).slice(0, 200)}` : 'There is no error message to go on.', fix: null, fixLabel: null, source: 'none' }
  let out = ''
  const prompt = `A ${task.kind} job in a media tool failed.\nError: ${String(task.error ?? '').slice(0, 400)}\nLast log lines:\n${log.slice(-20).join('\n').slice(0, 2500)}\n\nExplain in one or two plain sentences why, and name a fix only if one of these fits: ${Object.keys(FIXES).join(', ')} (else an empty string).`
  for await (const ev of ai.chat({ messages: [{ role: 'system', content: 'You help a person who is not technical. Be short and honest; if you are not sure, say so.' }, { role: 'user', content: prompt }], jsonSchema: aiSchema, temperature: 0.2, reasoning: 'off', maxTokens: 300 })) if (ev.type === 'text') out += ev.delta
  let j
  try {
    j = JSON.parse(out.trim().replace(/^```(?:json)?|```$/g, ''))
  } catch {
    return { reason: `OPNduck does not recognise this error: ${String(task.error ?? '').slice(0, 200)}`, fix: null, fixLabel: null, source: 'none' }
  }
  const fix = Object.hasOwn(FIXES, j.fix) ? j.fix : null
  return { reason: String(j.reason ?? '').slice(0, 400), fix, fixLabel: fix ? FIXES[fix].label : null, source: 'ai' }
}

module.exports = { explain, explainByRules, FIXES, RULES }
