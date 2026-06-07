import { useEffect, useState } from 'react';
import { api } from '../api';

export default function ModelManager({ settings, onMemberAdded }) {
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [capabilities, setCapabilities] = useState(null);
  const [models, setModels] = useState([]);
  const [modelName, setModelName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState('');
  const [loadingModel, setLoadingModel] = useState('');

  const localProviders = settings?.providers?.filter(
    (p) => p.preset === 'ollama' || p.preset === 'lmstudio'
  ) || [];

  useEffect(() => {
    if (localProviders.length > 0 && !selectedProviderId) {
      setSelectedProviderId(localProviders[0].id);
    }
  }, [localProviders, selectedProviderId]);

  useEffect(() => {
    if (selectedProviderId) {
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
    try {
      await api.addCouncilMember(
        selectedProviderId,
        model.id || model,
        (model.name || model.id || model).split('/').pop()
      );
      setMessage(`Added ${model.name || model} to council`);
      onMemberAdded?.();
    } catch (error) {
      setMessage(String(error));
    }
  };

  const selectedProvider = settings?.providers?.find((p) => p.id === selectedProviderId);

  return (
    <main className="flex-1 overflow-y-auto p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold text-white">Model Manager</h1>
        <p className="mt-1 text-gray-400">
          Download, load, and manage local models. Cloud models (OpenRouter) are configured in Settings.
        </p>

        {localProviders.length === 0 ? (
          <div className="mt-8 rounded-xl border border-gray-800 bg-[#12141c] p-6 text-gray-400">
            No local providers configured. Add Ollama or LM Studio in Settings first.
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              {localProviders.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProviderId(provider.id)}
                  className={`rounded-lg px-4 py-2 text-sm ${
                    selectedProviderId === provider.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {provider.name}
                </button>
              ))}
            </div>

            {capabilities && (
              <div className="mt-4 rounded-lg border border-gray-800 bg-[#12141c] p-4 text-sm text-gray-400">
                {capabilities.notes}
              </div>
            )}

            {(capabilities?.can_pull || capabilities?.popular_models?.length > 0) && (
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
                    onClick={() => handlePull()}
                    disabled={pulling || !modelName.trim()}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {pulling ? 'Downloading...' : 'Download'}
                  </button>
                </div>

                {capabilities?.popular_models?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {capabilities.popular_models.map((name) => (
                      <button
                        key={name}
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

            <section className="mt-6 rounded-xl border border-gray-800 bg-[#12141c] p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-white">Installed models</h2>
                <button
                  onClick={refreshAll}
                  className="text-sm text-indigo-400 hover:text-indigo-300"
                >
                  Refresh
                </button>
              </div>

              {models.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">
                  No models found. Pull or download a model above, or ensure your provider is running.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {models.map((model) => (
                    <div
                      key={model.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-700 px-4 py-3"
                    >
                      <div>
                        <div className="font-medium text-white">{model.name || model.id}</div>
                        {model.loaded && (
                          <span className="text-xs text-green-400">Loaded in memory</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleAddToCouncil(model)}
                          className="rounded-md bg-indigo-900/40 px-3 py-1 text-xs text-indigo-300 hover:bg-indigo-900/60"
                        >
                          Add to council
                        </button>
                        {capabilities?.can_load && selectedProvider?.preset === 'lmstudio' && (
                          <button
                            onClick={() => handleLoad(model.id)}
                            disabled={loadingModel === model.id}
                            className="rounded-md bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                          >
                            {loadingModel === model.id ? 'Loading...' : 'Load'}
                          </button>
                        )}
                        {capabilities?.can_unload && model.loaded && (
                          <button
                            onClick={() => handleUnload(model.id)}
                            className="rounded-md bg-gray-800 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
                          >
                            Unload
                          </button>
                        )}
                        {capabilities?.can_delete && (
                          <button
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
