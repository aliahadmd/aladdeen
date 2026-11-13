import { useLayoutEffect, useRef, useState } from 'react'

/** Observe both the viewport and its content, including font-driven layout changes. */
export function usePreviewOverflow<T extends HTMLElement = HTMLDivElement>(content: unknown) {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false })
  const update = (): void => {
    const element = ref.current
    if (!element) return
    const overflow = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1
    const next = { overflow, left: overflow && element.scrollLeft > 1, right: overflow && element.scrollLeft + element.clientWidth < element.scrollWidth - 1 }
    setEdges((previous) => previous.overflow === next.overflow && previous.left === next.left && previous.right === next.right ? previous : next)
  }
  useLayoutEffect(() => {
    update()
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [content])
  return { ref, ...edges, onScroll: update }
}
