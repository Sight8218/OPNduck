import {
  IconCloudDownload,
  IconMicrophone2,
  IconMovie,
  IconPhotoUp,
  IconPlayerTrackNext,
  IconArrowsMinimize,
  IconGif,
  IconWaveSine,
  IconWand,
  IconMusic,
  IconScissors,
  IconTags,
  IconTextCaption,
  IconTransform,
  type Icon,
} from '@tabler/icons-react'

/** Feature `icon` keys (see FeatureDefinition) → real SVG icons. */
const FEATURE_ICONS: Record<string, Icon> = {
  download: IconCloudDownload,
  convert: IconTransform,
  'image-upscale': IconPhotoUp,
  'video-upscale': IconMovie,
  interpolate: IconPlayerTrackNext,
  subtitles: IconTextCaption,
  'audio-ai': IconMicrophone2,
  trim: IconScissors,
  compress: IconArrowsMinimize,
  tag: IconTags,
  gif: IconGif,
  jumpcut: IconWaveSine,
  restore: IconWand,
  beats: IconMusic,
}

export function FeatureIcon({ name, size = 22 }: { name: string; size?: number }) {
  const Glyph = FEATURE_ICONS[name]
  // A plugin's icon is a single glyph character from its manifest, not a key.
  if (!Glyph && [...name].length <= 2) {
    return (
      <span aria-hidden="true" className="inline-flex items-center justify-center leading-none" style={{ width: size, height: size, fontSize: size * 0.9 }}>
        {name}
      </span>
    )
  }
  const Fallback = Glyph ?? IconTransform
  return <Fallback size={size} stroke={1.75} aria-hidden="true" />
}
