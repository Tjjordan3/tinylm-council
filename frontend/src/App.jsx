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
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    loadSettings();
    loadConversations();
  }, []);

  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
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

  const handleNewConversation = async () => {
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

  const handleSendMessage = async (content) => {
    if (!currentConversationId) return;
    setIsLoading(true);

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
        metadata: null,
        memberStatuses: {},
        loading: { stage1: false, stage2: false, stage3: false },
      };

      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      let streamCompleted = false;
      let streamErrored = false;
      const streamResult = await api.sendMessageStream(
        currentConversationId,
        content,
        (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            setCurrentConversation((prev) => {
              const memberStatuses = {};
              for (const m of event.members || []) {
                memberStatuses[m.id] = { status: 'waiting', ...m };
              }
              return updateLastAssistantMessage(prev, {
                loading: { stage1: true, stage2: false, stage3: false },
                memberStatuses,
              });
            });
            break;
          case 'member_complete': {
            const data = event.data;
            setCurrentConversation((prev) => {
              const lastMsg = prev.messages[prev.messages.length - 1];
              const allStage1 = upsertStage1Result(lastMsg.allStage1, data);
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
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  stage2: true,
                },
              })
            );
            break;
          case 'stage2_complete':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                stage2: event.data,
                metadata: event.metadata,
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  stage2: false,
                },
              })
            );
            break;
          case 'stage3_start':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                loading: {
                  ...(prev.messages[prev.messages.length - 1].loading || {}),
                  stage3: true,
                },
              })
            );
            break;
          case 'stage3_complete':
            setCurrentConversation((prev) =>
              updateLastAssistantMessage(prev, {
                stage3: event.data,
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
        { signal: controller.signal }
      );

      if (streamResult.aborted) {
        setCurrentConversation((prev) => ({
          ...prev,
          messages: prev.messages.slice(0, -2),
        }));
        await loadConversation(currentConversationId);
        return;
      }

      if (streamResult.completed || streamCompleted) {
        await loadConversation(currentConversationId);
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
        await loadConversation(currentConversationId);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        setCurrentConversation((prev) => ({
          ...prev,
          messages: prev.messages.slice(0, -2),
        }));
        await loadConversation(currentConversationId);
        return;
      }
      console.error('Failed to send message:', error);
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
    } finally {
      abortControllerRef.current = null;
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
        onSelectConversation={setCurrentConversationId}
        onNewConversation={handleNewConversation}
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
              isLoading={isLoading}
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
                await api.updateSettings(updated);
                await loadSettings();
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
