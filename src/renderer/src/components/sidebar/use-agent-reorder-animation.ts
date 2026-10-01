import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

export function useAgentReorderAnimation(order: readonly string[]) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const previousRef = useRef<{
    root: HTMLDivElement
    order: readonly string[]
    tops: Map<string, number>
  } | null>(null)
  const animationsRef = useRef<Animation[]>([])
  const reducedMotion = usePrefersReducedMotion()

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }
    if (reducedMotion) {
      animationsRef.current.forEach((animation) => animation.cancel())
      animationsRef.current = []
      previousRef.current = null
      return
    }
    const previous = previousRef.current?.root === root ? previousRef.current : null
    const orderChanged =
      previous &&
      (previous.order.length !== order.length ||
        order.some((key, index) => key !== previous.order[index]))
    // Status updates must not interrupt a reorder already in flight.
    if (
      previous &&
      !orderChanged &&
      animationsRef.current.some((animation) => animation.playState === 'running')
    ) {
      return
    }
    const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-agent-reorder-key]'))
    const measure = () => {
      const measuredTops = new Map<HTMLElement, number>()
      const top = (element: HTMLElement) => {
        const cached = measuredTops.get(element)
        if (cached !== undefined) {
          return cached
        }
        const value = element.getBoundingClientRect().top
        measuredTops.set(element, value)
        return value
      }
      return new Map(
        elements.map((element) => {
          // Each lineage branch moves with its parent; only animate its own sibling displacement.
          const container =
            element.parentElement?.closest<HTMLElement>('[data-agent-reorder-key]') ?? root
          return [element.dataset.agentReorderKey ?? '', top(element) - top(container)]
        })
      )
    }
    const visualTops = animationsRef.current.some((animation) => animation.playState === 'running')
      ? measure()
      : null
    // Measure layout, not a transform left over from an interrupted reorder.
    animationsRef.current.forEach((animation) => animation.cancel())
    animationsRef.current = []
    const tops = measure()
    previousRef.current = { root, order, tops }
    const previousKeys = new Set(previous?.order)
    const reordered =
      previous &&
      previous.order.length === order.length &&
      order.every((key) => previousKeys.has(key)) &&
      order.some((key, index) => key !== previous.order[index])
    if (!reordered) {
      return
    }
    for (const element of elements) {
      if (element.closest('[inert]')) {
        continue
      }
      const key = element.dataset.agentReorderKey ?? ''
      const oldTop = previous.tops.get(key)
      const visualOffset = visualTops ? (visualTops.get(key) ?? 0) - (tops.get(key) ?? 0) : 0
      const from = oldTop === undefined ? undefined : oldTop + visualOffset
      const to = tops.get(key)
      if (from === undefined || to === undefined || Math.abs(from - to) < 0.5) {
        continue
      }
      if (typeof element.animate !== 'function') {
        continue
      }
      animationsRef.current.push(
        element.animate([{ translate: `0 ${from - to}px` }, { translate: '0 0' }], {
          duration: 180,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
        })
      )
    }
  })

  useEffect(() => () => animationsRef.current.forEach((animation) => animation.cancel()), [])
  return rootRef
}
