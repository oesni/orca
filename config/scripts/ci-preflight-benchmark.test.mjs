import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { stringify } from 'yaml'
import { runProcessSync } from './script-child-process.mjs'

it.each([0, 9])('does not lose a background failure with exit code %i', (code) => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-preflight-benchmark-'))
  try {
    mkdirSync(join(directory, 'ci-shards'))
    mkdirSync(join(directory, 'config'))
    writeFileSync(join(directory, 'ci-shards/unit-selection.json'), '{}')
    const workflow = join(directory, 'workflow.yml')
    const steps = [
      { name: 'Background check', id: 'check', background: true, run: `exit ${code}` },
      { run: 'true' },
      { wait: 'check' }
    ]
    writeFileSync(
      workflow,
      stringify({
        jobs: {
          baseline_static: { steps },
          baseline_types: { steps: [] },
          baseline_plan_before: { steps: [] },
          combined: { steps }
        }
      })
    )
    const result = runProcessSync({
      program: process.execPath,
      args: [fileURLToPath(new URL('./ci-preflight-benchmark.mjs', import.meta.url))],
      cwd: directory,
      env: {
        ...process.env,
        RUNNER_TEMP: directory,
        BASE_SHA: 'a'.repeat(40),
        BENCHMARK_SAMPLES: '1',
        BENCHMARK_WORKFLOW: workflow,
        ORCA_BACKGROUND_LAUNCH: '1'
      }
    })
    expect(result.code, result.stderr).toBe(code === 0 ? 0 : 1)
    const results = JSON.parse(
      readFileSync(join(directory, 'preflight-comparison/results.json'), 'utf8')
    )
    expect(results[0].rows[0].code).toBe(code)
    expect(results).toHaveLength(code === 0 ? 2 : 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
