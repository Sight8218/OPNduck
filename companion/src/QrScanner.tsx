import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

/** Full-screen camera that reads a QR code and hands back its text. Decoding is plain JavaScript (no Google libraries). */
export default function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stop = false
    let stream: MediaStream | null = null
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    async function run() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch {
        setError('The camera is not available. Allow it in Android settings, or paste the link instead.')
        return
      }
      const v = video.current!
      v.srcObject = stream
      await v.play()
      const tick = () => {
        if (stop) return
        if (v.videoWidth) {
          canvas.width = v.videoWidth
          canvas.height = v.videoHeight
          ctx.drawImage(v, 0, 0)
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
          if (code?.data) return onResult(code.data)
        }
        setTimeout(tick, 120)
      }
      tick()
    }
    void run()
    return () => {
      stop = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onResult])

  return (
    <div className="scanner">
      <video ref={video} playsInline muted />
      <div className="bottom">
        <span>{error || 'Point the camera at the QR code in OPNduck on your computer.'}</span>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
