import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import SetupWizard from './pages/SetupWizard';
import Settings from './pages/Settings';
import ModelManager from './pages/ModelManager';
import { api } from './api';

export default function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortControllerRef = useRef(null);
  const streamingConversationIdRef = useRef(null);
  const deltaBufferRef = useRef({});
  const deltaRafRef = useRef(null);

  const clearDeltaPipeline = () => {
    deltaBufferRef.current = {};
    if (deltaRafRef.current != null) {
      cancelAnimationFrame(deltaRafRef.current);
      deltaRafRef.current = null;
    }
  };

  const flushDeltaBuffer = () => {
    if (deltaRafRef.current != null) {
      cancelAnimationFrame(deltaRafRef.current);
      deltaRafRef.current = null;
    }
    const buffer = deltaBufferRef.current;
    deltaBufferRef.current = {};
    const stage1Deltas = buffer.stage1 || {};
    const stage2Deltas = buffer.stage2 || {};
    const debateDeltas = buffer.debate || {};
    const stage3Delta = buffer.stage3 || '';
    if (
      !Object.keys(stage1Deltas).length &&
      !Object.keys(stage2Deltas).length &&
      !Object.keys(debateDeltas).length &&
      !stage3Delta
    ) {
      return;
    }
    setCurrentConversation((prev) => {
      if (!prev?.messages?.length) return prev;
      const lastMsg = prev.messages[prev.messages.length - 1];
      if (lastMsg.role !== 'assistant') return prev;

      let allStage1 = lastMsg.allStage1 || [];
      let stage1 = lastMsg.stage1;
      let stage2 = lastMsg.stage2;
      let debateRounds = lastMsg.debateRounds;
      let stage3 = lastMsg.stage3;
      let memberStatuses = { ...(lastMsg.memberStatuses || {}) };

      for (const [memberId, delta] of Object.entries(stage1Deltas)) {
        const idx = allStage1.findIndex((r) => r.member_id === memberId);
        if (idx >= 0) {
          const next = { ...allStage1[idx], response: (allStage1[idx].response || '') + delta };
          allStage1 = allStage1.slice();
          allStage1[idx] = next;
        } else {
          const meta = memberStatuses[memberId] || {};
          allStage1 = [
            ...allStage1,
            {
              member_id: memberId,
              display_name: meta.display_name,
              model: meta.model,
              response: delta,
              success: true,
              streaming: true,
            },
          ];
        }
        memberStatuses[memberId] = {
          ...(memberStatuses[memberId] || {}),
          status: 'running',
        };
        stage1 = allStage1.filter((r) => r.success !== false && (r.response || r.streaming));
      }

      for (const [memberId, delta] of Object.entries(stage2Deltas)) {
        const existing = [...(stage2 || [])];
        const idx = existing.findIndex((r) => r.member_id === memberId);
        if (idx >= 0) {
          existing[idx] = {
            ...existing[idx],
            ranking: (existing[idx].ranking || '') + delta,
            streaming: true,
          };
        } else {
          const meta = memberStatuses[memberId] || {};
          existing.push({
            member_id: memberId,
            display_name: meta.display_name,
            model: meta.model,
            ranking: delta,
            parsed_ranking: [],
            streaming: true,
          });
        }
        stage2 = existing;
        memberStatuses[memberId] = {
          ...(memberStatuses[memberId] || {}),
          status: 'running',
        };
      }

      for (const key of Object.keys(debateDeltas)) {
        const [roundStr, memberId] = key.split('::');
        const roundNum = Number(roundStr);
        const delta = debateDeltas[key];
        const existing = [...(debateRounds || [])];
        let roundEntry = existing.find((r) => r.round === roundNum);
        if (!roundEntry) {
          roundEntry = { round: roundNum, results: [] };
          existing.push(roundEntry);
          existing.sort((a, b) => a.round - b.round);
        }
        const results = [...(roundEntry.results || [])];
        const idx = results.findIndex((r) => r.member_id === memberId);
        if (idx >= 0) {
          results[idx] = {
            ...results[idx],
            response: (results[idx].response || '') + delta,
            streaming: true,
          };
        } else {
          const meta = memberStatuses[memberId] || {};
          results.push({
            member_id: memberId,
            display_name: meta.display_name,
            model: meta.model,
            response: delta,
            success: true,
            streaming: true,
          });
        }
        roundEntry = { ...roundEntry, results };
        debateRounds = existing.map((r) => (r.round === roundNum ? roundEntry : r));
        memberStatuses[memberId] = {
          ...(memberStatuses[memberId] || {}),
          status: 'running',
        };
      }

      if (stage3Delta) {
        stage3 = {
          ...(stage3 || {}),
          response: ((stage3 && stage3.response) || '') + stage3Delta,
          streaming: true,
        };
      }

      return updateLastAssistantMessage(prev, {
        allStage1,
        stage1,
        stage2,
        debateRounds,
        stage3,
        memberStatuses,
      });
    });
  };

  const queueDelta = (kind, payload) => {
    if (kind === 'stage1') {
      const { memberId, delta } = payload;
      deltaBufferRef.current.stage1 = deltaBufferRef.current.stage1 || {};
      deltaBufferRef.current.stage1[memberId] =
        (deltaBufferRef.current.stage1[memberId] || '') + delta;
    } else if (kind === 'stage2') {
      const { memberId, delta } = payload;
      deltaBufferRef.current.stage2 = deltaBufferRef.current.stage2 || {};
      deltaBufferRef.current.stage2[memberId] =
        (deltaBufferRef.current.stage2[memberId] || '') + delta;
    } else if (kind === 'debate') {
      const { round, memberId, delta } = payload;
      const key = `${round}::${memberId}`;
      deltaBufferRef.current.debate = deltaBufferRef.current.debate || {};
      deltaBufferRef.current.debate[key] =
        (deltaBufferRef.current.debate[key] || '') + delta;
    } else if (kind === 'stage3') {
      deltaBufferRef.current.stage3 = (deltaBufferRef.current.stage3 || '') + payload.delta;
    }
    if (deltaRafRef.current == null) {
      deltaRafRef.current = requestAnimationFrame(flushDeltaBuffer);
    }
  };

  useEffect(() => {
    loadSettings();
    loadConversations();
  }, []);

  useEffect(() => {
    if (!currentConversationId) return;
    // Avoid wiping an in-flight optimistic stream when auto-creating a chat.
    if (streamingConversationIdRef.current === currentConversationId) return;
    loadConversation(currentConversationId);
  }, [currentConversationId]);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setSettings(data);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setSettingsLoaded(true);
    }
  };

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    if (id !== currentConversationId) {
      abortControllerRef.current?.abort();
      streamingConversationIdRef.current = null;
    }
    setCurrentConversationId(id);
  };

  const handleNewConversation = async () => {
    abortControllerRef.current?.abort();
    try {
      const newConv = await api.createConversation();
      setConversations([
        {
          id: newConv.id,
          created_at: newConv.created_at,
          title: newConv.title,
          message_count: 0,
        },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleDeleteConversation = async (id) => {
    if (!window.confirm('Delete this conversation?')) return;
    try {
      await api.deleteConversation(id);
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);
      if (currentConversationId === id) {
        if (remaining.length > 0) {
          setCurrentConversationId(remaining[0].id);
        } else {
          setCurrentConversationId(null);
          setCurrentConversation(null);
        }
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      alert('Failed to delete conversation.');
    }
  };

  const updateLastAssistantMessage = (prev, patch) => {
    if (!prev?.messages?.length) return prev;
    const lastIndex = prev.messages.length - 1;
    const lastMsg = prev.messages[lastIndex];
    if (lastMsg.role !== 'assistant') return prev;
    const messages = prev.messages.slice();
    messages[lastIndex] = { ...lastMsg, ...patch };
    return { ...prev, messages };
  };

  const upsertStage1Result = (allStage1, data) => {
    const next = [...(allStage1 || [])];
    const idx = next.findIndex((r) => r.member_id === data.member_id);
    if (idx >= 0) next[idx] = data;
    else next.push(data);
    return next;
  };

  const handleStopConsultation = () => {
    abortControllerRef.current?.abort();
  };

  const restorePreviousStage3 = (previousStage3) => {
    clearDeltaPipeline();
    setCurrentConversation((prev) =>
      updateLastAssistantMessage(prev, {
        stage3: previousStage3,
        loading: {
          ...(prev.messages[prev.messages.length - 1]?.loading || {}),
          stage3: false,
        },
      })
    );
  };

  const handleRegenerateChairman = async () => {
    if (!currentConversationId || isLoading || isRegenerating) return;
    setIsRegenerating(true);
    setIsLoading(true);
    streamingConversationIdRef.current = currentConversationId;
    clearDeltaPipeline();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const previousStage3 = currentConversation?.messages?.length
      ? currentConversation.messages[currentConversation.messages.length - 1]?.stage3
      : null;

    setCurrentConversation((prev) =>
      updateLastAssistantMessage(prev, {
        stage3: {
          ...(previousStage3 || {}),
          response: '',
          streaming: true,
        },
        loading: {
          ...(prev.messages[prev.messages.length - 1].loading || {}),
          stage3: true,
        },
      })
    );

    let streamErrored = false;
    try {
      const result = await api.regenerateChairmanStream(
        currentConversationId,
        (eventType, event) => {
          switch (eventType) {
            case 'stage3_delta':
              queueDelta('stage3', { delta: event.delta || '' });
              break;
            case 'stage3_complete':
              flushDeltaBuffer();
              setCurrentConversation((prev) =>
                updateLastAssistantMessage(prev, {
                  stage3: { ...event.data, streaming: false },
                  loading: {
                    ...(prev.messages[prev.messages.length - 1].loading || {}),
                    stage3: false,
                  },
                })
              );
              break;
            case 'error':
              streamErrored = true;
              alert(event.message);
              break;
            default:
              break;
          }
        },
        { signal: controller.signal }
      );
      if (result.aborted || streamErrored || !result.completed) {
        restorePreviousStage3(previousStage3);
        return;
      }
      await loadConversation(currentConversationId);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Failed to regenerate chairman:', error);
        alert(error.message || 'Failed to regenerate chairman');
      }
      restorePreviousStage3(previousStage3);
    } finally {
      abortControllerRef.current = null;
      streamingConversationIdRef.current = null;
      setIsRegenerating(false);
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (content, options = {}) => {
    const useWebSearch = typeof options === 'boolean' ? options : !!options.useWebSearch;
    const deliberationMode =
      typeof options === 'object' && options.deliberationMode
        ? options.deliberationMode
        : settings?.deliberation_mode || 'rank';
    const debateRounds =
      typeof options === 'object' && options.debateRounds != null
        ? options.debateRounds
        : settings?.debate_rounds;
    const runMode =
      typeof options === 'object' && options.runMode
        ? options.runMode
        : settings?.default_run_mode || 'full';
    const maxMembers =
      typeof options === 'object' && options.maxMembers != null
        ? options.maxMembers
        : settings?.default_max_members;

    let conversationId = currentConversationId;
    if (!conversationId) {
      try {
        const newConv = await api.createConversation();
        setConversations((prev) => [
          {
            id: newConv.id,
            created_at: newConv.created_at,
            title: newConv.title,
            message_count: 0,
          },
          ...prev,
        ]);
        // Mark streaming before id change so useEffect does not reload empty chat.
        streamingConversationIdRef.current = newConv.id;
        setCurrentConversationId(newConv.id);
        setCurrentConversation(newConv);
        conversationId = newConv.id;
      } catch (error) {
        console.error('Failed to create conversation:', error);
        alert('Could not start a conversation.');
        return;
      }
    }

    setIsLoading(true);
    streamingConversationIdRef.current = conversationId;
    clearDeltaPipeline();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        debateRounds: null,
        metadata: { deliberation_mode: deliberationMode },
        webSearch: null,
        memberStatuses: {},
        loading: {
          webSearch: useWebSearch,
          stage1: false,
          stage2: false,
          debate: false,
          stage3: false,
        },
      };

      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      let streamCompleted = false;
      let streamErrored = false;
      const streamResult = await api.sendMessageStream(
        conversationId,
        content,
        (eventType, event) => {
        switch (eventType) {
          case 'web_search_start':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  webSearch: true,
                },
              })
            );
            break;
          case 'web_search_complete':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                webSearch: event.data,
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  webSearch: false,
                },
              })
            );
            break;
          case 'web_search_skipped':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                webSearch: event.data || {
                  enabled: true,
                  query: content,
                  sources: [],
                  error: event.message,
                },
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  webSearch: false,
                },
              })
            );
            break;
          case 'stage1_start':
            setCurrentConversation((prev) => {
              const memberStatuses = {};
              for (const m of event.members || []) {
                memberStatuses[m.id] = { status: 'waiting', ...m };
              }
              return updateLastAssistantMessage(prev, {
                loading: {
                  webSearch: false,
                  stage1: true,
                  stage2: false,
                  debate: false,
                  stage3: false,
                },
                memberStatuses,
                allStage1: [],
                stage1: [],
                stageStartedAt: { stage1: Date.now() },
                metadata: {
                  ...(prev.messages[prev.messages.length - 1].metadata || {}),
                  deliberation_mode: event.deliberation_mode || deliberationMode,
                  run_mode: event.run_mode || runMode,
                },
              });
            });
            break;
          case 'member_delta':
            queueDelta('stage1', { memberId: event.member_id, delta: event.delta || '' });
            break;
          case 'member_complete': {
            flushDeltaBuffer();
            const data = event.data;
            setCurrentConversation((prev) => {
              const lastMsg = prev.messages[prev.messages.length - 1];
              const allStage1 = upsertStage1Result(lastMsg.allStage1, {
                ...data,
                streaming: false,
              });
              const stage1 = allStage1.filter((r) => r.success);
              return updateLastAssistantMessage(prev, {
                memberStatuses: {
                  ...(lastMsg.memberStatuses || {}),
                  [data.member_id]: {
                    ...(lastMsg.memberStatuses?.[data.member_id] || {}),
                    status: data.success ? 'done' : 'failed',
                    error: data.error,
                  },
                },
                allStage1,
                stage1: stage1.length ? stage1 : lastMsg.stage1,
              });
            });
            break;
          }
          case 'stage1_complete':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                stage1: event.data,
                allStage1: event.all_results,
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  stage1: false,
                },
              })
            );
            break;
          case 'stage2_start':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                stage2: [],
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  stage2: true,
                },
                stageStartedAt: {
                  ...(prev.messages[prev.messages.length - 1].stageStartedAt || {}),
                  stage2: Date.now(),
                },
              })
            );
            break;
          case 'stage2_member_delta':
            queueDelta('stage2', { memberId: event.member_id, delta: event.delta || '' });
            break;
          case 'stage2_member_complete': {
            flushDeltaBuffer();
            const data = event.data;
            setCurrentConversation((prev) => {
              const lastMsg = prev.messages[prev.messages.length - 1];
              const existing = [...(lastMsg.stage2 || [])];
              const idx = existing.findIndex((r) => r.member_id === data.member_id);
              const next = { ...data, streaming: false };
              if (idx >= 0) existing[idx] = next;
              else existing.push(next);
              return updateLastAssistantMessage(prev, {
                stage2: existing,
                memberStatuses: {
                  ...(lastMsg.memberStatuses || {}),
                  [data.member_id]: {
                    ...(lastMsg.memberStatuses?.[data.member_id] || {}),
                    display_name: data.display_name,
                    model: data.model,
                    status: data.error ? 'failed' : 'done',
                    error: data.error,
                  },
                },
              });
            });
            break;
          }
          case 'stage2_skipped':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                metadata: {
                  ...(prev.messages[prev.messages.length - 1].metadata || {}),
                  run_mode: 'quick',
                  stage2_skipped: true,
                },
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  stage2: false,
                  debate: false,
                },
              })
            );
            break;
          case 'stage2_complete':
            flushDeltaBuffer();
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                stage2: event.data,
                metadata: {
                  ...(prev.messages[prev.messages.length - 1].metadata || {}),
                  ...(event.metadata || {}),
                  deliberation_mode: 'rank',
                },
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  stage2: false,
                },
              })
            );
            break;
          case 'debate_start':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                debateRounds: [],
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  debate: true,
                  stage2: false,
                },
                metadata: {
                  ...(prev.messages[prev.messages.length - 1].metadata || {}),
                  deliberation_mode: 'debate',
                },
                stageStartedAt: {
                  ...(prev.messages[prev.messages.length - 1].stageStartedAt || {}),
                  stage2: Date.now(),
                },
              })
            );
            break;
          case 'debate_member_delta':
            queueDelta('debate', {
              round: event.round,
              memberId: event.member_id,
              delta: event.delta || '',
            });
            break;
          case 'debate_member_complete': {
            flushDeltaBuffer();
            const data = event.data;
            const roundNum = event.round;
            setCurrentConversation((prev) => {
              const lastMsg = prev.messages[prev.messages.length - 1];
              const existing = [...(lastMsg.debateRounds || [])];
              let roundEntry = existing.find((r) => r.round === roundNum);
              if (!roundEntry) {
                roundEntry = { round: roundNum, results: [] };
                existing.push(roundEntry);
                existing.sort((a, b) => a.round - b.round);
              }
              const results = [...(roundEntry.results || [])];
              const idx = results.findIndex((r) => r.member_id === data.member_id);
              if (idx >= 0) results[idx] = data;
              else results.push(data);
              roundEntry = { ...roundEntry, results };
              const nextRounds = existing.map((r) =>
                r.round === roundNum ? roundEntry : r
              );
              return updateLastAssistantMessage(prev, {
                debateRounds: nextRounds,
                memberStatuses: {
                  ...(lastMsg.memberStatuses || {}),
                  [data.member_id]: {
                    ...(lastMsg.memberStatuses?.[data.member_id] || {}),
                    display_name: data.display_name,
                    model: data.model,
                    status: data.success ? 'done' : 'failed',
                    error: data.error,
                  },
                },
              });
            });
            break;
          }
          case 'debate_complete':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                debateRounds: event.data,
                metadata: {
                  ...(prev.messages[prev.messages.length - 1].metadata || {}),
                  ...(event.metadata || {}),
                  deliberation_mode: 'debate',
                },
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  debate: false,
                },
              })
            );
            break;
          case 'stage3_start':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                stage3: {
                  response: '',
                  streaming: true,
                },
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  stage3: true,
                },
                stageStartedAt: {
                  ...(prev.messages[prev.messages.length - 1].stageStartedAt || {}),
                  stage3: Date.now(),
                },
              })
            );
            break;
          case 'stage3_delta':
            queueDelta('stage3', { delta: event.delta || '' });
            break;
          case 'stage3_complete':
            flushDeltaBuffer();
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                stage3: { ...event.data, streaming: false },
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  stage3: false,
                },
              })
            );
            break;
          case 'title_complete':
            loadConversations();
            break;
          case 'complete':
            streamCompleted = true;
            loadConversations();
            break;
          case 'error':
            streamErrored = true;
            console.error('Stream error:', event.message);
            alert(event.message);
            break;
          default:
            break;
        }
      },
        {
          signal: controller.signal,
          useWebSearch,
          deliberationMode,
          debateRounds,
          runMode,
          maxMembers,
        }
      );

      if (streamResult.aborted) {
        setCurrentConversation((prev) => ({
          ...prev,
          messages: prev.messages.slice(0, -2),
        }));
        await loadConversation(conversationId);
        return;
      }

      if (streamResult.completed || streamCompleted) {
        await loadConversation(conversationId);
      } else if (!streamResult.completed && !streamCompleted) {
        if (!streamErrored) {
          alert(
            'Council response did not finish. The connection may have timed out. Please try again and wait for one request to complete before starting another.'
          );
        }
        setCurrentConversation((prev) => ({
          ...prev,
          messages: prev.messages.slice(0, -2),
        }));
        await loadConversation(conversationId);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        setCurrentConversation((prev) => ({
          ...prev,
          messages: prev.messages.slice(0, -2),
        }));
        await loadConversation(conversationId);
        return;
      }
      console.error('Failed to send message:', error);
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
    } finally {
      abortControllerRef.current = null;
      streamingConversationIdRef.current = null;
      setIsLoading(false);
    }
  };

  if (!settingsLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1117] text-gray-300">
        Loading TinyLM Council...
      </div>
    );
  }

  if (settings && !settings.setup_complete) {
    return (
      <SetupWizard
        initialSettings={settings}
        onComplete={async (updated) => {
          await api.updateSettings({ ...updated, setup_complete: true });
          await loadSettings();
        }}
      />
    );
  }

  return (
    <div className="flex h-screen bg-[#0f1117]">
      <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center border-b border-gray-800 bg-[#0f1117] px-3 md:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="rounded-md p-2 text-gray-300 hover:bg-gray-800 hover:text-white"
          aria-label="Open menu"
        >
          ☰
        </button>
        <span className="ml-2 font-semibold text-white">TinyLM Council</span>
      </div>

      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col pt-12 md:pt-0">
      <Routes>
        <Route
          path="/"
          element={
            <ChatInterface
              conversation={currentConversation}
              onSendMessage={handleSendMessage}
              onStopConsultation={handleStopConsultation}
              onRegenerateChairman={handleRegenerateChairman}
              isLoading={isLoading}
              regeneratingChairman={isRegenerating}
              settings={settings}
            />
          }
        />
        <Route
          path="/settings"
          element={
            <Settings
              settings={settings}
              onSave={async (updated) => {
                const saved = await api.updateSettings(updated);
                setSettings(saved);
                return saved;
              }}
            />
          }
        />
        <Route
          path="/models"
          element={
            <ModelManager
              settings={settings}
              onMemberAdded={loadSettings}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </div>
    </div>
  );
}
