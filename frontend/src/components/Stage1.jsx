import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

export default function Stage1({ responses, allResults, defaultCollapsed = false }) {
  const [activeTab, setActiveTab] = useState(0);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const displayResponses =
    responses?.length > 0
      ? responses
      : (allResults || []).filter((result) => result.success);

  if (displayResponses.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-gray-800 bg-[#12141c]">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-medium text-gray-200">Stage 1: Individual responses</span>
        <span className="text-gray-500">{collapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-800 px-4 pb-4">
          {allResults?.some((r) => !r.success) && (
            <div className="mt-3 rounded-md bg-red-900/20 px-3 py-2 text-sm text-red-300">
              Some members failed:{' '}
              {allResults
                .filter((r) => !r.success)
                .map((r) => r.display_name)
                .join(', ')}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {displayResponses.map((resp, index) => (
              <button
                key={resp.member_id || index}
                onClick={() => setActiveTab(index)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  activeTab === index
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {resp.display_name || resp.model}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-md bg-[#0f1117] p-4">
            <div className="mb-2 text-xs text-gray-500">{displayResponses[activeTab].model}</div>
            <div className="markdown-body text-sm text-gray-200">
              <ReactMarkdown>{displayResponses[activeTab].response}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
