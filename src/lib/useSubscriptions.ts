import { useEffect, useState } from 'react'
import { host, type Subscription } from '../host'

/** Live list of subscriptions (empty when the host has none, e.g. in a browser). */
export function useSubscriptions(): Subscription[] {
  const [list, setList] = useState<Subscription[]>([])
  useEffect(() => {
    if (!host.subscriptions) return
    let alive = true
    host.subscriptions.list().then((l) => alive && setList(l))
    const unsubscribe = host.subscriptions.subscribe(setList)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  return list
}
