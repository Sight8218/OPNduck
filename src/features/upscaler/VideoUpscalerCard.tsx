import { useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import SlidingSelector from '../../components/SlidingSelector'
import type { FeatureDefinition } from '../registry'

const SCALES = [2, 3, 4].map((s) => ({ value: String(s), label: `${s}×` }))

// Placeholder — no real backend yet. Real video upscaling needs a full
// frame-extract / upscale-each-frame / reassemble pipeline (see AI Image
// Upscaler for the actual working realesrgan-ncnn-vulkan integration,
// which this will eventually build on frame-by-frame).
export default function VideoUpscalerCard({ feature }: { feature: FeatureDefinition }) {
  const [scale, setScale] = useState('2')

  return (
    <FeatureCard feature={feature}>
      <SlidingSelector
        id="upscale-scale"
        options={SCALES}
        value={scale}
        onChange={setScale}
        className="grid-cols-3"
      />
      <button className="glass-btn">Run Task</button>
    </FeatureCard>
  )
}