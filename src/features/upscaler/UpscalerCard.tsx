import { useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import SlidingSelector from '../../components/SlidingSelector'
import type { FeatureDefinition } from '../registry'

const SCALES = [2, 3, 4].map((s) => ({ value: String(s), label: `${s}×` }))

export default function UpscalerCard({ feature }: { feature: FeatureDefinition }) {
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