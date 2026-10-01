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

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalAnimate) {
    Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  }
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
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({
    cancel,
    playState: 'running'
  }))
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

function NestedList({ reversed }: { reversed: boolean }) {
  const order = reversed ? ['q', 'c', 'p', 'b', 'a'] : ['p', 'a', 'b', 'q', 'c']
  const ref = useAgentReorderAnimation(order)
  const branches = reversed ? ['q', 'p'] : ['p', 'q']
  return (
    <div ref={ref}>
      {branches.map((key) => {
        const top = key === 'p' ? (reversed ? 48 : 0) : reversed ? 0 : 72
        const children = key === 'q' ? ['c'] : reversed ? ['b', 'a'] : ['a', 'b']
        return (
          <div key={key} data-agent-reorder-key={key} data-top={top}>
            {children.map((child, index) => (
              <div key={child} data-agent-reorder-key={child} data-top={top + 24 * (index + 1)}>
                {child}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

it('animates child siblings relative to their parent without duplicating parent motion', () => {
  const { animate } = setup()
  const view = render(<NestedList reversed={false} />)
  view.rerender(<NestedList reversed />)
  expect(animate.mock.calls.map((call) => call[0])).toEqual([
    [{ translate: '0 72px' }, { translate: '0 0' }],
    [{ translate: '0 -48px' }, { translate: '0 0' }],
    [{ translate: '0 24px' }, { translate: '0 0' }],
    [{ translate: '0 -24px' }, { translate: '0 0' }]
  ])
})

it('does not animate inert collapsed rows', () => {
  const { animate } = setup()
  const view = render(
    <div inert>
      <List order={['a', 'b']} />
    </div>
  )
  view.rerender(
    <div inert>
      <List order={['b', 'a']} />
    </div>
  )
  expect(animate).not.toHaveBeenCalled()
})

function PartlyHiddenList({ reversed }: { reversed: boolean }) {
  const ref = useAgentReorderAnimation(reversed ? ['b', 'a', 'hidden'] : ['a', 'hidden', 'b'])
  return (
    <div ref={ref}>
      {(reversed ? ['b', 'a'] : ['a', 'b']).map((key, index) => (
        <div key={key} data-agent-reorder-key={key} data-top={24 * index}>
          {key}
        </div>
      ))}
    </div>
  )
}

it('animates visible rows while a lineage descendant is unmounted', () => {
  const { animate } = setup()
  const view = render(<PartlyHiddenList reversed={false} />)
  view.rerender(<PartlyHiddenList reversed />)
  expect(animate).toHaveBeenCalledTimes(2)
})

function VariableHeightList({ reversed, height }: { reversed: boolean; height: number }) {
  const order = reversed ? ['b', 'a'] : ['a', 'b']
  const ref = useAgentReorderAnimation(order)
  return (
    <div ref={ref}>
      {order.map((key, index) => (
        <div key={key} data-agent-reorder-key={key} data-top={index * height}>
          {key}
        </div>
      ))}
    </div>
  )
}

it('refreshes layout snapshots after rows change height without changing order', () => {
  const { animate } = setup()
  const view = render(<VariableHeightList reversed={false} height={24} />)
  view.rerender(<VariableHeightList reversed={false} height={48} />)
  view.rerender(<VariableHeightList reversed height={48} />)
  expect(animate).toHaveBeenNthCalledWith(
    1,
    [{ translate: '0 48px' }, { translate: '0 0' }],
    expect.anything()
  )
})

function LazyList({ expanded, reversed }: { expanded: boolean; reversed: boolean }) {
  const order = reversed ? ['b', 'a'] : ['a', 'b']
  const ref = useAgentReorderAnimation(order)
  return (
    <div ref={ref}>
      {expanded &&
        order.map((key, index) => (
          <div key={key} data-agent-reorder-key={key} data-top={24 * index}>
            {key}
          </div>
        ))}
    </div>
  )
}

it('measures newly expanded compact rows before their first reorder', () => {
  const { animate } = setup()
  const view = render(<LazyList expanded={false} reversed={false} />)
  view.rerender(<LazyList expanded reversed={false} />)
  expect(animate).not.toHaveBeenCalled()
  view.rerender(<LazyList expanded reversed />)
  expect(animate).toHaveBeenCalledTimes(2)
})
