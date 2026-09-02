import { useState } from 'react'
import SlidingSelector from './SlidingSelector'

type Assignment = 'auto' | 'gpu' | 'cpu'

interface TaskRow {
  id: string
  label: string
  device: Assignment
}

const INITIAL_TASKS: TaskRow[] = [
  { id: 'interpolation', label: 'AI Video Interpolation', device: 'auto' },
  { id: 'upscale-video', label: 'AI Video Upscaling', device: 'auto' },
  { id: 'upscale-image', label: 'AI Image Upscaling', device: 'auto' },
  { id: 'download', label: 'Media Download (yt-dlp)', device: 'cpu' },
  { id: 'convert', label: 'Format Conversion (FFmpeg)', device: 'auto' },
  { id: 'transcribe', label: 'Subtitle Generation', device: 'auto' },
]

const DEVICE_OPTIONS = [
  { value: 'auto' as Assignment, label: 'Auto' },
  { value: 'gpu' as Assignment, label: 'GPU' },
  { value: 'cpu' as Assignment, label: 'CPU' },
]

/**
 * Hardware Allocation Engine (UI).
 * Lets the user dictate which device each task uses. State is local for now;
 * the real engine persists this and talks to the backends in a later phase.
 */
export default function HardwareAllocation() {
  const [tasks, setTasks] = useState<TaskRow[]>(INITIAL_TASKS)

  const update = (id: string, device: Assignment) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, device } : t)))
  }

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Hardware Allocation</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Dictate exactly which device handles each AI and media task. Auto uses the
        best available hardware.
      </p>

      <div className="flex flex-col">
        {tasks.map((task, i) => (
          <div
            key={task.id}
            className={`flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between ${
              i > 0 ? 'border-t border-[var(--glass-border)]' : ''
            }`}
          >
            <span className="text-sm font-medium">{task.label}</span>
            <SlidingSelector
              id={`device-${task.id}`}
              options={DEVICE_OPTIONS}
              value={task.device}
              onChange={(v) => update(task.id, v)}
              className="w-full grid-cols-3 sm:w-56"
            />
          </div>
        ))}
      </div>
    </div>
  )
}