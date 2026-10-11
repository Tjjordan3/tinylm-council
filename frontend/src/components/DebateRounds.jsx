import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

export default function DebateRounds({
  rounds,
  labelToModel,
  defaultCollapsed = false,
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [activeRound, setActiveRound] = useState(0);
  const [activeMember, setActiveMember] = useState(0);

  useEffect(() => {
    if (defaultCollapsed) setCollapsed(true);
  }, [defaultCollapsed]);

  if (!rounds || rounds.length === 0) return null;

  const roundIndex = Math.min(activeRound, rounds.length - 1);
  const currentRound = rounds[roundIndex];
  const results = currentRound?.results || [];
  const memberIndex = Math.min(activeMember, Math.max(0, results.length - 1));
  const current = results[memberIndex];

  return (
    <div className="mb-4 rounded-lg border border-gray-800 bg-[#12141c]">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-medium text-gray-200">
          Stage 2: Debate ({rounds.length} round{rounds.length === 1 ? '' : 's'})
        </span>
        <span className="text-gray-500">{collapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-800 px-4 pb-4">
          <p className="mt-3 text-sm text-gray-400">
            Members rebutted each other anonymously, then revised their positions. Labels are
            shown with model names for readability.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {rounds.map((round, index) => (
              <button
                key={round.round ?? index}
                type="button"
                onClick={() => {
                  setActiveRound(index);
                  setActiveMember(0);
                }}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  roundIndex === index
                    ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                Round {round.round ?? index + 1}
              </button>
            ))}
          </div>

          {results.length > 0 && (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {results.map((result, index) => (
                  <button
                    key={result.member_id || index}
                    type="button"
                    onClick={() => setActiveMember(index)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      memberIndex === index
                        ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                        : result.success === false || result.error
                          ? 'bg-red-900/40 text-red-300'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {result.display_name || result.model}
                    {result.label ? ` (${result.label})` : ''}
                  </button>
                ))}
              </div>

              {current && (
                <div className="mt-3 rounded-md bg-[#0f1117] p-3">
                  <div className="mb-2 text-sm font-medium text-gray-300">
                    {current.display_name || current.model}
                    {current.label && labelToModel?.[current.label]
                      ? ` — ${current.label}`
                      : current.label
                        ? ` — ${current.label}`
                        : ''}
                  </div>
                  {current.error && !current.response ? (
                    <p className="text-sm text-red-300">{current.error}</p>
                  ) : (
                    <div className="prose prose-invert max-w-none text-sm text-gray-200">
                      <ReactMarkdown>{current.response || ''}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
