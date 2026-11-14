import { describe, expect, it } from "vitest";
import type { ActivityStat, SimResult, Stats } from "../types";
import { valueStream } from "../value";
import { simulate } from "../engine";
import { fixed, graphOf, scenario } from "./helpers";

const seq = (id: string, s: string, t: string) =>
  `<bpmn:sequenceFlow id="${id}" sourceRef="${s}" targetRef="${t}"/>`;

const st = (mean: number) => ({ mean }) as Stats;
const act = (
  id: string,
  wait: number,
  work: number,
  count: number,
  value?: ActivityStat["value"],
): ActivityStat => ({
  id,
  name: id,
  count,
  waiting: st(wait),
  processing: st(work),
  cost: 0,
  revenue: 0,
  balked: 0,
  value,
});

describe("valueStream", () => {
  const r = {
    casesCompleted: 2,
    casesStarted: 2,
    cycle: st(100),
    waiting: st(40),
    activities: [
      act("pack", 30, 10, 2, "nva"),
      act("make", 10, 20, 2, "va"),
      act("check", 0, 30, 1, "bva"),
    ],
    resources: [],
    flow: { va: 20, bva: 15, nva: 10, rework: 0, none: 0, wait: 55 },
    intervals: [
      { node: "make", caseId: 1, arrive: 0, start: 0, end: 20 },
      { node: "pack", caseId: 1, arrive: 20, start: 50, end: 60 },
      { node: "make", caseId: 2, arrive: 5, start: 25, end: 45 },
      { node: "check", caseId: 2, arrive: 45, start: 45, end: 75 },
      { node: "pack", caseId: 2, arrive: 75, start: 105, end: 115 },
    ],
  } as unknown as SimResult;

  it("orders steps by when cases reach them and weights times per case", () => {
    const vs = valueStream(r);
    expect(vs.steps.map((s) => s.activity.id)).toEqual([
      "make",
      "check",
      "pack",
    ]);
    expect(vs.steps[1].work).toBe(15);
    expect(vs.work).toEqual({ va: 20, bva: 15, nva: 10, none: 0 });
    expect(vs.efficiency).toBeCloseTo(0.2);
    expect(vs.linearLeadTime).toBeCloseTo(85);
    expect(vs.steps.find((s) => s.bottleneck)?.activity.id).toBe("pack");
    expect(vs.classified).toBe(true);
  });
});

describe("valueStream with parallel branches", () => {
  const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:parallelGateway id="p1"/>
    <bpmn:task id="a1" name="A1"/><bpmn:task id="a2" name="A2"/><bpmn:task id="b" name="B"/>
    <bpmn:parallelGateway id="p2"/><bpmn:task id="c" name="C"/><bpmn:endEvent id="e"/>
    ${seq("f1", "s", "p1")}${seq("f2", "p1", "a1")}${seq("f3", "a1", "a2")}${seq("f4", "a2", "p2")}
    ${seq("f5", "p1", "b")}${seq("f6", "b", "p2")}${seq("f7", "p2", "c")}${seq("f8", "c", "e")}`);
  const r = simulate(
    g,
    scenario({
      elements: {
        a1: { duration: fixed(600), value: "va" },
        a2: { duration: fixed(600), value: "nva" },
        b: { duration: fixed(3600), value: "va" },
        c: { duration: fixed(300), value: "bva" },
      },
    }),
  );

  it("stacks steps that run at the same time and counts only the longest branch", () => {
    const vs = valueStream(r);
    expect(vs.parallel).toBe(true);
    expect(vs.stages.map((s) => s.branches.map((b) => b.map((x) => x.activity.id)))).toEqual([
      [["a1", "a2"], ["b"]],
      [["c"]],
    ]);
    expect(vs.stages[0].critical).toBe(1);
    expect(vs.stages[0].slack[0]).toBeCloseTo(2400);
    expect(vs.work).toEqual({ va: 3600, bva: 300, nva: 0, none: 0 });
    expect(vs.parallelWork).toBeCloseTo(1200);
    expect(vs.leadTime).toBeCloseTo(3900);
    expect(vs.efficiency).toBeCloseTo(3600 / 3900);
    expect(vs.flow.va).toBeCloseTo(3600);
    expect(vs.flow.nva).toBeCloseTo(0);
    expect(vs.flow.bva).toBeCloseTo(300);
  });
});
