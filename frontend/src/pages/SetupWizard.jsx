import { useEffect, useState } from 'react';
import { api } from '../api';

const STEPS = ['Providers', 'Test connections', 'Council members', 'Chairman'];

export default function SetupWizard({ initialSettings, onComplete }) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState(initialSettings);
  const [presets, setPresets] = useState([]);
  const [testResults, setTestResults] = useState({});
  const [availableModels, setAvailableModels] = useState({});
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.getPresets().then(setPresets).catch(console.error);
  }, []);

  const toggleProvider = (preset) => {
    setSettings((prev) => {
      const exists = prev.providers.some((p) => p.id === preset.id);
      if (exists) {
        return {
          ...prev,
          providers: prev.providers.filter((p) => p.id !== preset.id),
          council_members: prev.council_members.filter((m) => m.provider_id !== preset.id),
        };
      }
      return {
        ...prev,
        providers: [...prev.providers, { ...preset }],
      };
    });
  };

  const testAllProviders = async () => {
    setTesting(true);
    const results = {};
    for (const provider of settings.providers) {
      try {
        results[provider.id] = await api.testProvider(provider);
      } catch (error) {
        results[provider.id] = { ok: false, message: String(error) };
      }
    }
    setTestResults(results);
    setTesting(false);
  };

  const loadModelsForProvider = async (providerId) => {
    try {
      const models = await api.listModels(providerId);
      setAvailableModels((prev) => ({ ...prev, [providerId]: models }));
    } catch {
      setAvailableModels((prev) => ({ ...prev, [providerId]: [] }));
    }
  };

  const toggleMember = (providerId, model, displayName) => {
    setSettings((prev) => {
      const exists = prev.council_members.some(
        (m) => m.provider_id === providerId && m.model === model
      );
      if (exists) {
        return {
          ...prev,
          council_members: prev.council_members.filter(
            (m) => !(m.provider_id === providerId && m.model === model)
          ),
        };
      }
      return {
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
      };
    });
  };

  const enabledMembers = settings.council_members.filter((m) => m.enabled);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f1117] p-6">
      <div className="w-full max-w-3xl rounded-2xl border border-gray-800 bg-[#12141c] p-8">
        <h1 className="text-2xl font-semibold text-white">Welcome to TinyLM Council</h1>
        <p className="mt-2 text-gray-400">Let&apos;s set up your council in a few steps.</p>

        <div className="mt-6 flex gap-2">
          {STEPS.map((label, index) => (
            <div
              key={label}
              className={`rounded-full px-3 py-1 text-xs ${
                index === step
                  ? 'bg-indigo-600 text-white'
                  : index < step
                    ? 'bg-green-900/40 text-green-300'
                    : 'bg-gray-800 text-gray-400'
              }`}
            >
              {index + 1}. {label}
            </div>
          ))}
        </div>

        <div className="mt-8 min-h-[320px]">
          {step === 0 && (
            <div>
              <h2 className="text-lg font-medium text-white">Choose providers</h2>
              <p className="mt-1 text-sm text-gray-400">
                Select cloud and/or local LLM backends.
              </p>
              <div className="mt-4 space-y-2">
                {presets.map((preset) => {
                  const selected = settings.providers.some((p) => p.id === preset.id);
                  return (
                    <button
                      key={preset.id}
                      onClick={() => toggleProvider(preset)}
                      className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left ${
                        selected
                          ? 'border-indigo-500 bg-indigo-950/30'
                          : 'border-gray-700 hover:border-gray-600'
                      }`}
                    >
                      <div>
                        <div className="font-medium text-white">{preset.name}</div>
                        <div className="text-xs text-gray-500">{preset.base_url}</div>
                      </div>
                      <span className="text-sm text-gray-400">{selected ? 'Selected' : 'Add'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="text-lg font-medium text-white">Test connections</h2>
              <p className="mt-1 text-sm text-gray-400">
                Verify each provider is reachable. For OpenRouter, set OPENROUTER_API_KEY in .env first.
              </p>
              <button
                onClick={testAllProviders}
                disabled={testing}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {testing ? 'Testing...' : 'Test all connections'}
              </button>
              <div className="mt-4 space-y-2">
                {settings.providers.map((provider) => {
                  const result = testResults[provider.id];
                  return (
                    <div
                      key={provider.id}
                      className="rounded-lg border border-gray-700 px-4 py-3"
                    >
                      <div className="font-medium text-white">{provider.name}</div>
                      {result ? (
                        <div className={`text-sm ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
                          {result.message}
                          {result.latency_ms != null && ` (${result.latency_ms}ms)`}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500">Not tested yet</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-lg font-medium text-white">Pick council members</h2>
              <p className="mt-1 text-sm text-gray-400">
                Select at least 2 models. Click a provider to load available models.
              </p>
              {settings.providers.map((provider) => (
                <div key={provider.id} className="mt-4 rounded-lg border border-gray-700 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{provider.name}</span>
                    <button
                      onClick={() => loadModelsForProvider(provider.id)}
                      className="text-sm text-indigo-400 hover:text-indigo-300"
                    >
                      Refresh models
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(availableModels[provider.id] || []).slice(0, 20).map((model) => {
                      const selected = settings.council_members.some(
                        (m) => m.provider_id === provider.id && m.model === model.id
                      );
                      return (
                        <button
                          key={model.id}
                          onClick={() => toggleMember(provider.id, model.id, model.name)}
                          className={`rounded-full px-3 py-1 text-xs ${
                            selected
                              ? 'bg-indigo-600 text-white'
                              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                          }`}
                        >
                          {model.name || model.id}
                        </button>
                      );
                    })}
                    {(availableModels[provider.id] || []).length === 0 && (
                      <span className="text-sm text-gray-500">
                        No models loaded — click Refresh or add models in Model Manager
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <p className="mt-3 text-sm text-gray-400">
                Selected: {enabledMembers.length} member(s)
              </p>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-lg font-medium text-white">Choose chairman</h2>
              <p className="mt-1 text-sm text-gray-400">
                The chairman synthesizes the final answer from all opinions and rankings.
              </p>
              <div className="mt-4 space-y-2">
                {enabledMembers.map((member) => (
                  <button
                    key={member.id}
                    onClick={() =>
                      setSettings((prev) => ({ ...prev, chairman_member_id: member.id }))
                    }
                    className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left ${
                      settings.chairman_member_id === member.id
                        ? 'border-indigo-500 bg-indigo-950/30'
                        : 'border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    <div>
                      <div className="font-medium text-white">{member.display_name}</div>
                      <div className="text-xs text-gray-500">{member.model}</div>
                    </div>
                    {settings.chairman_member_id === member.id && (
                      <span className="text-sm text-indigo-400">Chairman</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 flex justify-between">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 0 && settings.providers.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              onClick={() => onComplete(settings)}
              disabled={enabledMembers.length < 2 || !settings.chairman_member_id}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-500 disabled:opacity-50"
            >
              Finish setup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
