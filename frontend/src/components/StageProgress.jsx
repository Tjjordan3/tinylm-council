import { useEffect, useState } from 'react';

function formatElapsed(ms) {
  if (ms == null || ms < 0) return null;
  const sec = Math.floor(ms / 1000);
  return `${sec}s`;
}

export default function StageProgress({
  loading,
  stage1Done,
  stage2Done,
  stage3Done,
  memberStatuses,
  deliberationMode = 'rank',
  runMode = 'full',
  stageStartedAt,
  debateEarlyExit = false,
}) {
  const mode = deliberationMode === 'debate' ? 'debate' : 'rank';
  const quick = runMode === 'quick';
  let middleLabel = quick ? 'Skipped' : mode === 'debate' ? 'Debate' : 'Peer review';
  if (!quick && mode === 'debate' && debateEarlyExit && stage2Done) {
    middleLabel = 'Debate (converged)';
  }
  const stages = [
    { key: 'stage1', label: 'First opinions', active: loading?.stage1, done: stage1Done },
    {
      key: 'stage2',
      label: middleLabel,
      active: !quick && (loading?.stage2 || loading?.debate),
      done: quick ? stage1Done : stage2Done,
      skipped: quick,
    },
    { key: 'stage3', label: 'Final answer', active: loading?.stage3, done: stage3Done },
  ];

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const anyActive = stages.some((s) => s.active);
    if (!anyActive) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [loading?.stage1, loading?.stage2, loading?.debate, loading?.stage3]);

  const activeKey = stages.find((s) => s.active)?.key;
  const started =
    activeKey === 'stage1'
      ? stageStartedAt?.stage1
      : activeKey === 'stage2'
        ? stageStartedAt?.stage2
        : activeKey === 'stage3'
          ? stageStartedAt?.stage3
          : null;
  const elapsed = started ? formatElapsed(now - started) : null;

  return (
    <div className="stage-progress mb-5">
      <div className="stage-rail" role="list">
        {stages.map((stage, index) => (
          <div key={stage.key} className="stage-rail-item" role="listitem">
            <div
              className={`stage-node ${
                stage.done ? 'is-done' : stage.active ? 'is-active' : stage.skipped ? 'is-skipped' : ''
              }`}
            >
              {stage.done ? '✓' : stage.skipped ? '–' : index + 1}
            </div>
            <div className="stage-meta">
              <span className={`stage-label ${stage.active ? 'text-ink' : ''}`}>{stage.label}</span>
              {stage.active && elapsed && <span className="stage-elapsed">{elapsed}</span>}
            </div>
            {index < stages.length - 1 && <div className="stage-connector" aria-hidden="true" />}
          </div>
        ))}
      </div>

      {memberStatuses && Object.keys(memberStatuses).length > 0 && (
        <div className="member-status-row mt-3">
          {Object.entries(memberStatuses).map(([id, info]) => (
            <span
              key={id}
              className={`member-dot ${
                info.status === 'done'
                  ? 'is-done'
                  : info.status === 'failed'
                    ? 'is-failed'
                    : info.status === 'running'
                      ? 'is-running'
                      : 'is-waiting'
              }`}
            >
              <i aria-hidden="true" />
              {info.display_name || info.model}
              {info.status === 'failed' ? ' (failed)' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
