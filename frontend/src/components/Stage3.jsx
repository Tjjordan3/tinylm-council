import ReactMarkdown from 'react-markdown';

export default function Stage3({ result }) {
  if (!result) return null;

  return (
    <div className="mb-4 rounded-lg border border-indigo-700/50 bg-indigo-950/20 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">
          Final answer
        </span>
        <span className="text-sm text-gray-400">
          Chairman: {result.display_name || result.model}
        </span>
      </div>
      <div className="markdown-body text-gray-100">
        <ReactMarkdown>{result.response}</ReactMarkdown>
      </div>
    </div>
  );
}
