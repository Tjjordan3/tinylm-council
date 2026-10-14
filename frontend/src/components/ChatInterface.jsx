import { useEffect, useRef, useState } from 'react';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import StageProgress from './StageProgress';
import DebateRounds from './DebateRounds';
import WebSources from './WebSources';
import { api } from '../api';

const MAX_PENDING_TEXT = 8;
const MAX_PENDING_IMAGES = 4;

function isImageFile(file) {
  return (file.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name || '');
}

function AttachmentChips({ items, conversationId, onRemove, removable = false }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const key = item.id || item.localId || item.name;
        const kind = item.kind || (item.file && isImageFile(item.file) ? 'image' : 'text');
        const name = item.name || item.file?.name || 'file';
        const preview =
          item.previewUrl ||
          (kind === 'image' && conversationId && item.id
            ? api.attachmentUrl(conversationId, item.id)
            : null);
        return (
          <div
            key={key}
            className="attach-chip flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--muted)]"
          >
            {preview ? (
              <img src={preview} alt={name} className="h-8 w-8 rounded object-cover" />
            ) : (
              <span className="font-mono text-[var(--accent)]">{kind === 'image' ? 'img' : 'file'}</span>
            )}
            <span className="max-w-[10rem] truncate text-[var(--text)]" title={name}>
              {name}
            </span>
            {removable && (
              <button
                type="button"
                className="text-gray-400 hover:text-red-300"
                aria-label={`Remove ${name}`}
                onClick={() => onRemove?.(item)}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ChatInterface({
  conversation,
  onSendMessage,
  onStopConsultation,
  onRegenerateChairman,
  isLoading,
  regeneratingChairman = false,
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
  const [pendingFiles, setPendingFiles] = useState([]);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

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

  useEffect(() => {
    return () => {
      pendingFiles.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, [pendingFiles]);

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setPendingFiles((prev) => {
      let textCount = prev.filter((p) => !isImageFile(p.file)).length;
      let imageCount = prev.filter((p) => isImageFile(p.file)).length;
      const next = [...prev];
      for (const file of incoming) {
        const image = isImageFile(file);
        if (image && imageCount >= MAX_PENDING_IMAGES) {
          alert(`At most ${MAX_PENDING_IMAGES} images per message.`);
          continue;
        }
        if (!image && textCount >= MAX_PENDING_TEXT) {
          alert(`At most ${MAX_PENDING_TEXT} text/code files per message.`);
          continue;
        }
        if (image) imageCount += 1;
        else textCount += 1;
        next.push({
          localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          name: file.name,
          kind: image ? 'image' : 'text',
          previewUrl: image ? URL.createObjectURL(file) : null,
        });
      }
      return next;
    });
  };

  const removePending = (item) => {
    setPendingFiles((prev) => {
      const next = prev.filter((p) => p.localId !== item.localId);
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if ((!input.trim() && !pendingFiles.length) || isLoading) return;
    const parsedMax = maxMembers ? Number(maxMembers) : null;
    const files = pendingFiles.map((p) => p.file);
    const hasImages = files.some(isImageFile);
    if (hasImages) {
      const members = (settings?.council_members || []).filter((m) => m.enabled);
      const anyVision = members.some(
        (m) =>
          m.vision_capable === true ||
          /llava|vision|gpt-4o|gemini|claude-3|claude-4|qwen2-vl|pixtral|moondream/i.test(
            m.model || ''
          )
      );
      if (!anyVision) {
        alert(
          'No vision-capable council member is enabled. Images will be noted by filename only unless you enable a vision model (or mark Vision in Settings).'
        );
      }
    }
    onSendMessage(input.trim() || 'Please review the attached files.', {
      useWebSearch,
      deliberationMode,
      debateRounds: settings?.debate_rounds,
      runMode,
      maxMembers: parsedMax && parsedMax >= 2 ? parsedMax : null,
      files,
      pendingPreview: pendingFiles.map((p) => ({
        localId: p.localId,
        name: p.name,
        kind: p.kind,
        previewUrl: p.previewUrl,
      })),
    });
    setInput('');
    setPendingFiles([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const composer = (
    <div className="composer-shell border-t border-[var(--border)] p-3 md:p-4">
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-6xl flex-col gap-3">
        <AttachmentChips items={pendingFiles} onRemove={removePending} removable />
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={2}
          placeholder="Ask the council a question..."
          className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[var(--text)] placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".py,.js,.ts,.tsx,.jsx,.md,.txt,.json,.toml,.yaml,.yml,.rs,.go,.java,.css,.html,.sh,.sql,.c,.h,.cpp,.cs,.rb,.php,.vue,.xml,.csv,image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={isLoading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-50"
              title="Attach code files or images"
            >
              Attach
            </button>
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
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {isLoading && (
              <button
                type="button"
                onClick={onStopConsultation}
                className="rounded-xl border border-red-500/70 bg-red-950/50 px-5 py-2.5 font-medium text-red-100 hover:bg-red-900/60"
              >
                Stop
              </button>
            )}
            <button
              type="submit"
              disabled={isLoading || (!input.trim() && !pendingFiles.length)}
              className="rounded-xl bg-[var(--accent)] px-6 py-2.5 font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {isLoading ? 'Consulting...' : 'Send'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );

  const messageList = conversation?.messages || [];
  const showBrandHero = !conversation || messageList.length === 0;

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {showBrandHero ? (
          <div className="brand-empty flex h-full flex-col items-center justify-center text-center">
            <h1 className="brand-mark">TinyLM Council</h1>
            <p className="mt-3 max-w-md text-[var(--muted)]">
              Small models confer, then a chairman delivers one answer.
            </p>
          </div>
        ) : (
          messageList.map((msg, index) => {
            const isLastAssistant =
              msg.role === 'assistant' && index === messageList.length - 1;
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
            const userAttachments = msg.attachments || msg.metadata?.attachments || [];
            return (
              <div key={index} className="mb-8">
                {msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="max-w-3xl rounded-2xl bg-[var(--accent)] px-4 py-3 text-[var(--accent-contrast)]">
                      <div className="mb-1 text-xs opacity-70">You</div>
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                      {!!userAttachments.length && (
                        <div className="mt-2 rounded-lg bg-black/10 p-2">
                          <AttachmentChips
                            items={userAttachments}
                            conversationId={conversation?.id}
                          />
                        </div>
                      )}
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
                      debateEarlyExit={!!msg.metadata?.debate_early_exit}
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
                          earlyExit={!!msg.metadata?.debate_early_exit}
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

                    {msg.stage3 && (
                      <Stage3
                        result={msg.stage3}
                        canRegenerate={
                          isLastAssistant &&
                          !isLoading &&
                          !regeneratingChairman &&
                          !!msg.stage1?.length
                        }
                        regenerating={isLastAssistant && regeneratingChairman}
                        onRegenerate={onRegenerateChairman}
                      />
                    )}
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
