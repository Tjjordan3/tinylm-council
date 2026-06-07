import { useState } from 'react';

export default function WebSources({ webSearch, loading }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!webSearch && !loading?.webSearch) return null;

  const sources = webSearch?.sources || [];
  const error = webSearch?.error;
  const query = webSearch?.query;
  const isSearching = loading?.webSearch && !webSearch;

  return (
    <div className="mb-4 rounded-lg border border-gray-800 bg-[#12141c]">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-medium text-gray-200">
          Web sources
          {isSearching && (
            <span className="ml-2 text-sm font-normal text-indigo-400 animate-pulse">
              Searching...
            </span>
          )}
        </span>
        <span className="text-gray-500">{collapsed ? 'Show' : 'Hide'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-800 px-4 pb-4 pt-3">
          {query && (
            <p className="mb-2 text-xs text-gray-500">
              Query: <span className="text-gray-400">{query}</span>
            </p>
          )}

          {error && (
            <div className="mb-3 rounded-md bg-amber-900/20 px-3 py-2 text-sm text-amber-200">
              {error}
            </div>
          )}

          {sources.length > 0 ? (
            <ul className="space-y-2">
              {sources.map((source, index) => (
                <li key={`${source.url}-${index}`} className="text-sm">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-indigo-400 hover:text-indigo-300"
                  >
                    {source.title || source.url}
                  </a>
                  {source.snippet && (
                    <p className="mt-1 text-xs text-gray-400">{source.snippet}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            !isSearching &&
            !error && <p className="text-sm text-gray-500">No web sources were used.</p>
          )}
        </div>
      )}
    </div>
  );
}
