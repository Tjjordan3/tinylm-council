import ReactMarkdown from 'react-markdown';

export default function Stage3({ result }) {
  if (!result) return null;

  const text = (result.response || '').trim();
  const streaming = !!result.streaming;
  const hasError = !streaming && (result.error || !text);

  return (
    <div className={`final-answer mb-4 ${streaming ? 'is-revealing' : ''}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="final-badge">Final answer</span>
        {(result.display_name || result.model) && (
          <span className="text-sm text-[var(--muted)]">
            Chairman: {result.display_name || result.model}
          </span>
        )}
        {streaming && <span className="text-xs text-[var(--accent)]">Writing…</span>}
      </div>
      {hasError ? (
        <div className="text-sm text-amber-300">
          {result.error ||
            'Chairman returned an empty response. Try reloading the model in LM Studio or reducing council size.'}
        </div>
      ) : (
        <div className="markdown-body final-answer-body text-[var(--text)]">
          <ReactMarkdown>{result.response || ''}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
