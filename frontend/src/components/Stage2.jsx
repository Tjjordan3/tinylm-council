import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

function deAnonymizeText(text, labelToModel) {
  if (!labelToModel || !text) return text;
  let result = text;
  Object.entries(labelToModel).forEach(([label, model]) => {
    result = result.replace(new RegExp(label, 'g'), `**${model}**`);
  });
  return result;
}

export default function Stage2({
  rankings,
  labelToModel,
  aggregateRankings,
  rankingParseFailed,
  defaultCollapsed = false,
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (!rankings || rankings.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-gray-800 bg-[#12141c]">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-medium text-gray-200">Stage 2: Peer rankings</span>
        <span className="text-gray-500">{collapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-800 px-4 pb-4">
          <p className="mt-3 text-sm text-gray-400">
            Each member evaluated anonymized responses and ranked them. Names are shown for readability.
          </p>

          {rankingParseFailed && (
            <div className="mt-3 rounded-md bg-amber-900/20 px-3 py-2 text-sm text-amber-300">
              Some rankings could not be parsed reliably. Aggregate scores may use fallback ordering.
            </div>
          )}

          {aggregateRankings?.length > 0 && (
            <div className="mt-3 rounded-md bg-[#0f1117] p-3">
              <div className="mb-2 text-sm font-medium text-gray-300">Aggregate rankings</div>
              {aggregateRankings.map((agg, index) => (
                <div key={agg.model} className="flex items-center justify-between py-1 text-sm">
                  <span className="text-gray-300">
                    #{index + 1} {agg.model}
                  </span>
                  <span className="text-gray-500">
                    avg {agg.average_rank.toFixed(2)} ({agg.rankings_count} votes)
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {rankings.map((rank, index) => (
              <button
                key={rank.member_id || index}
                onClick={() => setActiveTab(index)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  activeTab === index
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {rank.display_name || rank.model}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-md bg-[#0f1117] p-4 markdown-body text-sm text-gray-200">
            <ReactMarkdown>
              {deAnonymizeText(rankings[activeTab].ranking, labelToModel)}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
