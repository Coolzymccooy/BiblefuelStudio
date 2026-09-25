export function mapWhisperChunksToWords(chunks) {
  const words = [];
  for (const chunk of chunks || []) {
    const timestamp = chunk?.timestamp;
    if (!timestamp || timestamp[0] == null || timestamp[1] == null) continue;
    const text = String(chunk?.text || '').trim();
    const start = Number(timestamp[0]);
    const end = Number(timestamp[1]);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    words.push({ text, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
  }
  return words;
}

export function isLocalWhisperConfigured(env = process.env) {
  return Boolean(String(env.LOCAL_WHISPER_MODEL_DIR || '').trim());
}

export function localWhisperConfig(env = process.env) {
  return {
    modelDir: String(env.LOCAL_WHISPER_MODEL_DIR || '').trim(),
    modelId: String(env.LOCAL_WHISPER_MODEL_ID || 'Xenova/whisper-base').trim() || 'Xenova/whisper-base',
    ffmpeg: String(env.FFMPEG_PATH || 'ffmpeg').trim() || 'ffmpeg',
  };
}

function decodePcmFloat32(audioPath, ffmpeg) {
  return new Promise(async (resolve, reject) => {
    const { spawn } = await import('node:child_process');
    const proc = spawn(ffmpeg, ['-i', audioPath, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-hide_banner', '-loglevel', 'error', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => { err += String(d); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`));
      const buffer = Buffer.concat(chunks);
      const floats = new Float32Array(buffer.byteLength / 4);
      for (let i = 0; i < floats.length; i += 1) floats[i] = buffer.readFloatLE(i * 4);
      resolve(floats);
    });
  });
}

let transcriberPromise = null;
async function getTranscriber(config) {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowRemoteModels = false;
      env.localModelPath = config.modelDir;
      return pipeline('automatic-speech-recognition', config.modelId, { dtype: 'q8' });
    })().catch((err) => {
      transcriberPromise = null;
      throw err;
    });
  }
  return transcriberPromise;
}

export async function transcribeLocalWhisper(audioPath, options = {}) {
  const env = options.env || process.env;
  const config = localWhisperConfig(env);
  if (!config.modelDir) return null;
  const audio = await (options.decodePcm || decodePcmFloat32)(audioPath, config.ffmpeg);
  const transcriber = await (options.getTranscriber || getTranscriber)(config);
  const result = await transcriber(audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
  const words = mapWhisperChunksToWords(result?.chunks || []);
  return words.length ? { words, audioPath } : null;
}
