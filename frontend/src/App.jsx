import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
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

  const handleSendMessage = async (content) => {
    if (!currentConversationId) return;
    setIsLoading(true);

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

      await api.sendMessageStream(currentConversationId, content, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage1 = true;
              lastMsg.memberStatuses = {};
              for (const m of event.members || []) {
                lastMsg.memberStatuses[m.id] = { status: 'waiting', ...m };
              }
              return { ...prev, messages };
            });
            break;
          case 'member_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              const data = event.data;
              lastMsg.memberStatuses = lastMsg.memberStatuses || {};
              lastMsg.memberStatuses[data.member_id] = {
                ...lastMsg.memberStatuses[data.member_id],
                status: data.success ? 'done' : 'failed',
                error: data.error,
              };
              return { ...prev, messages };
            });
            break;
          case 'stage1_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage1 = event.data;
              lastMsg.allStage1 = event.all_results;
              lastMsg.loading.stage1 = false;
              return { ...prev, messages };
            });
            break;
          case 'stage2_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage2 = true;
              return { ...prev, messages };
            });
            break;
          case 'stage2_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage2 = event.data;
              lastMsg.metadata = event.metadata;
              lastMsg.loading.stage2 = false;
              return { ...prev, messages };
            });
            break;
          case 'stage3_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;
          case 'stage3_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage3 = event.data;
              lastMsg.loading.stage3 = false;
              return { ...prev, messages };
            });
            break;
          case 'title_complete':
            loadConversations();
            break;
          case 'complete':
            loadConversations();
            setIsLoading(false);
            break;
          case 'error':
            console.error('Stream error:', event.message);
            setIsLoading(false);
            alert(event.message);
            break;
          default:
            break;
        }
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
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
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={setCurrentConversationId}
        onNewConversation={handleNewConversation}
      />
      <Routes>
        <Route
          path="/"
          element={
            <ChatInterface
              conversation={currentConversation}
              onSendMessage={handleSendMessage}
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
  );
}
