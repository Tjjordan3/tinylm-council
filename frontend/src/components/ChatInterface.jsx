import { useEffect, useRef, useState } from 'react';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import StageProgress from './StageProgress';
import DebateRounds from './DebateRounds';
import WebSources from './WebSources';

export default function ChatInterface({
  conversation,
  onSendMessage,
  onStopConsultation,
  isLoading,
  settings,
}) {
  const [input, setInput] = useState('');
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [deliberationMode, setDeliberationMode] = useState(
    settings?.deliberation_mode === 'debate' ? 'debate' : 'rank'
  );
  const [runMode, setRunMode] = useState(settings?.default_run_mode === 'quick' ? 'quick' : 'full');
  const [maxMembers, setMaxMembers] = useState(
    settings?.default_max_members != null ? String(settings.default_max_members) : ''
  );
  const [modeTouched, setModeTouched] = useState(false);
  const [runTouched, setRunTouched] = useState(false);
  const [membersTouched, setMembersTouched] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  useEffect(() => {
    if (modeTouched) return;
    if (settings?.deliberation_mode === 'debate' || settings?.deliberation_mode === 'rank') {
      setDeliberationMode(settings.deliberation_mode);
    }
  }, [settings?.deliberation_mode, modeTouched]);

  useEffect(() => {
    if (runTouched) return;
    if (settings?.default_run_mode === 'quick' || settings?.default_run_mode === 'full') {
      setRunMode(settings.default_run_mode);
    }
  }, [settings?.default_run_mode, runTouched]);

  useEffect(() => {
    if (membersTouched) return;
    setMaxMembers(
      settings?.default_max_members != null ? String(settings.default_max_members) : ''
    );
  }, [settings?.default_max_members, membersTouched]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      const parsedMax = maxMembers ? Number(maxMembers) : null;
      onSendMessage(input, {
        useWebSearch,
        deliberationMode,
        debateRounds: settings?.debate_rounds,
        runMode,
        maxMembers: parsedMax && parsedMax >= 2 ? parsedMax : null,
      });
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const composer = (
    <div className="composer-shell border-t border-[var(--border)] p-3 md:p-4">
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-4xl flex-col gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={2}
          placeholder="Ask the council a question..."
          className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[var(--text)] placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={useWebSearch}
              onChange={(e) => setUseWebSearch(e.target.checked)}
              disabled={isLoading}
              className="rounded border-gray-600"
            />
            Search the web first
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            Run
            <select
              value={runMode}
              onChange={(e) => {
                setRunTouched(true);
                setRunMode(e.target.value);
              }}
              disabled={isLoading}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[var(--text)]"
            >
              <option value="full">Full council</option>
              <option value="quick">Quick (skip deliberation)</option>
            </select>
          </label>
          {runMode === 'full' && (
            <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
              Mode
              <select
                value={deliberationMode}
                onChange={(e) => {
                  setModeTouched(true);
                  setDeliberationMode(e.target.value);
                }}
                disabled={isLoading}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[var(--text)]"
              >
                <option value="rank">Ranked peer review</option>
                <option value="debate">Debate</option>
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            Members
            <select
              value={maxMembers}
              onChange={(e) => {
                setMembersTouched(true);
                setMaxMembers(e.target.value);
              }}
              disabled={isLoading}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[var(--text)]"
            >
              <option value="">All enabled</option>
              <option value="2">2 members</option>
              <option value="3">3 members</option>
              <option value="4">4 members</option>
            </select>
          </label>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          {isLoading && (
            <button
              type="button"
              onClick={onStopConsultation}
              className="order-first rounded-xl border border-red-500/70 bg-red-950/50 px-6 py-3 font-medium text-red-100 hover:bg-red-900/60 sm:order-none"
            >
              Stop
            </button>
          )}
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-xl bg-[var(--accent)] px-6 py-3 font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {isLoading ? 'Consulting...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );

  if (!conversation) {
    return (
      <main className="brand-empty flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="brand-mark">TinyLM Council</h1>
        <p className="mt-3 max-w-md text-[var(--muted)]">
          Small models confer, then a chairman delivers one answer. Start a new conversation from
          the sidebar.
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {conversation.messages.length === 0 ? (
          <div className="brand-empty flex h-full flex-col items-center justify-center text-center">
            <h1 className="brand-mark">TinyLM Council</h1>
            <p className="mt-3 text-[var(--muted)]">Ask a question to consult the council.</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => {
            const run = msg.metadata?.run_mode || 'full';
            const mode =
              run === 'quick'
                ? 'rank'
                : msg.metadata?.deliberation_mode ||
                  (msg.debate_rounds?.length || msg.debateRounds?.length ? 'debate' : 'rank');
            const debateRounds = msg.debateRounds || msg.debate_rounds;
            const stage2Done =
              run === 'quick'
                ? Boolean(msg.stage1?.length || msg.allStage1?.length)
                : mode === 'debate'
                  ? !!debateRounds?.length
                  : !!msg.stage2;
            return (
              <div key={index} className="mb-8">
                {msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="max-w-3xl rounded-2xl bg-[var(--accent)] px-4 py-3 text-[var(--accent-contrast)]">
                      <div className="mb-1 text-xs opacity-70">You</div>
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                ) : (
                  <div className="council-turn">
                    <div className="mb-3 text-sm font-medium text-[var(--muted)]">TinyLM Council</div>

                    <StageProgress
                      loading={msg.loading}
                      stage1Done={Boolean(
                        msg.stage1?.length ||
                          msg.allStage1?.length ||
                          msg.stage2 ||
                          debateRounds?.length ||
                          msg.stage3
                      )}
                      stage2Done={stage2Done}
                      stage3Done={!!msg.stage3 && !msg.stage3.streaming}
                      memberStatuses={msg.memberStatuses}
                      deliberationMode={mode}
                      runMode={run}
                      stageStartedAt={msg.stageStartedAt}
                    />

                    <WebSources
                      webSearch={msg.webSearch || msg.metadata?.web_search}
                      loading={msg.loading}
                    />

                    <Stage1
                      responses={msg.stage1}
                      allResults={msg.allStage1}
                      defaultCollapsed={!!msg.stage3 && !msg.loading?.stage3}
                    />

                    {run !== 'quick' &&
                      (mode === 'debate' ? (
                        <DebateRounds
                          rounds={debateRounds}
                          labelToModel={msg.metadata?.label_to_model}
                          defaultCollapsed={!!msg.stage3 && !msg.loading?.stage3}
                        />
                      ) : (
                        <Stage2
                          rankings={msg.stage2}
                          labelToModel={msg.metadata?.label_to_model}
                          aggregateRankings={msg.metadata?.aggregate_rankings}
                          rankingParseFailed={msg.metadata?.ranking_parse_failed}
                          defaultCollapsed={!!msg.stage3 && !msg.loading?.stage3}
                        />
                      ))}

                    {msg.stage3 && <Stage3 result={msg.stage3} />}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {composer}
    </main>
  );
}
