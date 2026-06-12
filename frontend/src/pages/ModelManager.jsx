import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const LOCAL_PRESETS = new Set(['ollama', 'lmstudio']);
const CLOUD_PRESETS = new Set(['openrouter', 'nvidia']);

function isLargeModelId(modelId) {
  const id = (modelId || '').toLowerCase();
  return /70b|120b|405b|180b|550b|72b|90b/.test(id);
}

export default function ModelManager({ settings, onMemberAdded }) {
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [capabilities, setCapabilities] = useState(null);
  const [models, setModels] = useState([]);
  const [modelName, setModelName] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState('');
  const [loadingModel, setLoadingModel] = useState('');

  const localProviders =
    settings?.providers?.filter((p) => LOCAL_PRESETS.has(p.preset)) || [];
  const cloudProviders =
    settings?.providers?.filter((p) => CLOUD_PRESETS.has(p.preset)) || [];
  const allProviders = [...localProviders, ...cloudProviders];

  useEffect(() => {
    if (allProviders.length > 0 && !selectedProviderId) {
      setSelectedProviderId(allProviders[0].id);
    }
  }, [allProviders, selectedProviderId]);

  useEffect(() => {
    if (selectedProviderId) {
      setModelSearch('');
      refreshAll();
    }
  }, [selectedProviderId]);

  const refreshAll = async () => {
    if (!selectedProviderId) return;
    try {
      const [caps, modelList] = await Promise.all([
        api.getCapabilities(selectedProviderId),
        api.listModels(selectedProviderId),
      ]);
      setCapabilities(caps);
      setModels(modelList);
      setMessage('');
    } catch (error) {
      setMessage(String(error));
    }
  };

  const handlePull = async (name) => {
    const target = name || modelName.trim();
    if (!target) return;
    setPulling(true);
    setProgress(null);
    setMessage('');
    try {
      await api.pullModelStream(selectedProviderId, target, (event) => {
        if (event.type === 'progress') {
          setProgress(event);
        } else if (event.type === 'complete') {
          setMessage(`Successfully installed ${event.model}`);
          setModelName('');
          refreshAll();
        } else if (event.type === 'error') {
          setMessage(event.message || 'Pull failed');
        }
      });
    } catch (error) {
      setMessage(String(error));
    } finally {
      setPulling(false);
      setProgress(null);
    }
  };

  const handleLoad = async (model) => {
    setLoadingModel(model);
    setMessage('');
    try {
      const result = await api.loadModel(selectedProviderId, model);
      setMessage(result.message || `Loaded ${model}`);
      refreshAll();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoadingModel('');
    }
  };

  const handleUnload = async (model) => {
    try {
      await api.unloadModel(selectedProviderId, model);
      setMessage(`Unloaded ${model}`);
      refreshAll();
    } catch (error) {
      setMessage(String(error));
    }
  };

  const handleDelete = async (model) => {
    if (!confirm(`Delete model ${model}?`)) return;
    try {
      await api.deleteModel(selectedProviderId, model);
      setMessage(`Deleted ${model}`);
      refreshAll();
    } catch (error) {
      setMessage(String(error));
    }
  };

  const handleAddToCouncil = async (model) => {
    const modelId = model.id || model;
    try {
      if (
        (settings?.council_profile || 'tiny') === 'tiny' &&
        isLargeModelId(modelId)
      ) {
        setMessage(
          'Tip: Large cloud models work best on the Standard council profile (Settings).'
        );
      }
      await api.addCouncilMember(
        selectedProviderId,
        modelId,
        (model.name || modelId).split('/').pop()
      );
      setMessage(`Added ${model.name || modelId} to council`);
      onMemberAdded?.();
    } catch (error) {
      setMessage(String(error));
    }
  };

  const selectedProvider = settings?.providers?.find((p) => p.id === selectedProviderId);
  const isCloudProvider = CLOUD_PRESETS.has(selectedProvider?.preset);

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((m) => (m.id || m.name || '').toLowerCase().includes(query));
  }, [models, modelSearch]);

  const renderProviderTabs = (providers) =>
    providers.map((provider) => (
      <button
        key={provider.id}
        type="button"
        onClick={() => setSelectedProviderId(provider.id)}
        className={`rounded-lg px-4 py-2 text-sm ${
          selectedProviderId === provider.id
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
        }`}
      >
        {provider.name}
      </button>
    ));

  return (
    <main className="flex-1 overflow-y-auto p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold text-white">Model Manager</h1>
        <p className="mt-1 text-gray-400">
          Pull local models (Ollama, LM Studio) or browse cloud catalogs (OpenRouter, NVIDIA NIM).
          NVIDIA API keys are set in Settings.
        </p>

        {allProviders.length === 0 ? (
          <div className="mt-8 rounded-xl border border-gray-800 bg-[#12141c] p-6 text-gray-400">
            No model providers configured. Add Ollama, LM Studio, OpenRouter, or NVIDIA NIM in
            Settings.
          </div>
        ) : (
          <>
            {localProviders.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Local
                </p>
                <div className="flex flex-wrap gap-2">{renderProviderTabs(localProviders)}</div>
              </div>
            )}
            {cloudProviders.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Cloud
                </p>
                <div className="flex flex-wrap gap-2">{renderProviderTabs(cloudProviders)}</div>
              </div>
            )}

            {capabilities && (
              <div className="mt-4 rounded-lg border border-gray-800 bg-[#12141c] p-4 text-sm text-gray-400">
                {capabilities.notes}
              </div>
            )}

            {capabilities?.can_pull && (
              <section className="mt-6 rounded-xl border border-gray-800 bg-[#12141c] p-6">
                <h2 className="text-lg font-medium text-white">
                  {selectedProvider?.preset === 'ollama' ? 'Pull model' : 'Download model'}
                </h2>
                <div className="mt-3 flex gap-2">
                  <input
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="e.g. llama3.2"
                    className="flex-1 rounded-lg border border-gray-700 bg-[#0f1117] px-4 py-2 text-white"
                    disabled={pulling}
                  />
                  <button
                    type="button"
                    onClick={() => handlePull()}
                    disabled={pulling || !modelName.trim()}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {pulling ? 'Downloading...' : 'Download'}
                  </button>
                </div>

                {capabilities?.popular_models?.length > 0 && !isCloudProvider && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {capabilities.popular_models.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          setModelName(name);
                          handlePull(name);
                        }}
                        disabled={pulling}
                        className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}

                {progress && (
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between text-xs text-gray-400">
                      <span>{progress.message || progress.status}</span>
                      {progress.percent != null && <span>{progress.percent}%</span>}
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full bg-indigo-500 transition-all"
                        style={{ width: `${progress.percent || 5}%` }}
                      />
                    </div>
                  </div>
                )}
              </section>
            )}

            {isCloudProvider && capabilities?.popular_models?.length > 0 && (
              <section className="mt-6 rounded-xl border border-gray-800 bg-[#12141c] p-6">
                <h2 className="text-lg font-medium text-white">Featured models</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Quick-add popular models. Browse the full catalog below.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {capabilities.popular_models.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => handleAddToCouncil({ id: name, name })}
                      className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
                    >
                      + {name.split('/').pop()}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-6 rounded-xl border border-gray-800 bg-[#12141c] p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-medium text-white">
                  {isCloudProvider ? 'Available models' : 'Installed models'}
                </h2>
                <button
                  type="button"
                  onClick={refreshAll}
                  className="text-left text-sm text-indigo-400 hover:text-indigo-300 sm:text-right"
                >
                  Refresh
                </button>
              </div>

              {isCloudProvider && (
                <div className="mt-4">
                  <input
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="Search models..."
                    className="w-full rounded-lg border border-gray-700 bg-[#0f1117] px-4 py-2 text-sm text-white"
                  />
                  {models.length > 0 && (
                    <p className="mt-2 text-xs text-gray-500">
                      Showing {filteredModels.length} of {models.length} models
                    </p>
                  )}
                </div>
              )}

              {models.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">
                  {selectedProvider?.preset === 'nvidia'
                    ? 'No models found. Add your NVIDIA API key in Settings → NVIDIA NIM, then Refresh.'
                    : selectedProvider?.preset === 'openrouter'
                      ? 'No models found. Set OPENROUTER_API_KEY in .env and Refresh.'
                      : 'No models found. Pull or download a model above, or ensure your provider is running.'}
                </p>
              ) : filteredModels.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">No models match your search.</p>
              ) : (
                <div className="mt-4 max-h-[32rem] space-y-2 overflow-y-auto">
                  {filteredModels.map((model) => (
                    <div
                      key={model.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-700 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="break-all font-medium text-white">
                          {model.name || model.id}
                        </div>
                        {model.loaded && (
                          <span className="text-xs text-green-400">Loaded in memory</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleAddToCouncil(model)}
                          className="rounded-md bg-indigo-900/40 px-3 py-1 text-xs text-indigo-300 hover:bg-indigo-900/60"
                        >
                          Add to council
                        </button>
                        {capabilities?.can_load && selectedProvider?.preset === 'lmstudio' && (
                          <button
                            type="button"
                            onClick={() => handleLoad(model.id)}
                            disabled={loadingModel === model.id}
                            className="rounded-md bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                          >
                            {loadingModel === model.id ? 'Loading...' : 'Load'}
                          </button>
                        )}
                        {capabilities?.can_unload && model.loaded && (
                          <button
                            type="button"
                            onClick={() => handleUnload(model.id)}
                            className="rounded-md bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
                          >
                            Unload
                          </button>
                        )}
                        {capabilities?.can_delete && (
                          <button
                            type="button"
                            onClick={() => handleDelete(model.id)}
                            className="rounded-md bg-red-900/30 px-3 py-1 text-xs text-red-300 hover:bg-red-900/50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {message && (
          <div className="mt-4 rounded-lg border border-gray-700 bg-[#0f1117] px-4 py-3 text-sm text-gray-300">
            {message}
          </div>
        )}
      </div>
    </main>
  );
}
