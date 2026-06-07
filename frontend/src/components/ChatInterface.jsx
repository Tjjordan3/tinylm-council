import { useEffect, useRef, useState } from 'react';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import StageProgress from './StageProgress';

function providerBadge(providerId, settings) {
  const provider = settings?.providers?.find((p) => p.id === providerId);
  if (!provider) return 'Unknown';
  const preset = provider.preset || provider.type;
  if (preset === 'openrouter') return 'Cloud';
  return 'Local';
}

export default function ChatInterface({
  conversation,
  onSendMessage,
  onStopConsultation,
  isLoading,
  settings,
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input);
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!conversation) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <h2 className="text-2xl font-semibold text-white">Welcome to TinyLM Council</h2>
        <p className="mt-2 max-w-md text-gray-400">
          Create a new conversation to consult multiple small LLMs. They share opinions,
          rank each other, and produce a synthesized final answer.
        </p>
        {settings?.council_members?.filter((m) => m.enabled).length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {settings.council_members
              .filter((m) => m.enabled)
              .map((m) => (
                <span
                  key={m.id}
                  className="rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-300"
                >
                  {m.display_name}{' '}
                  <span className="text-xs text-gray-500">
                    ({providerBadge(m.provider_id, settings)})
                  </span>
                </span>
              ))}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {conversation.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <h2 className="text-xl font-semibold text-white">Start a conversation</h2>
            <p className="mt-2 text-gray-400">Ask a question to consult the council</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="mb-8">
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-3xl rounded-2xl bg-indigo-600 px-4 py-3 text-white">
                    <div className="mb-1 text-xs opacity-70">You</div>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-3 text-sm font-medium text-gray-400">TinyLM Council</div>

                  <StageProgress
                    loading={msg.loading}
                    stage1Done={Boolean(
                      msg.stage1?.length || msg.allStage1?.length || msg.stage2 || msg.stage3
                    )}
                    stage2Done={!!msg.stage2}
                    stage3Done={!!msg.stage3}
                    memberStatuses={msg.memberStatuses}
                  />

                  <Stage1
                    responses={msg.stage1}
                    allResults={msg.allStage1}
                    defaultCollapsed={!!msg.stage3}
                  />

                  <Stage2
                    rankings={msg.stage2}
                    labelToModel={msg.metadata?.label_to_model}
                    aggregateRankings={msg.metadata?.aggregate_rankings}
                    rankingParseFailed={msg.metadata?.ranking_parse_failed}
                    defaultCollapsed={!!msg.stage3}
                  />

                  {msg.stage3 && <Stage3 result={msg.stage3} />}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-800 p-3 md:p-4">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={2}
            placeholder="Ask the council a question..."
            className="flex-1 resize-none rounded-xl border border-gray-700 bg-[#12141c] px-4 py-3 text-gray-100 placeholder-gray-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:self-end">
            {isLoading && (
              <button
                type="button"
                onClick={onStopConsultation}
                className="rounded-xl border border-red-500/60 bg-red-950/40 px-6 py-3 font-medium text-red-200 hover:bg-red-900/50"
              >
                Stop
              </button>
            )}
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {isLoading ? 'Consulting...' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
