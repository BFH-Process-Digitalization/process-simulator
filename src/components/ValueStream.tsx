import { formatDuration } from "../sim/time";
import type { SimResult } from "../sim/types";
import { VALUE_LABEL, valueStream, type StreamStep } from "../sim/value";

const HOT = 0.85;

function Step({
  s,
  result,
  ladder,
  onSelectActivity,
}: {
  s: StreamStep;
  result: SimResult;
  ladder: boolean;
  onSelectActivity: (id: string) => void;
}) {
  const hot = s.bottleneck || (s.utilisation ?? 0) >= HOT;
  const role = result.resources.find((x) => x.id === s.activity.resourceId);
  const line = ladder ? "" : " flat";
  return (
    <div className="vs-step">
      <div className="vs-wait" title="Average waiting per case before this step">
        <span className={"vs-tri" + (s.bottleneck ? " hot" : "")} />
        <span className={"vs-up" + line}>{formatDuration(s.wait)}</span>
      </div>
      <div className="vs-col">
        <button
          className={"vs-box " + (s.activity.value ?? "none") + (hot ? " bn" : "")}
          onClick={() => onSelectActivity(s.activity.id)}
          title="Show this activity in the diagram"
        >
          <span className="vs-name">{s.activity.name}</span>
          <span className="vs-tag">
            {s.activity.value ? VALUE_LABEL[s.activity.value] : "Not classified"}
          </span>
          <span>{formatDuration(s.activity.processing.mean)} per run</span>
          {role && (
            <span>
              {role.name} · {Math.round(role.utilisation * 100)} % busy
            </span>
          )}
          {s.bottleneck && <span className="vs-bn">Bottleneck</span>}
        </button>
        <span className={"vs-down" + line}>{formatDuration(s.work)}</span>
      </div>
    </div>
  );
}

export default function ValueStream({
  result,
  onSelectActivity,
}: {
  result: SimResult;
  onSelectActivity: (id: string) => void;
}) {
  const vs = valueStream(result);
  if (!vs.steps.length)
    return <p className="hint">No task ran in this simulation.</p>;
  const lead = vs.leadTime || 1;
  const pct = (v: number) => `${Math.min(100, (v / lead) * 100)}%`;
  const f = vs.flow;
  const waste = f.nva + f.rework + f.wait;
  const overlap = vs.linearLeadTime - vs.leadTime;
  return (
    <section className="block vs">
      <h3>Value stream</h3>
      <div className="vs-kpis">
        <span>
          Lead time<b>{formatDuration(vs.leadTime)}</b>
        </span>
        <span>
          Value-adding<b>{formatDuration(f.va)}</b>
        </span>
        <span title="Value-adding share of the lead time; time in which parallel branches work at once counts once">
          Process cycle efficiency
          <b>{vs.classified ? `${Math.round(vs.efficiency * 100)} %` : "–"}</b>
        </span>
        <span title="Waiting, rework and work classified as waste">
          Waste incl. waiting
          <b>{Math.round(Math.min(1, waste / lead) * 100)} %</b>
        </span>
        {vs.parallel && (
          <span title="Working time on parallel branches that finish before the longest one. It costs effort but does not lengthen the lead time.">
            Parallel work off the critical path
            <b>{formatDuration(vs.parallelWork)}</b>
          </span>
        )}
      </div>
      <div className="split" title="Average time per case">
        <span className="va" style={{ width: pct(f.va) }} />
        <span className="bva" style={{ width: pct(f.bva) }} />
        <span className="rework" style={{ width: pct(f.rework) }} />
        <span className="nva" style={{ width: pct(f.nva) }} />
        <span className="none" style={{ width: pct(f.none) }} />
        <span className="wait" style={{ width: pct(f.wait) }} />
      </div>
      <div className="legend">
        <span>
          <i className="va" /> {VALUE_LABEL.va} {formatDuration(f.va)}
        </span>
        <span>
          <i className="bva" /> {VALUE_LABEL.bva} {formatDuration(f.bva)}
        </span>
        <span>
          <i className="nva" /> {VALUE_LABEL.nva} {formatDuration(f.nva)}
        </span>
        {f.rework > 0 && (
          <span>
            <i className="rework" /> Rework {formatDuration(f.rework)}
          </span>
        )}
        {f.none > 0 && (
          <span>
            <i className="none" /> Not classified {formatDuration(f.none)}
          </span>
        )}
        <span>
          <i className="wait" /> Waiting {formatDuration(f.wait)}
        </span>
      </div>
      {!vs.classified && (
        <p className="hint">
          Click a task in the diagram and set whether it adds value, is needed
          for the business, or is waste.
        </p>
      )}
      <div className="vs-flow">
        {vs.stages.map((st) =>
          st.branches.length === 1 ? (
            <Step
              key={st.branches[0][0].activity.id}
              s={st.branches[0][0]}
              result={result}
              ladder
              onSelectActivity={onSelectActivity}
            />
          ) : (
            <div className="vs-par" key={st.branches[0][0].activity.id}>
              <div className="vs-par-label">
                Parallel · {st.branches.length} branches
              </div>
              {st.branches.map((b, i) => (
                <div
                  className={"vs-branch" + (i === st.critical ? " crit" : "")}
                  key={b[0].activity.id}
                >
                  {b.map((s) => (
                    <Step
                      key={s.activity.id}
                      s={s}
                      result={result}
                      ladder={false}
                      onSelectActivity={onSelectActivity}
                    />
                  ))}
                  <span className="vs-slack">
                    {i === st.critical
                      ? "Critical path"
                      : `Done ${formatDuration(st.slack[i])} earlier`}
                  </span>
                </div>
              ))}
              <div className="vs-ladder" title="Waiting and working time of the critical branch, per case">
                <span className="vs-up">{formatDuration(st.wait)}</span>
                <span className="vs-down">{formatDuration(st.work)}</span>
              </div>
            </div>
          ),
        )}
      </div>
      <p className="hint">
        Upper line: waiting per case. Lower line: working time per case. Times
        are averages per case, so steps on alternative paths count by how often
        they run. The bar splits the lead time: time in which parallel branches
        work at once counts once, repeated runs of a step count as rework, and
        time without any work counts as waiting.
        {vs.parallel &&
          " Steps that run at the same time are stacked; the longest branch is marked as the critical path."}
      </p>
      {overlap > 60 && (
        <p className="hint">
          Adding up the steps gives {formatDuration(vs.linearLeadTime)}, more
          than the lead time, because branches run in parallel.
        </p>
      )}
    </section>
  );
}
