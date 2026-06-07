export default function StageProgress({ loading, stage1Done, stage2Done, stage3Done, memberStatuses }) {
  const stages = [
    { key: 'stage1', label: 'First opinions', active: loading?.stage1, done: stage1Done },
    { key: 'stage2', label: 'Peer review', active: loading?.stage2, done: stage2Done },
    { key: 'stage3', label: 'Final answer', active: loading?.stage3, done: stage3Done },
  ];

  return (
    <div className="mb-4 rounded-lg border border-gray-800 bg-[#12141c] p-4">
      <div className="flex items-center gap-2">
        {stages.map((stage, index) => (
          <div key={stage.key} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                stage.done
                  ? 'bg-green-600 text-white'
                  : stage.active
                    ? 'bg-indigo-600 text-white animate-pulse'
                    : 'bg-gray-700 text-gray-300'
              }`}
            >
              {stage.done ? '✓' : index + 1}
            </div>
            <span className={`text-sm ${stage.active ? 'text-white' : 'text-gray-400'}`}>
              {stage.label}
            </span>
            {index < stages.length - 1 && <div className="mx-2 h-px w-8 bg-gray-700" />}
          </div>
        ))}
      </div>

      {memberStatuses && Object.keys(memberStatuses).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(memberStatuses).map(([id, info]) => (
            <span
              key={id}
              className={`rounded-full px-2.5 py-1 text-xs ${
                info.status === 'done'
                  ? 'bg-green-900/50 text-green-300'
                  : info.status === 'failed'
                    ? 'bg-red-900/50 text-red-300'
                    : info.status === 'waiting'
                      ? 'bg-gray-800 text-gray-400'
                      : 'bg-indigo-900/50 text-indigo-300'
              }`}
            >
              {info.display_name || info.model}
              {info.status === 'failed' && ' (failed)'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
