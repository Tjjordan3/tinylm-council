import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

export default function SharedDraftRounds({
  rounds,
  labelToModel,
  earlyExit = false,
  defaultCollapsed = false,
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [activeRound, setActiveRound] = useState(0);
  const [showEdits, setShowEdits] = useState(false);
  const [activeEdit, setActiveEdit] = useState(0);

  useEffect(() => {
    if (defaultCollapsed) setCollapsed(true);
  }, [defaultCollapsed]);

  useEffect(() => {
    if (rounds?.length) {
      setActiveRound(rounds.length - 1);
    }
  }, [rounds?.length]);

  if (!rounds || rounds.length === 0) return null;

  const roundIndex = Math.min(activeRound, rounds.length - 1);
  const currentRound = rounds[roundIndex];
  const edits = currentRound?.edits || [];
  const editIndex = Math.min(activeEdit, Math.max(0, edits.length - 1));
  const currentEdit = edits[editIndex];
  const currentDraft = currentRound?.draft || '';

  return (
    <div className="mb-4 rounded-lg border border-gray-800 bg-[#12141c]">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex flex-wrap items-center gap-2 font-medium text-gray-200">
          Stage 2: Joint draft ({rounds.length} round{rounds.length === 1 ? '' : 's'})
          {earlyExit && (
            <span className="rounded bg-emerald-900/50 px-2 py-0.5 text-xs font-normal text-emerald-300">
              Draft stabilized
            </span>
          )}
        </span>
        <span className="text-gray-500">{collapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-800 px-4 pb-4">
          <p className="mt-3 text-sm text-gray-400">
            Members suggested revisions against one shared draft; an editor merged them each
            round.
            {earlyExit
              ? ' Rounds stopped early once consecutive drafts agreed closely enough.'
              : ''}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {rounds.map((round, index) => (
              <button
                key={round.round ?? index}
                type="button"
                onClick={() => {
                  setActiveRound(index);
                  setActiveEdit(0);
                  setShowEdits(false);
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

          <div className="mt-3 rounded-md bg-[#0f1117] p-3">
            <div className="mb-2 text-sm font-medium text-gray-300">Shared draft</div>
            <div className="prose prose-invert max-w-none text-sm text-gray-200">
              <ReactMarkdown>{currentDraft || '_Empty draft_'}</ReactMarkdown>
            </div>
          </div>

          {edits.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowEdits((prev) => !prev)}
                className="text-sm text-gray-400 hover:text-gray-200"
              >
                {showEdits ? 'Hide' : 'Show'} peer suggestions ({edits.length})
              </button>

              {showEdits && (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {edits.map((edit, index) => (
                      <button
                        key={edit.member_id || index}
                        type="button"
                        onClick={() => setActiveEdit(index)}
                        className={`rounded-full px-3 py-1 text-xs ${
                          editIndex === index
                            ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                            : edit.success === false || edit.error
                              ? 'bg-red-900/40 text-red-300'
                              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        {edit.display_name || edit.model}
                        {edit.label ? ` (${edit.label})` : ''}
                      </button>
                    ))}
                  </div>

                  {currentEdit && (
                    <div className="mt-3 rounded-md bg-[#0f1117] p-3">
                      <div className="mb-2 text-sm font-medium text-gray-300">
                        {currentEdit.display_name || currentEdit.model}
                        {currentEdit.label && labelToModel?.[currentEdit.label]
                          ? ` — ${currentEdit.label}`
                          : currentEdit.label
                            ? ` — ${currentEdit.label}`
                            : ''}
                      </div>
                      {currentEdit.error && !currentEdit.response ? (
                        <p className="text-sm text-red-300">{currentEdit.error}</p>
                      ) : (
                        <div className="prose prose-invert max-w-none text-sm text-gray-200">
                          <ReactMarkdown>{currentEdit.response || ''}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
