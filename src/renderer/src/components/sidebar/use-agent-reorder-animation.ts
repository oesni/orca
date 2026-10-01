import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

export function useAgentReorderAnimation(order: readonly string[]) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const previousRef = useRef<{ order: readonly string[]; tops: Map<string, number> } | null>(null)
  const animationsRef = useRef<Animation[]>([])
  const reducedMotion = usePrefersReducedMotion()

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }
    const previous = previousRef.current
    const orderChanged =
      previous &&
      (previous.order.length !== order.length ||
        order.some((key, index) => key !== previous.order[index]))
    // Status updates must not interrupt a reorder already in flight.
    if (
      !orderChanged &&
      animationsRef.current.some((animation) => animation.playState === 'running')
    ) {
      return
    }
    const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-agent-reorder-key]'))
    // Measure layout, not a transform left over from an interrupted reorder.
    animationsRef.current.forEach((animation) => animation.cancel())
    animationsRef.current = []
    const rootTop = root.getBoundingClientRect().top
    const tops = new Map(
      elements.map((element) => [
        element.dataset.agentReorderKey ?? '',
        element.getBoundingClientRect().top - rootTop
      ])
    )
    previousRef.current = { order, tops }
    const reordered =
      previous &&
      previous.order.length === order.length &&
      order.every((key) => previous.tops.has(key)) &&
      order.some((key, index) => key !== previous.order[index])
    if (!reordered || reducedMotion) {
      return
    }
    for (const element of elements) {
      if (element.closest('[inert]')) {
        continue
      }
      const key = element.dataset.agentReorderKey ?? ''
      const from = previous.tops.get(key)
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
