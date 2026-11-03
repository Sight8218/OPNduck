/** The tools shown on the Home screen; `channel` is the job a screen starts (see electron/core). */
export const TOOLS = [
  { id: 'downloader', title: 'Downloader', tagline: 'YouTube · TikTok · SoundCloud', channel: 'tasks:start' },
  { id: 'converter', title: 'Converter', tagline: 'MP4 · MKV · WebM · MOV', channel: 'tasks:startConvert' },
  { id: 'image-upscaler', title: 'AI Image Upscaler', tagline: 'Real-ESRGAN · up to 4×', channel: 'tasks:startUpscale' },
  { id: 'video-upscaler', title: 'AI Video Upscaler', tagline: 'Real-ESRGAN · up to 4×', channel: 'tasks:startVideoUpscale' },
  { id: 'interpolation', title: 'Frame Interpolation', tagline: 'RIFE · smoother motion', channel: 'tasks:startInterpolate' },
  { id: 'subtitles', title: 'Subtitles', tagline: 'faster-whisper · offline', channel: 'tasks:startSubtitles' },
  { id: 'audio-ai', title: 'AI Audio', tagline: 'Demucs · stem separation', channel: 'tasks:startAudioAi' },
  { id: 'bgremove', title: 'Background Remover', tagline: 'Cut people out · no green screen', channel: 'tasks:startBgRemove' },
  { id: 'grade', title: 'Colour Grade', tagline: 'Auto fix · looks · sliders', channel: 'tasks:startGrade' },
  { id: 'beats', title: 'Beat Finder', tagline: 'BPM · key · tags', channel: 'tasks:startBeatAnalyze' },
  { id: 'restore', title: 'Restore', tagline: 'Deinterlace · denoise · stabilize', channel: 'tasks:startRestore' },
  { id: 'jumpcut', title: 'Jump Cut', tagline: 'Remove silences · normalize loudness', channel: 'tasks:startJumpCut' },
  { id: 'gif', title: 'GIF & Stickers', tagline: 'Clip to GIF · WebP · Telegram/Discord', channel: 'tasks:startGif' },
  { id: 'compress', title: 'Compress', tagline: 'Fit under a size limit', channel: 'tasks:startCompress' },
  { id: 'tagger', title: 'Music Tagger', tagline: 'Tags and cover art · AcoustID', channel: 'tasks:startTag' },
  { id: 'trim', title: 'Trim', tagline: 'Cut a section · no re-encode', channel: 'tasks:startTrim' },
]
