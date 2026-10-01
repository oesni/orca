import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { worktreeRow } from './worktree-row-locators'

for (const mode of ['full', 'compact'] as const) {
  test(`sidebar agents follow a real tab drag (${mode})`, async ({ orcaPage }, testInfo) => {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    const paneKeys = await orcaPage.evaluate(
      ({ worktreeId, mode }) => {
        const store = window.__store
        if (!store) {
          throw new Error('Missing E2E store')
        }
        const state = store.getState()
        state.setAgentActivityDisplayMode(mode)
        store.setState({
          worktreeCardProperties: [...new Set([...state.worktreeCardProperties, 'inline-agents'])]
        })
        while ((store.getState().tabsByWorktree[worktreeId] ?? []).length < 2) {
          store.getState().createTab(worktreeId)
        }
        return (store.getState().tabsByWorktree[worktreeId] ?? []).slice(0, 2).map((tab, index) => {
          const agentType = index === 0 ? 'claude' : 'codex'
          let leaf = store.getState().terminalLayoutsByTabId[tab.id]?.root
          while (leaf?.type === 'split') {
            leaf = leaf.first
          }
          if (leaf?.type !== 'leaf') {
            throw new Error('Missing terminal leaf')
          }
          const paneKey = `${tab.id}:${leaf.leafId}`
          state.setTabCustomTitle(tab.id, index === 0 ? 'Claude order proof' : 'Codex order proof')
          state.setAgentStatus(
            paneKey,
            { state: 'working', agentType, prompt: `${agentType} task` },
            agentType,
            { updatedAt: Date.now(), stateStartedAt: Date.now() - index * 1000 }
          )
          return paneKey
        })
      },
      { worktreeId, mode }
    )

    const card = worktreeRow(orcaPage, worktreeId)
    if (mode === 'compact') {
      await card.locator('button.compact-agent-summary-button').click()
    }
    const rows = card.locator('[data-agent-reorder-key]')
    await expect(rows).toHaveCount(2)
    await expect
      .poll(() =>
        rows.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-agent-reorder-key'))
        )
      )
      .toEqual(paneKeys)
    await testInfo.attach(`${mode}-before`, {
      body: await orcaPage.screenshot(),
      contentType: 'image/png'
    })

    const first = orcaPage
      .locator('[data-testid="sortable-tab"]')
      .filter({ hasText: 'Claude order proof' })
    const second = orcaPage
      .locator('[data-testid="sortable-tab"]')
      .filter({ hasText: 'Codex order proof' })
    const from = await first.boundingBox()
    const to = await second.boundingBox()
    if (!from || !to) {
      throw new Error('Tab strip was not rendered')
    }
    await orcaPage.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await orcaPage.mouse.down()
    await orcaPage.mouse.move(to.x + to.width * 0.8, to.y + to.height / 2, { steps: 8 })
    await orcaPage.mouse.up()

    await expect
      .poll(() =>
        rows.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-agent-reorder-key'))
        )
      )
      .toEqual(paneKeys.toReversed())
    await expect
      .poll(() =>
        orcaPage
          .locator('[data-testid="sortable-tab"]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-tab-title')))
      )
      .toEqual(['Codex order proof', 'Claude order proof'])
    await rows.filter({ hasText: 'Claude order proof' }).click()
    await expect(first).toHaveAttribute('data-active', 'true')
    await testInfo.attach(`${mode}-after`, {
      body: await orcaPage.screenshot(),
      contentType: 'image/png'
    })
  })
}
