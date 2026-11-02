import { registerPlugin } from '@capacitor/core'

interface OpnduckNativePlugin {
  secureSet(o: { key: string; value: string }): Promise<void>
  secureGet(o: { key: string }): Promise<{ value: string | null }>
  secureRemove(o: { key: string }): Promise<void>
  consumeShared(): Promise<{ text: string }>
  download(o: { url: string; fileName: string }): Promise<{ id: number }>
  addListener(event: 'shared', fn: (e: { text: string }) => void): Promise<{ remove(): void }>
}

/** In a browser (npm run dev) there is no Android: secrets go to localStorage so the screens can still be tried. */
const web: OpnduckNativePlugin = {
  secureSet: async ({ key, value }) => localStorage.setItem(`opnduck.dev.${key}`, value),
  secureGet: async ({ key }) => ({ value: localStorage.getItem(`opnduck.dev.${key}`) }),
  secureRemove: async ({ key }) => localStorage.removeItem(`opnduck.dev.${key}`),
  consumeShared: async () => ({ text: '' }),
  download: async ({ url }) => {
    window.open(url, '_blank')
    return { id: 0 }
  },
  addListener: async () => ({ remove() {} }),
}

export const native = registerPlugin<OpnduckNativePlugin>('OpnduckNative', { web: () => web })
