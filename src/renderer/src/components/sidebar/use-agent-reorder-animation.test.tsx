// @vitest-environment happy-dom
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAgentReorderAnimation } from './use-agent-reorder-animation'

function List({ order }: { order: string[] }) {
  const ref = useAgentReorderAnimation(order)
  return (
    <div ref={ref}>
      {order.map((key, index) => (
        <div key={key} data-agent-reorder-key={key} data-top={index * 24}>
          {key}
        </div>
      ))}
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(reduced = false) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: reduced,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    return new DOMRect(0, Number(this.dataset.top ?? 0), 100, 24)
  })
  const cancel = vi.fn()
  const animate = vi.fn(() => ({ cancel, playState: 'running' }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  return { cancel, animate }
}

describe('agent reorder motion', () => {
  it('moves both rows vertically only after a reorder and cleans up on unmount', () => {
    const { animate, cancel } = setup()
    const view = render(<List order={['a', 'b']} />)
    expect(animate).not.toHaveBeenCalled()
    view.rerender(<List order={['b', 'a']} />)
    expect(animate).toHaveBeenNthCalledWith(
      1,
      [{ translate: '0 24px' }, { translate: '0 0' }],
      expect.objectContaining({ duration: 180 })
    )
    expect(animate).toHaveBeenNthCalledWith(
      2,
      [{ translate: '0 -24px' }, { translate: '0 0' }],
      expect.anything()
    )
    view.rerender(<List order={['b', 'a']} />)
    expect(cancel).not.toHaveBeenCalled()
    view.rerender(<List order={['a', 'b']} />)
    expect(cancel).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(cancel).toHaveBeenCalledTimes(4)
  })

  it('respects reduced motion and does not animate initial, added or removed rows', () => {
    const { animate } = setup(true)
    const view = render(<List order={['a', 'b']} />)
    view.rerender(<List order={['b', 'a']} />)
    expect(animate).not.toHaveBeenCalled()
    view.unmount()
    setup()
    const next = render(<List order={['a']} />)
    next.rerender(<List order={['b', 'a']} />)
    next.rerender(<List order={['b']} />)
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled()
  })
})
