import { isLocalWhisperConfigured, localWhisperConfig, transcribeLocalWhisper } from './localWhisper.js';
import { transcribeOpenAI } from './openaiWhisper.js';

export function normalizeSttProviderId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (id === 'local' || id === 'whisper' || id === 'local_whisper' || id === 'local-whisper') return 'local-whisper';
  if (id === 'openai' || id === 'openai-whisper' || id === 'whisper-api') return 'openai';
  return 'openai';
}

export function chooseSttProvider(options = {}) {
  const env = options.env || process.env;
  const requested = normalizeSttProviderId(env.STT_PROVIDER || 'openai');
  if (requested === 'local-whisper') {
    if (isLocalWhisperConfigured(env)) {
      const config = localWhisperConfig(env);
      return { id: 'local-whisper', modelId: config.modelId, modelDir: config.modelDir, reason: 'configured' };
    }
    return { id: 'openai', reason: 'local-whisper not configured; LOCAL_WHISPER_MODEL_DIR is required' };
  }
  return { id: 'openai', reason: 'default' };
}

function defaultProviders() {
  return {
    openai: { transcribe: transcribeOpenAI },
    'local-whisper': { transcribe: transcribeLocalWhisper },
  };
}

export async function transcribeAudio(audioPath, options = {}) {
  const env = options.env || process.env;
  const providers = { ...defaultProviders(), ...(options.providers || {}) };
  const chosen = chooseSttProvider({ env });
  const provider = providers[chosen.id] || providers.openai;
  try {
    const result = await provider.transcribe(audioPath, { ...options, env, selectedProvider: chosen });
    if (!result?.words?.length) return null;
    return {
      provider: chosen.id,
      words: result.words,
      audioPath: result.audioPath || audioPath,
    };
  } catch (err) {
    if (chosen.id !== 'openai' && providers.openai) {
      const fallback = await providers.openai.transcribe(audioPath, { ...options, env, selectedProvider: { id: 'openai', reason: `fallback from ${chosen.id}` } });
      if (!fallback?.words?.length) return null;
      return {
        provider: 'openai',
        fallbackFrom: chosen.id,
        fallbackError: String(err?.message || err),
        words: fallback.words,
        audioPath: fallback.audioPath || audioPath,
      };
    }
    throw err;
  }
}
