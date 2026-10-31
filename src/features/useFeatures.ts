import { useSyncExternalStore } from 'react'
import { getFeatureSnapshot, subscribeFeatures, type FeatureDefinition } from './registry'

/** The registered cards, re-rendering the caller when a plugin card is added or removed. */
export function useFeatures(): FeatureDefinition[] {
  return useSyncExternalStore(subscribeFeatures, getFeatureSnapshot)
}
