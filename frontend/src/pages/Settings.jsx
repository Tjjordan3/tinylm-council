import { useEffect, useState } from 'react';
import { api } from '../api';

const NATIVE_BASE_URL_DEFAULTS = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
  localai: 'http://localhost:8080',
  vllm: 'http://localhost:8000',
};

const NATIVE_URL_PRESETS = new Set(['ollama', 'lmstudio', 'localai', 'vllm']);

function deriveNativeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/v1\/?$/, '');
}

const COUNCIL_PRESETS = {
  tinyLocal: {
    council_profile: 'tiny',
    members: [
      { provider_id: 'ollama', model: 'qwen2.5:0.5b', display_name: 'Qwen 0.5B' },
      { provider_id: 'ollama', model: 'phi3:mini', display_name: 'Phi-3 Mini' },
      { provider_id: 'ollama', model: 'gemma2:2b', display_name: 'Gemma 2B' },
    ],
  },
  miniCoding: {
    council_profile: 'tiny',
    members: [
      { provider_id: 'ollama', model: 'qwen2.5-coder:1.5b', display_name: 'Qwen Coder 1.5B' },
      { provider_id: 'ollama', model: 'deepseek-coder:1.3b', display_name: 'DeepSeek Coder 1.3B' },
      { provider_id: 'ollama', model: 'qwen2.5-coder:0.5b', display_name: 'Qwen Coder 0.5B' },
    ],
  },
  cloud: {
    council_profile: 'standard',
    members: [
      { provider_id: 'openrouter', model: 'google/gemini-2.5-flash', display_name: 'Gemini Flash' },
      { provider_id: 'openrouter', model: 'openai/gpt-4o-mini', display_name: 'GPT-4o Mini' },
      { provider_id: 'openrouter', model: 'anthropic/claude-3.5-sonnet', display_name: 'Claude 3.5' },
    ],
  },
  nvidiaCloud: {
    council_profile: 'standard',
    members: [
      { provider_id: 'nvidia', model: 'meta/llama-3.1-8b-instruct', display_name: 'Llama 3.1 8B' },
      { provider_id: 'nvidia', model: 'google/gemma-2-9b-it', display_name: 'Gemma 2 9B' },
      {
        provider_id: 'nvidia',
        model: 'microsoft/phi-3-mini-128k-instruct',
        display_name: 'Phi-3 Mini',
      },
    ],
  },
};

