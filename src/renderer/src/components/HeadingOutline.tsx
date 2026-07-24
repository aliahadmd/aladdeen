import * as Popover from '@radix-ui/react-popover'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'

interface OutlineHeading {
  id: string
  label: string
  element: HTMLHeadingElement
}

interface HeadingOutlineProps {
  articleRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  contentRevision: string
}

const OPEN_DELAY = 120
const CLOSE_DELAY = 150

function headingLabel(element: HTMLHeadingElement): string {
  const text = element.textContent?.trim()
  if (text) return text
  const imageText = Array.from(element.querySelectorAll('img'))
    .map((image) => image.alt.trim())
    .filter(Boolean)
    .join(' ')
  return imageText || 'Untitled heading'
}

export function HeadingOutline({
  articleRef,
  scrollRef,
  contentRevision
}: HeadingOutlineProps): React.JSX.Element | null {
  const [headings, setHeadings] = useState<OutlineHeading[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const offsets = useRef<number[]>([])

  useLayoutEffect(() => {
    const article = articleRef.current
    if (!article) {
      setHeadings([])
      return
    }
    const next = Array.from(article.querySelectorAll<HTMLHeadingElement>('h1[id^="md-"]')).map((element) => ({
      id: element.id,
      label: headingLabel(element),
      element
    }))
    setHeadings(next)
  }, [articleRef, contentRevision])

  useEffect(() => {
    const scroll = scrollRef.current
    const article = articleRef.current
    if (!scroll || !article || headings.length === 0) {
      offsets.current = []
      if (openTimer.current) window.clearTimeout(openTimer.current)
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
      openTimer.current = undefined
      closeTimer.current = undefined
      setActiveId(null)
      setOpen(false)
      return
    }

    let animationFrame = 0
    const recalculate = (): void => {
      const scrollRect = scroll.getBoundingClientRect()
      offsets.current = headings.map(
        ({ element }) => element.getBoundingClientRect().top - scrollRect.top + scroll.scrollTop
      )
    }
    const updateActiveHeading = (): void => {
      animationFrame = 0
      const threshold = scroll.scrollTop + 96
      let activeIndex = 0
      for (let index = 1; index < offsets.current.length; index += 1) {
        if (offsets.current[index]! > threshold) break
        activeIndex = index
      }
      const nextId = headings[activeIndex]?.id ?? null
      setActiveId((current) => current === nextId ? current : nextId)
    }
    const scheduleUpdate = (): void => {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(updateActiveHeading)
    }
    const handleResize = (): void => {
      recalculate()
      scheduleUpdate()
    }

    recalculate()
    updateActiveHeading()
    scroll.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', handleResize)
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(handleResize)
    resizeObserver?.observe(article)

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      scroll.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', handleResize)
      resizeObserver?.disconnect()
    }
  }, [articleRef, headings, scrollRef])

  useEffect(
    () => () => {
      if (openTimer.current) window.clearTimeout(openTimer.current)
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    []
  )

  const clearTimers = (): void => {
    if (openTimer.current) window.clearTimeout(openTimer.current)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    openTimer.current = undefined
    closeTimer.current = undefined
  }

  const changeOpen = (next: boolean): void => {
    clearTimers()
    setOpen(next)
    if (next) setHighlightedId(activeId ?? headings[0]?.id ?? null)
    else setHighlightedId(null)
  }

  const scheduleOpen = (): void => {
    if (open || openTimer.current) return
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = undefined
    openTimer.current = window.setTimeout(() => {
      openTimer.current = undefined
      changeOpen(true)
    }, OPEN_DELAY)
  }

  const scheduleClose = (): void => {
    if (openTimer.current) window.clearTimeout(openTimer.current)
    openTimer.current = undefined
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined
      changeOpen(false)
    }, CLOSE_DELAY)
  }

  const keepOpen = (): void => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = undefined
  }

  const scrollToHeading = (heading: OutlineHeading): void => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    heading.element.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start'
    })
    setActiveId(heading.id)
    setHighlightedId(heading.id)
  }

  const focusRow = (index: number): void => {
    const clamped = Math.max(0, Math.min(headings.length - 1, index))
    const heading = headings[clamped]
    if (!heading) return
    setHighlightedId(heading.id)
    rowRefs.current.get(heading.id)?.focus()
  }

  const highlightedIndex = (): number => {
    const selected = highlightedId ?? activeId
    const index = headings.findIndex(({ id }) => id === selected)
    return index < 0 ? 0 : index
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      changeOpen(true)
      const current = highlightedIndex()
      if (event.key === 'Home') setHighlightedId(headings[0]?.id ?? null)
      else if (event.key === 'End') setHighlightedId(headings.at(-1)?.id ?? null)
      else if (event.key === 'ArrowDown') setHighlightedId(headings[Math.min(current + (open ? 1 : 0), headings.length - 1)]?.id ?? null)
      else setHighlightedId(headings[Math.max(current - (open ? 1 : 0), 0)]?.id ?? null)
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault()
      event.stopPropagation()
      const heading = headings[highlightedIndex()]
      if (heading) scrollToHeading(heading)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      changeOpen(false)
    }
  }

  const handleRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusRow(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusRow(index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusRow(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusRow(headings.length - 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      triggerRef.current?.focus()
      changeOpen(false)
    }
  }

  const handleTriggerPointerEnter = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.pointerType !== 'touch') scheduleOpen()
  }

  if (headings.length === 0) return null

  const densityClass = headings.length > 80 ? 'is-ultra-dense' : headings.length > 32 ? 'is-dense' : ''

  return (
    <Popover.Root open={open} onOpenChange={changeOpen} modal={false}>
      <div className="heading-outline">
        <Popover.Trigger asChild>
          <button
            ref={triggerRef}
            type="button"
            className={`heading-outline-trigger ${densityClass}`}
            aria-label={`${headings.length} level 1 ${headings.length === 1 ? 'heading' : 'headings'}`}
            aria-controls={contentId}
            aria-expanded={open}
            onFocus={() => changeOpen(true)}
            onBlur={(event) => {
              const next = event.relatedTarget
              if (next instanceof Node && panelRef.current?.contains(next)) return
              scheduleClose()
            }}
            onPointerEnter={handleTriggerPointerEnter}
            onPointerLeave={scheduleClose}
            onKeyDown={handleTriggerKeyDown}
            onClick={(event) => {
              const marker = (event.target as HTMLElement).closest<HTMLElement>('[data-heading-id]')
              if (!marker) return
              const heading = headings.find(({ id }) => id === marker.dataset.headingId)
              if (!heading) return
              event.preventDefault()
              scrollToHeading(heading)
              changeOpen(true)
            }}
          >
            <span className="heading-outline-markers" aria-hidden="true">
              {headings.map((heading) => (
                <span
                  key={heading.id}
                  className="heading-outline-marker"
                  data-active={heading.id === activeId || undefined}
                  data-highlighted={heading.id === highlightedId || undefined}
                  data-heading-id={heading.id}
                  onPointerEnter={() => setHighlightedId(heading.id)}
                />
              ))}
            </span>
          </button>
        </Popover.Trigger>
      </div>

      <Popover.Portal>
        <Popover.Content
          ref={panelRef}
          forceMount
          id={contentId}
          className="heading-outline-content"
          side="left"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Level 1 headings"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={keepOpen}
          onPointerLeave={scheduleClose}
          onFocusCapture={keepOpen}
          onBlurCapture={(event) => {
            const next = event.relatedTarget
            if (next instanceof Node && (panelRef.current?.contains(next) || triggerRef.current?.contains(next))) return
            scheduleClose()
          }}
        >
          <nav aria-label="Level 1 headings">
            <ul className="heading-outline-list">
              {headings.map((heading, index) => (
                <li key={heading.id}>
                  <button
                    ref={(element) => {
                      if (element) rowRefs.current.set(heading.id, element)
                      else rowRefs.current.delete(heading.id)
                    }}
                    type="button"
                    className="heading-outline-item"
                    aria-current={heading.id === activeId ? 'location' : undefined}
                    data-highlighted={heading.id === highlightedId || undefined}
                    title={heading.label}
                    onFocus={() => setHighlightedId(heading.id)}
                    onPointerEnter={() => setHighlightedId(heading.id)}
                    onKeyDown={(event) => handleRowKeyDown(event, index)}
                    onClick={() => scrollToHeading(heading)}
                  >
                    <span>{heading.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <Popover.Arrow className="heading-outline-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
