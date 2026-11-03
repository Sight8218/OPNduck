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


import { registerFeatures } from './registry'
import ConverterCard from './converter/ConverterCard'
import DownloaderCard from './downloader/DownloaderCard'
import InterpolationCard from './interpolate/InterpolationCard'
import AudioAiCard from './audio-ai/AudioAiCard'
import SubtitlesCard from './subtitles/SubtitlesCard'
import ImageUpscalerCard from './upscaler/ImageUpscalerCard'
import VideoUpscalerCard from './upscaler/VideoUpscalerCard'
import CompressCard from './compress/CompressCard'
import GifCard from './gif/GifCard'
import JumpCutCard from './jumpcut/JumpCutCard'
import RestoreCard from './restore/RestoreCard'
import BeatFinderCard from './beats/BeatFinderCard'
import GradeCard from './grade/GradeCard'
import BgRemoveCard from './bgremove/BgRemoveCard'
import TaggerCard from './tagger/TaggerCard'
import TrimCard from './trim/TrimCard'

/**
 * Registers the core tool cards into the adaptive registry.
 * Called once at app startup; later the plugin loader calls
 * `registerFeatures()` again with community definitions.
 */
export function registerCoreFeatures(): void {
  registerFeatures([
    {
      id: 'downloader',
      title: 'Downloader',
      tagline: 'YouTube · TikTok · SoundCloud',
      description: 'Download video or audio as MP4, MP3, MKV, MOV, FLAC or WAV. Spotify links are matched on YouTube (experimental).',
      scope: 'universal',
      icon: 'download',
      enabled: true,
      render: DownloaderCard,
      source: 'core',
    },
    {
      id: 'converter',
      title: 'Converter',
      tagline: 'MP4 · MKV · WebM · MOV',
      description: 'Convert files between formats. Remuxes without re-encoding when it can.',
      scope: 'universal',
      icon: 'convert',
      enabled: true,
      render: ConverterCard,
      source: 'core',
    },
    {
      id: 'image-upscaler',
      title: 'AI Image Upscaler',
      tagline: 'Real-ESRGAN · up to 4×',
      description: 'Enlarge images up to 4× on your GPU.',
      scope: 'desktop-exclusive',
      icon: 'image-upscale',
      enabled: true,
      render: ImageUpscalerCard,
      source: 'core',
    },
    {
      id: 'video-upscaler',
      title: 'AI Video Upscaler',
      tagline: 'Real-ESRGAN · up to 4×',
      description: 'Enlarge video up to 4×, one frame at a time. Slow.',
      scope: 'desktop-exclusive',
      icon: 'video-upscale',
      enabled: true,
      render: VideoUpscalerCard,
      source: 'core',
    },
    {
      id: 'frame-interpolation',
      title: 'Frame Interpolation',
      tagline: 'RIFE · smoother motion',
      description: 'Raise a video’s frame rate 2× or 4× by generating the frames in between.',
      scope: 'desktop-exclusive',
      icon: 'interpolate',
      enabled: true,
      render: InterpolationCard,
      source: 'core',
    },
    {
      id: 'subtitles',
      title: 'Subtitles',
      tagline: 'faster-whisper · offline',
      description: 'Turn speech in a video or audio file into SRT or VTT subtitles, offline.',
      scope: 'desktop-exclusive',
      icon: 'subtitles',
      enabled: true,
      render: SubtitlesCard,
      source: 'core',
    },
    {
      id: 'audio-ai',
      title: 'AI Audio',
      tagline: 'Demucs · stem separation',
      description:
        'Remove vocals, isolate a voice, drop background music, or reduce echo and noise.',
      scope: 'desktop-exclusive',
      icon: 'audio-ai',
      enabled: true,
      render: AudioAiCard,
      source: 'core',
    },
    {
      id: 'trim',
      title: 'Trim',
      tagline: 'Cut a section · no re-encode',
      description: 'Cut a section out of a video or audio file, instantly or frame-exact.',
      scope: 'desktop-exclusive',
      icon: 'trim',
      enabled: true,
      render: TrimCard,
      source: 'core',
    },
    {
      id: 'compress',
      title: 'Compress',
      tagline: 'Fit under a size limit',
      description: 'Shrink a video or audio file so it lands just under a size, like 20 MB for Discord.',
      scope: 'desktop-exclusive',
      icon: 'compress',
      enabled: true,
      render: CompressCard,
      source: 'core',
    },
    {
      id: 'tagger',
      title: 'Music Tagger',
      tagline: 'Tags and cover art',
      description: 'Look up your songs and fill in artist, title, album, year, track and cover art. You check the matches before anything is written.',
      scope: 'desktop-exclusive',
      icon: 'tag',
      enabled: true,
      render: TaggerCard,
      source: 'core',
    },
    {
      id: 'bgremove',
      title: 'Background Remover',
      tagline: 'Cut people out · no green screen',
      description: 'Cut a person or object out of a picture or video and put a transparent background, a colour, a blur or another picture behind it.',
      scope: 'desktop-exclusive',
      icon: 'bgremove',
      enabled: true,
      render: BgRemoveCard,
      source: 'core',
    },
    {
      id: 'grade',
      title: 'Colour Grade',
      tagline: 'Auto fix · looks · sliders',
      description: 'Fix washed-out or tinted footage by itself, apply a look, match another picture, or grade by hand with a live before and after.',
      scope: 'desktop-exclusive',
      icon: 'grade',
      enabled: true,
      render: GradeCard,
      source: 'core',
    },
    {
      id: 'beats',
      title: 'Beat Finder',
      tagline: 'BPM · key · cut to the beat',
      description: 'Find the tempo, beats and key of a song, tag it, and make a video montage that switches clips on the beat.',
      scope: 'desktop-exclusive',
      icon: 'beats',
      enabled: true,
      render: BeatFinderCard,
      source: 'core',
    },
    {
      id: 'restore',
      title: 'Restore',
      tagline: 'Deinterlace · denoise · stabilize',
      description: 'Clean up old or shaky footage in one pass, with a before and after preview, then upscale and smooth the motion if you like.',
      scope: 'desktop-exclusive',
      icon: 'restore',
      enabled: true,
      render: RestoreCard,
      source: 'core',
    },
    {
      id: 'jumpcut',
      title: 'Jump Cut',
      tagline: 'Remove silences · normalize loudness',
      description: 'For talking videos and podcasts: cut out the silences in one pass and even out the volume.',
      scope: 'desktop-exclusive',
      icon: 'jumpcut',
      enabled: true,
      render: JumpCutCard,
      source: 'core',
    },
    {
      id: 'gif',
      title: 'GIF & Stickers',
      tagline: 'Clip to GIF, WebP or sticker',
      description: 'Turn a section of a video into a GIF, an animated WebP, or a Telegram or Discord sticker that fits their size limits.',
      scope: 'desktop-exclusive',
      icon: 'gif',
      enabled: true,
      render: GifCard,
      source: 'core',
    },
  ])
}