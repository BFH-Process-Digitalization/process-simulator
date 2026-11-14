/// <reference types="node" />
import './dom'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { simulate } from '../sim/engine'
import { buildGraph } from '../sim/graph'
import { completeScenario, defaultScenario, resolve, type Project } from '../sim/params'
import { readProject } from '../sim/projectFile'
import { fromProsimos, toProsimos } from '../sim/prosimos'
import { replicationSeed, summarize } from '../sim/replicate'
import type { RngMode } from '../sim/random'
import type { Scenario } from '../sim/types'

declare const __VERSION__: string

const USAGE = `Process Simulator command line

  procsim scenarios <model.bpmn>
  procsim run <model.bpmn> [options]
  procsim prosimos <model.bpmn> [--scenario <id> | --params <file.json>] [--out <params.json>]

Options for run:
  --scenario <id|all>   scenario stored in the model (default: all)
  --params <file.json>  scenario as JSON instead of the stored ones
  --prosimos <file.json> scenario from Prosimos parameters (e.g. discovered by Simod)
  --start <ISO date>    first arrival, with --prosimos
  --reps <n>            replications per scenario (default: the scenario's setting, else 1)
  --seed <n>            base seed (replication i uses a seed derived from it)
  --cases <n>           number of cases
  --warmup <seconds>    leave out cases arriving before this time
  --rng keyed|single    random numbers per case and source (default) or one stream
  --activities          also write per-activity and per-resource numbers
  --max-events <n>      event safety cap per run (default 3000000)
  --out <file.jsonl>    write to a file instead of standard output

Each run is one JSON line with the tool version, hashes of model and scenario, the seed and the results.`

function args(argv: string[]) {
  const pos: string[] = []
  const opt: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) opt[a.slice(2)] = true
      else opt[a.slice(2)] = argv[++i]
    } else pos.push(a)
  }
  return { pos, opt }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)

function load(file: string) {
  const xml = readFileSync(file, 'utf8')
  const { graph } = buildGraph(xml)
  const project: Project = readProject(xml) ?? { baseline: defaultScenario(graph), variants: [] }
  return { xml, graph, project }
}

function scenarios(project: Project, which: string | true | undefined): Scenario[] {
  const all = [project.baseline, ...project.variants.map((v) => resolve(project, v.id))]
  if (!which || which === true || which === 'all') return all
  const s = all.find((x) => x.id === which || x.name === which)
  if (!s) throw new Error(`No scenario "${which}". Available: ${all.map((x) => x.id).join(', ')}`)
  return [s]
}

function main(argv: string[]) {
  const { pos, opt } = args(argv)
  const [cmd, file] = pos
  if (!cmd || opt.help || !file) {
    console.log(USAGE)
    return cmd && file ? 0 : 1
  }
  const { xml, graph, project } = load(file)
  if (cmd === 'scenarios') {
    for (const s of scenarios(project, 'all')) console.log(`${s.id}\t${s.name}`)
    return 0
  }
  if (cmd === 'prosimos') {
    const raw =
      typeof opt.params === 'string'
        ? (JSON.parse(readFileSync(opt.params, 'utf8')) as Scenario)
        : scenarios(project, opt.scenario ?? project.baseline.id)[0]
    const s = completeScenario(graph, raw)
    const out = toProsimos(graph, s)
    for (const u of out.unsupported) console.error(`not exported: ${u}`)
    const json = JSON.stringify(out.params, null, 2)
    if (typeof opt.out === 'string') writeFileSync(opt.out, json)
    else console.log(json)
    return 0
  }
  if (cmd !== 'run') {
    console.error(USAGE)
    return 1
  }
  let list: Scenario[]
  if (typeof opt.prosimos === 'string') {
    const cases = typeof opt.cases === 'string' ? parseInt(opt.cases, 10) : 1000
    const imp = fromProsimos(
      graph,
      JSON.parse(readFileSync(opt.prosimos, 'utf8')) as Record<string, unknown>,
      cases,
      typeof opt.start === 'string' ? opt.start : undefined,
    )
    for (const n of imp.notes) console.error(`approximated: ${n}`)
    list = [imp.scenario]
  } else if (typeof opt.params === 'string') list = [JSON.parse(readFileSync(opt.params, 'utf8')) as Scenario]
  else list = scenarios(project, opt.scenario)
  const rng: RngMode = opt.rng === 'single' ? 'single' : 'keyed'
  const lines: string[] = []
  const modelHash = sha(xml)
  for (const raw of list) {
    let s = completeScenario(graph, raw)
    if (typeof opt.seed === 'string') s = { ...s, seed: parseInt(opt.seed, 10) }
    if (typeof opt.cases === 'string') s = { ...s, cases: parseInt(opt.cases, 10) }
    if (typeof opt.warmup === 'string') s = { ...s, warmup: parseFloat(opt.warmup) }
    const reps = typeof opt.reps === 'string' ? parseInt(opt.reps, 10) : (s.replications ?? 1)
    const scenarioHash = sha(JSON.stringify({ ...s, replications: undefined }))
    for (let i = 0; i < reps; i++) {
      const seed = replicationSeed(s.seed, i)
      const t0 = performance.now()
      const r = simulate(graph, { ...s, seed }, {
        rng,
        traceCases: 0,
        logCases: 0,
        maxEvents: typeof opt['max-events'] === 'string' ? parseInt(opt['max-events'], 10) : undefined,
      })
      const ms = performance.now() - t0
      const rec: Record<string, unknown> = {
        tool: 'process-simulator',
        version: __VERSION__,
        model: file,
        modelHash,
        scenario: s.id,
        scenarioName: s.name,
        scenarioHash,
        replication: i,
        seed,
        rng,
        casesStarted: r.casesStarted,
        wallMs: Math.round(ms * 100) / 100,
        metrics: summarize(r),
        warnings: r.warnings,
      }
      if (opt.activities) {
        rec.activities = r.activities.map((a) => ({ id: a.id, name: a.name, count: a.count, waiting: a.waiting.mean, processing: a.processing.mean }))
        rec.resources = r.resources.map((x) => ({ id: x.id, name: x.name, count: x.count, utilisation: x.utilisation }))
      }
      lines.push(JSON.stringify(rec))
    }
  }
  const text = lines.join('\n') + '\n'
  if (typeof opt.out === 'string') writeFileSync(opt.out, text)
  else process.stdout.write(text)
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
}
