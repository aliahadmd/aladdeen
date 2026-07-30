import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

interface EdgeResizerOptions {
  side: 'left' | 'right'
  width: number
  min: number
  max: number
  defaultWidth: number
  cssVariable: `--${string}`
  bodyClass: string
  active?: boolean
  onCommit(width: number): void
}

interface EdgeResizerResult {
  currentWidth(): number
  reset(): void
  onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void
  onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void
  onPointerEnd(event: ReactPointerEvent<HTMLDivElement>): void
}

export function useEdgeResizer({
  side,
  width,
  min,
  max,
  defaultWidth,
  cssVariable,
  bodyClass,
  active = true,
  onCommit
}: EdgeResizerOptions): EdgeResizerResult {
  const widthRef = useRef(width)
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)

  const clamp = (value: number): number => Math.min(max, Math.max(min, Math.round(value)))
  const preview = (value: number): void => {
    const next = clamp(value)
    widthRef.current = next
    document.documentElement.style.setProperty(cssVariable, `${next}px`)
  }

  useEffect(() => {
    widthRef.current = width
    document.documentElement.style.setProperty(cssVariable, active ? `${width}px` : '0px')
  }, [active, cssVariable, width])

  const persist = (): void => {
    document.body.classList.remove(bodyClass)
    resizeRef.current = null
    if (widthRef.current !== width) onCommit(widthRef.current)
  }

  return {
    currentWidth: () => widthRef.current,
    reset: () => {
      preview(defaultWidth)
      onCommit(defaultWidth)
    },
    onPointerDown(event) {
      if (!active || event.button !== 0 || resizeRef.current) return
      resizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: widthRef.current
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      document.body.classList.add(bodyClass)
    },
    onPointerMove(event) {
      const resize = resizeRef.current
      if (!resize || resize.pointerId !== event.pointerId) return
      const delta = event.clientX - resize.startX
      preview(resize.startWidth + (side === 'left' ? delta : -delta))
      event.currentTarget.setAttribute('aria-valuenow', String(widthRef.current))
    },
    onPointerEnd(event) {
      if (resizeRef.current?.pointerId !== event.pointerId) return
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      persist()
    },
    onKeyDown(event) {
      let next: number | undefined
      if (event.key === 'ArrowLeft') next = widthRef.current + (side === 'left' ? -16 : 16)
      if (event.key === 'ArrowRight') next = widthRef.current + (side === 'left' ? 16 : -16)
      if (event.key === 'Home') next = min
      if (event.key === 'End') next = max
      if (next === undefined) return
      event.preventDefault()
      preview(next)
      event.currentTarget.setAttribute('aria-valuenow', String(widthRef.current))
      onCommit(widthRef.current)
    }
  }
}
