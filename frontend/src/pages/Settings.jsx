import { useEffect, useState } from 'react';
import { api } from '../api';

const COUNCIL_PRESETS = {
  tinyLocal: [
    { provider_id: 'ollama', model: 'qwen2.5:0.5b', display_name: 'Qwen 0.5B' },
    { provider_id: 'ollama', model: 'phi3:mini', display_name: 'Phi-3 Mini' },
    { provider_id: 'ollama', model: 'gemma2:2b', display_name: 'Gemma 2B' },
  ],
  cloud: [
    { provider_id: 'openrouter', model: 'google/gemini-2.5-flash', display_name: 'Gemini Flash' },
    { provider_id: 'openrouter', model: 'openai/gpt-4o-mini', display_name: 'GPT-4o Mini' },
    { provider_id: 'openrouter', model: 'anthropic/claude-3.5-sonnet', display_name: 'Claude 3.5' },
  ],
};

export default function Settings({ settings: initialSettings, onSave }) {
  const [settings, setSettings] = useState(initialSettings);
  const [presets, setPresets] = useState([]);
  const [testResults, setTestResults] = useState({});
  const [saved, setSaved] = useState(false);
  const [availableModels, setAvailableModels] = useState({});

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  useEffect(() => {
    api.getPresets().then(setPresets).catch(console.error);
  }, []);

  const updateProvider = (index, field, value) => {
    setSettings((prev) => {
      const providers = [...prev.providers];
      providers[index] = { ...providers[index], [field]: value };
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
    setSettings((prev) => ({
      ...prev,
      council_members: preset.map((m, i) => ({
        id: `m${Date.now()}${i}`,
        ...m,
        enabled: true,
      })),
      chairman_member_id: `m${Date.now()}0`,
    }));
  };

  const handleSave = async () => {
    await onSave(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 sm:w-auto"
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
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {profile}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-gray-800 bg-[#12141c] p-4 md:p-6">
          <h2 className="text-lg font-medium text-white">Council presets</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => applyCouncilPreset('tinyLocal')}
              className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
            >
              Tiny local council (Ollama)
            </button>
            <button
              onClick={() => applyCouncilPreset('cloud')}
              className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
            >
              Cloud council (OpenRouter)
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
                    <input
                      value={provider.base_url}
                      onChange={(e) => updateProvider(index, 'base_url', e.target.value)}
                      className="w-full rounded-md border border-gray-700 bg-[#0f1117] px-3 py-2 text-sm text-gray-300"
                    />
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
                  className="text-left text-sm text-indigo-400 hover:text-indigo-300 sm:text-right"
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
