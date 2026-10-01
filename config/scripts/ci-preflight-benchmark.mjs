import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  cpSync,
  createWriteStream,
  globSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parse } from 'yaml'
import { spawnProcess } from './script-child-process.mjs'

assert(process.platform !== 'win32', 'This hosted comparison requires a POSIX shell')
const workflow = parse(
  readFileSync(
    process.env.BENCHMARK_WORKFLOW ?? '.github/workflows/ci-concurrency-pilot.yml',
    'utf8'
  )
)
const directory = join(process.env.RUNNER_TEMP, 'preflight-comparison')
mkdirSync(directory, { recursive: true })
const snapshot = join(directory, 'typescript-state')
mkdirSync(snapshot, { recursive: true })
for (const file of globSync('config/*.tsbuildinfo')) {
  cpSync(file, join(snapshot, file.slice(7)))
}
const results = []
const samples = Number(process.env.BENCHMARK_SAMPLES ?? 2)
assert(Number.isInteger(samples) && samples > 0 && samples <= 3)
const variants = (process.env.BENCHMARK_VARIANTS ?? 'baseline,combined').split(',')
assert(
  variants.length === 2 &&
    variants.every((name) => ['baseline', 'combined', 'early'].includes(name))
)
const cold = process.env.BENCHMARK_COLD_TYPES === 'true'
const base = process.env.BASE_SHA
assert(/^[a-f0-9]{40}$/.test(base), 'A full PR base SHA is required')

function resetTypes() {
  for (const file of globSync('config/*.tsbuildinfo')) {
    rmSync(file)
  }
  if (!cold) {
    for (const file of globSync('*.tsbuildinfo', { cwd: snapshot })) {
      cpSync(join(snapshot, file), join('config', file))
    }
  }
}

async function measure(variant, sample) {
  resetTypes()
  const started = performance.now()
  const rows = []
  const background = new Map()
  const staticSteps = workflow.jobs.baseline_static.steps
  const steps =
    variant !== 'baseline'
      ? workflow.jobs[variant].steps
      : [
          ...staticSteps,
          ...workflow.jobs.baseline_types.steps,
          ...workflow.jobs.baseline_plan_before.steps
        ]
  const start = (step) => {
    const name = step.name ?? step.run
    const startMs = performance.now()
    const log = createWriteStream(join(directory, `${sample}-${variant}-${rows.length}.log`))
    const row = { name }
    rows.push(row)
    const command = step.run.replaceAll('${{ github.event.pull_request.base.sha }}', base)
    const env = {
      ...process.env,
      ...step.env,
      BASE_SHA: base,
      GITHUB_OUTPUT: join(directory, 'outputs'),
      GITHUB_STEP_SUMMARY: join(directory, 'summaries')
    }
    assert(!command.includes('${{'), `Unexpanded expression in ${name}`)
    const child = spawnProcess({ program: 'bash', args: ['-eo', 'pipefail', '-c', command], env })
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    return new Promise((resolve) => {
      child.on('error', () => {
        row.code = null
        resolve(row)
      })
      child.on('close', (code, signal) => {
        log.end()
        row.milliseconds = Math.round(performance.now() - startMs)
        row.code = code
        row.signal = signal
        resolve(row)
      })
    })
  }
  for (const step of steps) {
    if (step.wait) {
      for (const id of [step.wait].flat()) {
        await background.get(id)
      }
    } else if (step.run) {
      const promise = start(step)
      if (step.background) {
        background.set(step.id, promise)
      } else {
        await promise
      }
    }
  }
  await Promise.all(background.values())
  const plan = readFileSync('ci-shards/unit-selection.json')
  const result = {
    variant,
    sample,
    cold,
    milliseconds: Math.round(performance.now() - started),
    planSha256: createHash('sha256').update(plan).digest('hex'),
    rows
  }
  results.push(result)
  writeFileSync(join(directory, 'results.json'), JSON.stringify(results, null, 2))
  assert(
    rows.every((row) => row.code === 0),
    `${variant}: a check failed; see per-step logs`
  )
  console.log(
    JSON.stringify({
      variant,
      sample,
      cold,
      milliseconds: result.milliseconds,
      planSha256: result.planSha256
    })
  )
}

for (let sample = 1; sample <= samples; sample++) {
  for (const variant of sample % 2 ? variants : variants.toReversed()) {
    await measure(variant, sample)
  }
}
assert(new Set(results.map((result) => result.planSha256)).size === 1, 'Planning outputs differ')
