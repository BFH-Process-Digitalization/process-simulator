import type { ActivityInterval, ActivityStat, FlowTime, SimResult, ValueClass } from "./types";

export const VALUE_LABEL: Record<ValueClass, string> = {
  va: "Value-adding",
  bva: "Business value-adding",
  nva: "Waste",
};

export interface StreamStep {
  activity: ActivityStat;
  /** Working and waiting time this step adds to an average case (runs per case × time per run). */
  work: number;
  wait: number;
  utilisation?: number;
  bottleneck: boolean;
  /** False for steps on a parallel branch that finishes before the longest one. */
  critical: boolean;
}

/** One step, or several branches that run at the same time for a case. */
export interface StreamStage {
  branches: StreamStep[][];
  /** Branch that takes longest on average; only this one adds to the lead time. */
  critical: number;
  work: number;
  wait: number;
  /** Per branch: how much earlier than the critical branch it finishes. */
  slack: number[];
}

export interface ValueStream {
  steps: StreamStep[];
  stages: StreamStage[];
  leadTime: number;
  /** Waiting on the critical path. */
  waiting: number;
  /** Working time on the critical path by class. */
  work: Record<ValueClass | "none", number>;
  /** Working time on parallel branches off the critical path. */
  parallelWork: number;
  /** Lead time split into value-adding, business value-adding, rework, waste, unclassified work and waiting; parallel work counts once. */
  flow: FlowTime;
  /** Value-adding share of the lead time (flow.va / leadTime). */
  efficiency: number;
  /** What a linear value stream map would show: the sum of all step times per case. */
  linearLeadTime: number;
  classified: boolean;
  parallel: boolean;
}

/** Share of cases in which two activities were under way at the same time, among cases that ran both. */
export const PARALLEL_SHARE = 0.5;

function concurrency(intervals: ActivityInterval[]) {
  const byCase = new Map<number, Map<string, ActivityInterval[]>>();
  for (const iv of intervals) {
    let c = byCase.get(iv.caseId);
    if (!c) byCase.set(iv.caseId, (c = new Map()));
    const list = c.get(iv.node) ?? [];
    list.push(iv);
    c.set(iv.node, list);
  }
  const both = new Map<string, number>();
  const overlap = new Map<string, number>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const c of byCase.values()) {
    const nodes = [...c.keys()];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const k = key(nodes[i], nodes[j]);
        both.set(k, (both.get(k) ?? 0) + 1);
        const hit = c
          .get(nodes[i])!
          .some((x) => c.get(nodes[j])!.some((y) => Math.max(x.arrive, y.arrive) < Math.min(x.end, y.end)));
        if (hit) overlap.set(k, (overlap.get(k) ?? 0) + 1);
      }
  }
  return (a: string, b: string) => {
    const k = key(a, b);
    const n = both.get(k) ?? 0;
    return n > 0 && (overlap.get(k) ?? 0) / n >= PARALLEL_SHARE;
  };
}

/** Groups steps into stages: steps that run at the same time for a case form parallel branches of one stage. */
function stagesOf(steps: StreamStep[], parallel: (a: string, b: string) => boolean): StreamStage[] {
  const groups: StreamStep[][] = [];
  for (const s of steps) {
    const last = groups[groups.length - 1];
    if (last && last.some((x) => parallel(x.activity.id, s.activity.id))) last.push(s);
    else groups.push([s]);
  }
  return groups.map((g) => {
    const branches: StreamStep[][] = [];
    for (const s of g) {
      const b = branches.find((br) => br.every((x) => !parallel(x.activity.id, s.activity.id)));
      if (b) b.push(s);
      else branches.push([s]);
    }
    const time = branches.map((b) => b.reduce((a, s) => a + s.work + s.wait, 0));
    const critical = time.indexOf(Math.max(...time));
    branches.forEach((b, i) => b.forEach((s) => (s.critical = i === critical)));
    return {
      branches,
      critical,
      work: branches[critical].reduce((a, s) => a + s.work, 0),
      wait: branches[critical].reduce((a, s) => a + s.wait, 0),
      slack: time.map((t) => time[critical] - t),
    };
  });
}

/**
 * Activities in the order cases reach them, with the time each adds per case.
 * As in a classic value stream map, parallel branches are stacked and only the longest one counts towards the lead time.
 */
export function valueStream(r: SimResult): ValueStream {
  const cases = r.casesCompleted || r.casesStarted || 1;
  const first = new Map<number, number>();
  for (const iv of r.intervals)
    first.set(iv.caseId, Math.min(first.get(iv.caseId) ?? Infinity, iv.arrive));
  const reach = new Map<string, { sum: number; n: number }>();
  for (const iv of r.intervals) {
    const x = reach.get(iv.node) ?? { sum: 0, n: 0 };
    x.sum += iv.arrive - first.get(iv.caseId)!;
    x.n++;
    reach.set(iv.node, x);
  }
  const at = (id: string) => {
    const x = reach.get(id);
    return x ? x.sum / x.n : Infinity;
  };
  const maxWait = Math.max(0, ...r.activities.map((a) => a.waiting.mean));
  const steps: StreamStep[] = r.activities
    .filter((a) => a.count > 0)
    .sort((a, b) => at(a.id) - at(b.id))
    .map((a) => ({
      activity: a,
      work: (a.processing.mean * a.count) / cases,
      wait: (a.waiting.mean * a.count) / cases,
      utilisation: r.resources.find((x) => x.id === a.resourceId)?.utilisation,
      bottleneck: maxWait > 0 && a.waiting.mean === maxWait,
      critical: true,
    }));
  const stages = stagesOf(steps, concurrency(r.intervals));
  const work = { va: 0, bva: 0, nva: 0, none: 0 };
  let waiting = 0;
  let parallelWork = 0;
  for (const s of steps) {
    if (s.critical) {
      work[s.activity.value ?? "none"] += s.work;
      waiting += s.wait;
    } else parallelWork += s.work;
  }
  const leadTime = r.cycle.mean;
  const linearLeadTime = steps.reduce((a, s) => a + s.work + s.wait, 0);
  return {
    steps,
    stages,
    leadTime,
    waiting,
    work,
    parallelWork,
    flow: r.flow,
    efficiency: leadTime > 0 ? Math.min(1, r.flow.va / leadTime) : 0,
    linearLeadTime,
    classified: steps.some((s) => s.activity.value),
    parallel: stages.some((s) => s.branches.length > 1),
  };
}
