function resolveApiBase() {
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  // Tauri webview is not same-origin with the FastAPI sidecar.
  // Use a dedicated port (not 8001) so an old start.ps1 backend cannot steal requests.
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return 'http://127.0.0.1:18765';
  }
  return '';
}

const API_BASE = resolveApiBase();

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json();
}

export const api = {
  getSettings: () => request('/api/settings'),
  updateSettings: (data) =>
    request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getPresets: () => request('/api/providers/presets'),
  testProvider: (provider) =>
    request('/api/providers/test', { method: 'POST', body: JSON.stringify({ provider }) }),
  testWebSearch: () => request('/api/web-search/test', { method: 'POST' }),
  testNvidia: () => request('/api/nvidia/test', { method: 'POST' }),
  getCapabilities: (providerId) => request(`/api/providers/${providerId}/capabilities`),
  listModels: (providerId) => request(`/api/providers/${providerId}/models`),
  listRunningModels: (providerId) => request(`/api/providers/${providerId}/models/running`),
  loadModel: (providerId, model, contextLength = 8192) =>
    request(`/api/providers/${providerId}/models/load`, {
      method: 'POST',
      body: JSON.stringify({ model, context_length: contextLength }),
    }),
  unloadModel: (providerId, model) =>
    request(`/api/providers/${providerId}/models/unload`, {
      method: 'POST',
      body: JSON.stringify({ model }),
    }),
  deleteModel: (providerId, model) =>
    request(`/api/providers/${providerId}/models/${encodeURIComponent(model)}`, {
      method: 'DELETE',
    }),
  addCouncilMember: (providerId, model, displayName) =>
    request('/api/council/members', {
      method: 'POST',
      body: JSON.stringify({
        provider_id: providerId,
        model,
        display_name: displayName,
      }),
    }),
  listConversations: () => request('/api/conversations'),
  createConversation: () => request('/api/conversations', { method: 'POST' }),
  getConversation: (id) => request(`/api/conversations/${id}`),
  deleteConversation: (id) =>
    request(`/api/conversations/${id}`, { method: 'DELETE' }),

  attachmentUrl(conversationId, attachmentId) {
    return `${API_BASE}/api/conversations/${conversationId}/attachments/${attachmentId}`;
  },

  async uploadAttachment(conversationId, file) {
    const body = new FormData();
    body.append('file', file, file.name);
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/attachments`,
      { method: 'POST', body }
    );
    if (!response.ok) {
      let detail = 'Failed to upload attachment';
      try {
        const data = await response.json();
        detail = data.detail || detail;
      } catch {
        const text = await response.text();
        if (text) detail = text;
      }
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return response.json();
  },

  async deleteAttachment(conversationId, attachmentId) {
    return request(`/api/conversations/${conversationId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
  },

  async pullModelStream(providerId, model, onEvent) {
    const response = await fetch(`${API_BASE}/api/providers/${providerId}/models/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!response.ok) throw new Error('Failed to start model pull');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            /* ignore parse errors */
          }
        }
      }
    }
  },

  async sendMessageStream(
    conversationId,
    content,
    onEvent,
    {
      signal,
      useWebSearch = false,
      deliberationMode,
      debateRounds,
      runMode,
      maxMembers,
      attachmentIds,
    } = {}
  ) {
    let reader;
    try {
      const body = {
        content,
        use_web_search: useWebSearch,
        deliberation_mode: deliberationMode || 'rank',
      };
      if (debateRounds != null) body.debate_rounds = debateRounds;
      if (runMode) body.run_mode = runMode;
      if (maxMembers != null) body.max_members = maxMembers;
      if (attachmentIds?.length) body.attachment_ids = attachmentIds;
      const response = await fetch(
        `${API_BASE}/api/conversations/${conversationId}/message/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        }
      );
      if (!response.ok) throw new Error('Failed to send message');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let errorEvents = 0;
      let completed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'error') errorEvents += 1;
              if (event.type === 'complete') completed = true;
              onEvent(event.type, event);
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }
      if (buffer.startsWith('data: ')) {
        try {
          const event = JSON.parse(buffer.slice(6));
          if (event.type === 'error') errorEvents += 1;
          if (event.type === 'complete') completed = true;
          onEvent(event.type, event);
        } catch {
          /* ignore parse errors */
        }
      }
      return { completed, errorEvents, aborted: false };
    } catch (error) {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
      }
      if (error.name === 'AbortError' || signal?.aborted) {
        return { completed: false, errorEvents: 0, aborted: true };
      }
      throw error;
    }
  },

  async regenerateChairmanStream(conversationId, onEvent, { signal } = {}) {
    let reader;
    try {
      const response = await fetch(
        `${API_BASE}/api/conversations/${conversationId}/regenerate-chairman/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
        }
      );
      if (!response.ok) throw new Error('Failed to regenerate chairman');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let errorEvents = 0;
      let completed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'error') errorEvents += 1;
              if (event.type === 'complete') completed = true;
              onEvent(event.type, event);
            } catch {
              /* ignore */
            }
          }
        }
      }
      if (buffer.startsWith('data: ')) {
        try {
          const event = JSON.parse(buffer.slice(6));
          if (event.type === 'error') errorEvents += 1;
          if (event.type === 'complete') completed = true;
          onEvent(event.type, event);
        } catch {
          /* ignore */
        }
      }
      return { completed, errorEvents, aborted: false };
    } catch (error) {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
      }
      if (error.name === 'AbortError' || signal?.aborted) {
        return { completed: false, errorEvents: 0, aborted: true };
      }
      throw error;
    }
  },
};