export default function Settings({ settings: initialSettings, onSave }) {
  const [settings, setSettings] = useState(initialSettings);
  const [presets, setPresets] = useState([]);
  const [testResults, setTestResults] = useState({});
  const [saved, setSaved] = useState(false);
  const [availableModels, setAvailableModels] = useState({});
  const [serperApiKeyInput, setSerperApiKeyInput] = useState('');
  const [nvidiaApiKeyInput, setNvidiaApiKeyInput] = useState('');
  const [webSearchTest, setWebSearchTest] = useState(null);
  const [nvidiaTest, setNvidiaTest] = useState(null);

  useEffect(() => {
    if (!initialSettings) return;
    setSettings(initialSettings);
    setSerperApiKeyInput('');
    setNvidiaApiKeyInput('');
  }, [
    initialSettings?.chairman_member_id,
    initialSettings?.council_profile,
    initialSettings?.deliberation_mode,
    initialSettings?.debate_rounds,
    initialSettings?.setup_complete,
    initialSettings?.parallel_local_inference,
    initialSettings?.serper_api_key_source,
    initialSettings?.nvidia_api_key_source,
    // Re-sync when provider/member lists change length or ids.
    initialSettings?.providers?.map((p) => p.id).join(','),
    initialSettings?.council_members?.map((m) => `${m.id}:${m.enabled}`).join(','),
  ]);

  useEffect(() => {
    api.getPresets().then(setPresets).catch(console.error);
  }, []);

  const updateProvider = (index, field, value) => {
    setSettings((prev) => {
      const providers = [...prev.providers];
      const provider = { ...providers[index], [field]: value };

      if (field === 'base_url' && NATIVE_URL_PRESETS.has(provider.preset)) {
        const defaultNative = NATIVE_BASE_URL_DEFAULTS[provider.preset];
        const currentNative = providers[index].native_base_url;
        if (!currentNative || currentNative === defaultNative) {
          provider.native_base_url = deriveNativeBaseUrl(value);
        }
      }

      providers[index] = provider;
      return { ...prev, providers };
    });
  };

  const addProviderFromPreset = (preset) => {
    if (settings.providers.some((p) => p.id === preset.id)) return;
    setSettings((prev) => ({
      ...prev,
      providers: [...prev.providers, { ...preset }],
    }));
  };

  const removeProvider = (providerId) => {
    setSettings((prev) => ({
      ...prev,
      providers: prev.providers.filter((p) => p.id !== providerId),
      council_members: prev.council_members.filter((m) => m.provider_id !== providerId),
    }));
  };

  const testProvider = async (provider) => {
    const result = await api.testProvider(provider);
    setTestResults((prev) => ({ ...prev, [provider.id]: result }));
  };

  const loadModels = async (providerId) => {
    try {
      const models = await api.listModels(providerId);
      setAvailableModels((prev) => ({ ...prev, [providerId]: models }));
    } catch {
      setAvailableModels((prev) => ({ ...prev, [providerId]: [] }));
    }
  };

  const toggleMemberEnabled = (memberId) => {
    setSettings((prev) => ({
      ...prev,
      council_members: prev.council_members.map((m) =>
        m.id === memberId ? { ...m, enabled: !m.enabled } : m
      ),
    }));
  };

  const addMember = (providerId, model, displayName) => {
    setSettings((prev) => ({
      ...prev,
      council_members: [
        ...prev.council_members,
        {
          id: `m${Date.now()}`,
          provider_id: providerId,
          model,
          display_name: displayName || model.split('/').pop(),
          enabled: true,
        },
      ],
    }));
  };

  const removeMember = (memberId) => {
    setSettings((prev) => ({
      ...prev,
      council_members: prev.council_members.filter((m) => m.id !== memberId),
      chairman_member_id:
        prev.chairman_member_id === memberId ? null : prev.chairman_member_id,
    }));
  };

  const applyCouncilPreset = (presetName) => {
    const preset = COUNCIL_PRESETS[presetName];
    if (!preset) return;
    if (
      presetName === 'nvidiaCloud' &&
      !settings.providers.some((p) => p.id === 'nvidia')
    ) {
      alert('Add the NVIDIA NIM provider under Providers (+ NVIDIA NIM) and save before applying this preset.');
      return;
    }
    const memberIdBase = Date.now();
    setSettings((prev) => ({
      ...prev,
      council_profile: preset.council_profile || prev.council_profile,
      council_members: preset.members.map((m, i) => ({
        id: `m${memberIdBase}${i}`,
        ...m,
        enabled: true,
      })),
      chairman_member_id: `m${memberIdBase}0`,
    }));
  };

  const buildSavePayload = (extra = {}) => {
    const payload = { ...settings, ...extra };
    delete payload.serper_api_key_configured;
    delete payload.serper_api_key_source;
    delete payload.nvidia_api_key_configured;
    delete payload.nvidia_api_key_source;
    if ('serper_api_key' in extra || 'nvidia_api_key' in extra) {
      return payload;
    }
    if (serperApiKeyInput.trim()) {
      payload.serper_api_key = serperApiKeyInput.trim();
    }
    if (nvidiaApiKeyInput.trim()) {
      payload.nvidia_api_key = nvidiaApiKeyInput.trim();
    }
    return payload;
  };

  const handleSave = async () => {
    const payload = buildSavePayload();
    const wantedMode = payload.deliberation_mode || 'rank';
    try {
      const saved = await onSave(payload);
      if (saved && typeof saved === 'object') {
        setSettings((prev) => ({ ...prev, ...saved }));
        if (
          (wantedMode === 'debate' || wantedMode === 'draft') &&
          saved.deliberation_mode !== wantedMode
        ) {
          alert(
            `${wantedMode === 'draft' ? 'Joint draft' : 'Debate'} mode did not persist. The app may be talking to an old backend on port 8001.\n\n` +
              'Close any start.ps1 / browser TinyLM Council servers, fully quit this app, then reopen the desktop app (v0.7.1+ uses port 18765).'
          );
          return;
        }
        if (
          Array.isArray(saved.features) &&
          wantedMode === 'debate' &&
          !saved.features.includes('debate')
        ) {
          alert(
            'This backend does not support Debate mode. Update to the latest desktop installer from GitHub Releases.'
          );
          return;
        }
        if (
          Array.isArray(saved.features) &&
          wantedMode === 'draft' &&
          !saved.features.includes('draft')
        ) {
          alert(
            'This backend does not support Joint draft mode. Update to the latest desktop installer from GitHub Releases.'
          );
          return;
        }
      }
      setSerperApiKeyInput('');
      setNvidiaApiKeyInput('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      alert(error.message || 'Failed to save settings');
    }
  };

  const clearSerperKey = async () => {
    await onSave(buildSavePayload({ serper_api_key: '' }));
    setSerperApiKeyInput('');
    setWebSearchTest(null);
  };

  const testWebSearch = async () => {
    setWebSearchTest(null);
    if (serperApiKeyInput.trim()) {
      await onSave(buildSavePayload());
      setSerperApiKeyInput('');
    }
    try {
      const result = await api.testWebSearch();
      setWebSearchTest(result);
    } catch (error) {
      setWebSearchTest({ ok: false, message: error.message || 'Web search test failed' });
    }
  };

  const clearNvidiaKey = async () => {
    await onSave(buildSavePayload({ nvidia_api_key: '' }));
    setNvidiaApiKeyInput('');
    setNvidiaTest(null);
  };

  const testNvidia = async () => {
    setNvidiaTest(null);
    if (nvidiaApiKeyInput.trim()) {
      await onSave(buildSavePayload());
      setNvidiaApiKeyInput('');
    }
    try {
      const result = await api.testNvidia();
      setNvidiaTest(result);
    } catch (error) {
      setNvidiaTest({ ok: false, message: error.message || 'NVIDIA test failed' });
    }
  };

  return (
    <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Settings</h1>
            <p className="mt-1 text-gray-400">Configure providers and your council</p>
          </div>
          <button
            onClick={handleSave}
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] sm:w-auto"
          >
            {saved ? 'Saved!' : 'Save changes'}
          </button>
        </div>

        <section className="mt-6 rounded-xl border border-gray-800 bg-[#12141c] p-4 md:p-6">
          <h2 className="text-lg font-medium text-white">Council profile</h2>
          <p className="mt-1 text-sm text-gray-400">
            Tiny profile uses shorter prompts and token limits for 0.5–4B local models.
          </p>
          <div className="mt-3 flex gap-2">
            {['tiny', 'standard'].map((profile) => (
              <button
                key={profile}
                onClick={() => setSettings((prev) => ({ ...prev, council_profile: profile }))}
                className={`rounded-lg px-4 py-2 text-sm capitalize ${
                  (settings.council_profile || 'tiny') === profile
                    ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {profile}
              </button>
            ))}
          </div>

          <h3 className="mt-6 text-base font-medium text-white">Deliberation mode</h3>
          <p className="mt-1 text-sm text-gray-400">
            Ranked peer review anonymously scores answers. Debate lets members rebut each other.
            Joint draft iterates one shared answer before the chairman finalizes.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { id: 'rank', label: 'Ranked peer review' },
              { id: 'debate', label: 'Debate' },
              { id: 'draft', label: 'Joint draft' },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() =>
                  setSettings((prev) => {
                    const next = { ...prev, deliberation_mode: mode.id };
                    if (
                      (mode.id === 'debate' || mode.id === 'draft') &&
                      (prev.debate_rounds == null || prev.debate_rounds < 1)
                    ) {
                      next.debate_rounds =
                        (prev.council_profile || 'tiny') === 'standard' ? 2 : 1;
                    }
                    return next;
                  })
                }
                className={`rounded-lg px-4 py-2 text-sm ${
                  (settings.deliberation_mode || 'rank') === mode.id
                    ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          {['debate', 'draft'].includes(settings.deliberation_mode || 'rank') && (
            <label className="mt-3 block text-sm text-gray-300">
              {(settings.deliberation_mode || 'rank') === 'draft' ? 'Draft rounds' : 'Debate rounds'}
              <select
                value={settings.debate_rounds || 1}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    debate_rounds: Number(e.target.value),
                  }))
                }
                className="mt-1 block rounded-lg border border-gray-700 bg-[#0f1117] px-3 py-2 text-gray-200"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}

          <h3 className="mt-6 text-base font-medium text-white">Run defaults</h3>
          <p className="mt-1 text-sm text-gray-400">
            Quick mode skips peer review/debate/draft and goes Stage 1 → chairman. You can still
            override per message in the composer.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { id: 'full', label: 'Full council' },
              { id: 'quick', label: 'Quick answer' },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() =>
                  setSettings((prev) => ({ ...prev, default_run_mode: mode.id }))
                }
                className={`rounded-lg px-4 py-2 text-sm ${
                  (settings.default_run_mode || 'full') === mode.id
                    ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <label className="mt-3 block text-sm text-gray-300">
            Default max members
            <select
              value={settings.default_max_members ?? ''}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  default_max_members: e.target.value ? Number(e.target.value) : null,
                }))
              }
              className="mt-1 block rounded-lg border border-gray-700 bg-[#0f1117] px-3 py-2 text-gray-200"
            >
              <option value="">All enabled</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </select>
          </label>

          <label className="mt-4 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={!!settings.parallel_local_inference}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  parallel_local_inference: e.target.checked,
                }))
              }
              className="mt-1"
            />
            <span className="text-sm text-gray-300">
              <span className="font-medium text-white">Allow more parallel local requests</span>
              <span className="mt-1 block text-gray-400">
                Off: up to 2 concurrent local calls (safer on one GPU). On: up to 4. Cloud providers
                stay unlimited.
              </span>
            </span>
          </label>
        </section>

        <section className="mt-6 rounded-xl border border-gray-800 bg-[#12141c] p-4 md:p-6">
          <h2 className="text-lg font-medium text-white">Web search</h2>
          <label className="mb-3 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={!!settings.web_search_auto}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  web_search_auto: e.target.checked,
                }))
              }
              className="mt-1"
            />
            <span className="text-sm text-gray-300">
              <span className="font-medium text-white">Skip search when not needed</span>
              <span className="mt-1 block text-gray-400">
                When the composer toggle is on, skip Serper for greetings, opinions, and pure coding
                prompts without freshness cues.
              </span>
            </span>
          </label>
          <p className="mt-1 text-sm text-gray-400">
            Optional pre-search before council runs. Uses{' '}
            <a
              href="https://serper.dev"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] hover:text-[var(--accent-hover)]"
            >
              Serper
            </a>{' '}
            (~2,500 free searches/month). You can also set <code className="text-gray-300">SERPER_API_KEY</code>{' '}
            in a root <code className="text-gray-300">.env</code> file instead.
          </p>
          <div className="mt-4 space-y-3">
            <label className="block text-sm text-gray-300">
              Serper API key
              {settings.serper_api_key_source === 'settings' && !serperApiKeyInput && (
                <span className="ml-2 text-green-400">Configured in app</span>
              )}
              {settings.serper_api_key_source === 'env' && !serperApiKeyInput && (
                <span className="ml-2 text-green-400">Configured via .env</span>
              )}
            </label>
            <input
              type="password"
              value={serperApiKeyInput}
              onChange={(e) => setSerperApiKeyInput(e.target.value)}
              placeholder={
                settings.serper_api_key_source === 'settings'
                  ? 'Key saved — enter a new key to replace'
                  : settings.serper_api_key_source === 'env'
                    ? 'Key from .env — enter here to override in app'
                    : 'Paste your Serper API key'
              }
              className="w-full rounded-md border border-gray-700 bg-[#0f1117] px-3 py-2 text-sm text-gray-300"
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={testWebSearch}
                className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
              >
                Test web search
              </button>
              {settings.serper_api_key_source === 'settings' && (
                <button
                  onClick={clearSerperKey}
                  className="rounded-md bg-red-900/30 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/50"
                >
                  Clear saved key
                </button>
              )}
            </div>
            {settings.serper_api_key_source === 'env' && (
              <p className="text-xs text-gray-500">
                To remove the .env key, edit or delete <code className="text-gray-400">SERPER_API_KEY</code>{' '}
                in your root <code className="text-gray-400">.env</code> file and restart the app.
              </p>
            )}
            {webSearchTest && (
              <div className={`text-sm ${webSearchTest.ok ? 'text-green-400' : 'text-red-400'}`}>
                {webSearchTest.message}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-gray-800 bg-[#12141c] p-4 md:p-6">
          <h2 className="text-lg font-medium text-white">NVIDIA NIM</h2>
          <p className="mt-1 text-sm text-gray-400">
            Cloud models via{' '}
            <a
              href="https://build.nvidia.com/models"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] hover:text-[var(--accent-hover)]"
            >
              NVIDIA NIM
            </a>
            . Add the <strong className="font-medium text-gray-300">+ NVIDIA NIM</strong> provider
            below, then browse the full catalog in Models. Optional{' '}
            <code className="text-gray-300">NVIDIA_API_KEY</code> in <code className="text-gray-300">.env</code>.
          </p>
          <div className="mt-4 space-y-3">
            <label className="block text-sm text-gray-300">
              NVIDIA API key
              {settings.nvidia_api_key_source === 'settings' && !nvidiaApiKeyInput && (
                <span className="ml-2 text-green-400">Configured in app</span>
              )}
              {settings.nvidia_api_key_source === 'env' && !nvidiaApiKeyInput && (
                <span className="ml-2 text-green-400">Configured via .env</span>
              )}
            </label>
            <input
              type="password"
              value={nvidiaApiKeyInput}
              onChange={(e) => setNvidiaApiKeyInput(e.target.value)}
              placeholder={
                settings.nvidia_api_key_source === 'settings'
                  ? 'Key saved — enter a new key to replace'
                  : settings.nvidia_api_key_source === 'env'
                    ? 'Key from .env — enter here to override in app'
                    : 'Paste your NVIDIA API key'
              }
              className="w-full rounded-md border border-gray-700 bg-[#0f1117] px-3 py-2 text-sm text-gray-300"
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={testNvidia}
                className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
              >
                Test connection
              </button>
              {settings.nvidia_api_key_source === 'settings' && (
                <button
                  onClick={clearNvidiaKey}
                  className="rounded-md bg-red-900/30 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/50"
                >
                  Clear saved key
                </button>
              )}
            </div>
            {settings.nvidia_api_key_source === 'env' && (
              <p className="text-xs text-gray-500">
                To remove the .env key, edit or delete{' '}
                <code className="text-gray-400">NVIDIA_API_KEY</code> in your root{' '}
                <code className="text-gray-400">.env</code> file and restart the app.
              </p>
            )}
            {nvidiaTest && (
              <div className={`text-sm ${nvidiaTest.ok ? 'text-green-400' : 'text-red-400'}`}>
                {nvidiaTest.message}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-gray-800 bg-[#12141c] p-4 md:p-6">
          <h2 className="text-lg font-medium text-white">Council presets</h2>
          <p className="mt-1 text-sm text-gray-400">
            Mini coding council uses tiny code models — run{' '}
            <code className="text-gray-300">ollama pull qwen2.5-coder:1.5b</code> (and the other
            preset models) if they are not installed yet.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => applyCouncilPreset('tinyLocal')}
              className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
            >
              Tiny local council (Ollama)
            </button>
            <button
              onClick={() => applyCouncilPreset('miniCoding')}
              title="Requires qwen2.5-coder and deepseek-coder models in Ollama"
              className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
            >
              Mini coding council (Ollama)
            </button>
            <button
              onClick={() => applyCouncilPreset('cloud')}
              className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
            >
              Cloud council (OpenRouter)
            </button>
            <button
              onClick={() => applyCouncilPreset('nvidiaCloud')}
              title="Requires NVIDIA NIM provider and API key; Llama 8B, Gemma 9B, Phi-3 Mini"
              className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
            >
              NVIDIA cloud council
            </button>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-gray-800 bg-[#12141c] p-4 md:p-6">
          <h2 className="text-lg font-medium text-white">Providers</h2>
          <div className="mt-4 space-y-4">
            {settings.providers.map((provider, index) => (
              <div key={provider.id} className="rounded-lg border border-gray-700 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <input
                      value={provider.name}
                      onChange={(e) => updateProvider(index, 'name', e.target.value)}
                      className="w-full rounded-md border border-gray-700 bg-[#0f1117] px-3 py-2 text-white"
                    />
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">base_url (OpenAI-compatible API)</label>
                      <input
                        value={provider.base_url}
                        onChange={(e) => updateProvider(index, 'base_url', e.target.value)}
                        className="w-full rounded-md border border-gray-700 bg-[#0f1117] px-3 py-2 text-sm text-gray-300"
                      />
                    </div>
                    {NATIVE_URL_PRESETS.has(provider.preset) && (
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">
                          native_base_url (model listing / pull)
                        </label>
                        <input
                          value={provider.native_base_url || ''}
                          onChange={(e) => updateProvider(index, 'native_base_url', e.target.value)}
                          className="w-full rounded-md border border-gray-700 bg-[#0f1117] px-3 py-2 text-sm text-gray-300"
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => testProvider(provider)}
                      className="flex-1 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 sm:flex-none"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => removeProvider(provider.id)}
                      className="flex-1 rounded-md bg-red-900/30 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/50 sm:flex-none"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {testResults[provider.id] && (
                  <div
                    className={`mt-2 text-sm ${
                      testResults[provider.id].ok ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {testResults[provider.id].message}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4">
            <p className="mb-2 text-sm text-gray-400">Add provider preset:</p>
            <div className="flex flex-wrap gap-2">
              {presets
                .filter((p) => !settings.providers.some((sp) => sp.id === p.id))
                .map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => addProviderFromPreset(preset)}
                    className="rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-300 hover:bg-gray-700"
                  >
                    + {preset.name}
                  </button>
                ))}
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-gray-800 bg-[#12141c] p-4 md:p-6">
          <h2 className="text-lg font-medium text-white">Council members</h2>
          <div className="mt-4 space-y-3">
            {settings.council_members.map((member) => (
              <div
                key={member.id}
                className="rounded-lg border border-gray-700 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="break-words font-medium text-white">{member.display_name}</div>
                  <div className="mt-1 break-all text-xs text-gray-500">
                    {member.model} · {member.provider_id}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-800 pt-3">
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="radio"
                      name="chairman"
                      checked={settings.chairman_member_id === member.id}
                      onChange={() =>
                        setSettings((prev) => ({ ...prev, chairman_member_id: member.id }))
                      }
                    />
                    Chairman
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={member.enabled}
                      onChange={() => toggleMemberEnabled(member.id)}
                    />
                    Enabled
                  </label>
                  <label
                    className="flex items-center gap-2 text-sm text-gray-300"
                    title="Send attached images to this member as vision input. Leave unset to auto-detect from the model name."
                  >
                    <input
                      type="checkbox"
                      checked={member.vision_capable === true}
                      onChange={() =>
                        setSettings((prev) => ({
                          ...prev,
                          council_members: prev.council_members.map((m) =>
                            m.id === member.id
                              ? {
                                  ...m,
                                  vision_capable: m.vision_capable === true ? null : true,
                                }
                              : m
                          ),
                        }))
                      }
                    />
                    Vision
                  </label>
                  <button
                    onClick={() => removeMember(member.id)}
                    className="text-sm text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {settings.providers.map((provider) => (
            <div key={provider.id} className="mt-4 rounded-lg border border-gray-700 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-gray-300">Add from {provider.name}</span>
                <button
                  onClick={() => loadModels(provider.id)}
                  className="text-left text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] sm:text-right"
                >
                  Load models
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(availableModels[provider.id] || []).slice(0, 15).map((model) => (
                  <button
                    key={model.id}
                    onClick={() => addMember(provider.id, model.id, model.name)}
                    className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
                  >
                    + {model.name || model.id}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
