import {
  IconCloudDownload,
  IconMovie,
  IconPhotoUp,
  IconPlayerTrackNext,
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
}

export function FeatureIcon({ name, size = 22 }: { name: string; size?: number }) {
  const Glyph = FEATURE_ICONS[name] ?? IconTransform
  return <Glyph size={size} stroke={1.75} aria-hidden="true" />
}
