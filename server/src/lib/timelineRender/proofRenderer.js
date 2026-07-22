import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';
import { OUTPUT_DIR } from '../paths.js';
import { get as getVoiceProvider } from '../voice/index.js';

function isSubPath(child, parent) {
  const rel = path.relative(parent, child);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel)) || rel === '';
}

function normalizeOutputPublicUrl(outputPath, outputDir) {
  const rel = path.relative(outputDir, outputPath).replace(/\\/g, '/');
  return `/outputs/${rel}`;
}

export function resolveTimelineAssetPath(rawPath, opts = {}) {
  if (!rawPath) return null;
  const serverRoot = path.resolve(opts.serverRoot || process.cwd());
  const outputDir = path.resolve(opts.outputDir || OUTPUT_DIR);
  const value = String(rawPath).replace(/\\/g, '/');

  if (/^https?:\/\//i.test(value)) return value;

  let resolved;
  if (value.startsWith('/outputs/')) {
    resolved = path.resolve(outputDir, value.slice('/outputs/'.length));
    return isSubPath(resolved, outputDir) ? resolved : null;
  }
  if (value.startsWith('outputs/')) {
    resolved = path.resolve(outputDir, value.slice('outputs/'.length));
    return isSubPath(resolved, outputDir) ? resolved : null;
  }
  if (path.isAbsolute(rawPath)) {
    resolved = path.resolve(rawPath);
    return (isSubPath(resolved, serverRoot) || isSubPath(resolved, outputDir)) ? resolved : null;
  }
  resolved = path.resolve(serverRoot, value);
  return isSubPath(resolved, serverRoot) ? resolved : null;
}

function firstClip(plan, kind) {
  return plan.tracks?.find((track) => track.kind === kind)?.clips?.find((clip) => clip.path) || null;
}

function brollClips(plan) {
  return (plan.tracks?.find((track) => track.kind === 'broll')?.clips || []).filter((clip) => clip.path);
}

function voiceoverClips(plan) {
  return (plan.tracks?.find((track) => track.kind === 'voiceover')?.clips || [])
    .filter((clip) => clip.prompt || clip.path);
}

function outputRelativePath(absPath, outputDir) {
  return `/outputs/${path.relative(outputDir, absPath).replace(/\\/g, '/')}`;
}

function safeId(value) {
  return String(value || 'timeline').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'timeline';
}

export async function synthesizeChatterboxVoiceover({ text, outputPath, endpoint = process.env.CHATTERBOX_URL || 'http://127.0.0.1:8000', timeoutMs = 180000 }) {
  if (!text || !String(text).trim()) return { ok: false, error: 'Voiceover text required' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    const sharedSecret = String(process.env.ABI_TTS_SHARED_SECRET || '').trim();
    if (sharedSecret) headers['x-abi-secret'] = sharedSecret;
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/tts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: String(text).trim(), output_format: 'wav' }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: `Chatterbox TTS failed: HTTP ${response.status}` };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return { ok: true, outputPath, bytes: buffer.length, provider: 'chatterbox' };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function synthesizeAbiVoiceover({ text, outputPath, endpoint = process.env.ABI_TTS_URL || process.env.ABI_VOICE_URL, timeoutMs = Number(process.env.ABI_TTS_TIMEOUT_MS || 120000) }) {
  if (!endpoint) return { ok: false, error: 'ABI_TTS_URL not configured' };
  if (!text || !String(text).trim()) return { ok: false, error: 'Voiceover text required' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    const sharedSecret = String(process.env.ABI_TTS_SHARED_SECRET || '').trim();
    if (sharedSecret) headers['x-abi-secret'] = sharedSecret;
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/tts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: String(text).trim(), output_format: 'wav' }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: `Abi TTS failed: HTTP ${response.status}` };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await response.json();
      const audioBase64 = json.audio_base64 || json.audioBase64 || json.audio;
      if (!audioBase64) return { ok: false, error: 'Abi TTS JSON response did not include audio_base64' };
      fs.writeFileSync(outputPath, Buffer.from(audioBase64, 'base64'));
    } else {
      fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
    }
    return { ok: true, outputPath, provider: 'abi' };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function synthesizeRegisteredVoiceover({ text, outputPath, providerId }) {
  try {
    const provider = getVoiceProvider(providerId);
    if (!provider) return { ok: false, error: `${providerId} provider is not registered` };
    if (!provider.isAvailable()) return { ok: false, error: typeof provider.whyUnavailable === 'function' ? provider.whyUnavailable() || `${providerId} unavailable` : `${providerId} unavailable` };
    const result = await provider.synthesize({
      text,
      preferredProvider: providerId,
      withTimestamps: false,
      scriptureMode: false,
    });
    if (!result?.file) return { ok: false, error: `${providerId} returned no audio file` };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(result.file, outputPath);
    return { ok: true, outputPath, provider: result.provider || providerId };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function defaultVoiceoverProviders(opts = {}) {
  const configured = String(opts.providerChain || process.env.TIMELINE_VO_PROVIDER_CHAIN || 'chatterbox,abi,fish,elevenlabs,azure,edge')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return configured.map((id) => {
    if (id === 'chatterbox') return { id, synthesize: synthesizeChatterboxVoiceover };
    if (id === 'abi') return { id, synthesize: synthesizeAbiVoiceover };
    return { id, synthesize: (args) => synthesizeRegisteredVoiceover({ ...args, providerId: id }) };
  });
}

export async function synthesizeVoiceoverWithFallback(args, opts = {}) {
  const providers = opts.voiceoverProviders || defaultVoiceoverProviders(opts);
  const fallbacks = [];
  for (const provider of providers) {
    const result = await provider.synthesize(args);
    if (result?.ok) return { ...result, provider: result.provider || provider.id, fallbacks };
    fallbacks.push({ provider: provider.id, error: result?.error || 'Voiceover provider failed' });
  }
  return { ok: false, error: `All voiceover providers failed. First failure (${fallbacks[0]?.provider || 'unknown'}): ${fallbacks[0]?.error || 'unknown error'}`, fallbacks };
}

export async function prepareVoiceoverAssets(plan, opts = {}) {
  const outputDir = path.resolve(opts.outputDir || OUTPUT_DIR);
  const audioDir = path.join(outputDir, 'timeline', 'audio');
  const synthesizeVoiceover = opts.synthesizeVoiceover
    ? (args) => opts.synthesizeVoiceover(args)
    : (args) => synthesizeVoiceoverWithFallback(args, opts);
  const nextPlan = {
    ...plan,
    tracks: (plan.tracks || []).map((track) => ({
      ...track,
      clips: (track.clips || []).map((clip) => ({ ...clip })),
    })),
  };
  const generatedVoiceovers = [];
  const voiceTrack = nextPlan.tracks.find((track) => track.kind === 'voiceover');
  if (!voiceTrack) return { ok: true, plan: nextPlan, generatedVoiceovers };

  for (let i = 0; i < voiceTrack.clips.length; i += 1) {
    const clip = voiceTrack.clips[i];
    if (!clip.placeholder || clip.path || !clip.prompt) continue;
    const outputPath = path.join(audioDir, `${safeId(plan.projectId)}-vo-${i}.wav`);
    const result = await synthesizeVoiceover({ text: clip.prompt, outputPath, clip, plan });
    if (!result.ok) return { ok: false, error: result.error || 'Chatterbox voiceover synthesis failed', plan: nextPlan, generatedVoiceovers };
    clip.path = outputRelativePath(result.outputPath || outputPath, outputDir);
    clip.placeholder = false;
    clip.source = result.provider || 'voiceover';
    generatedVoiceovers.push({
      clipId: clip.id,
      path: clip.path,
      outputPath: result.outputPath || outputPath,
      provider: result.provider || 'voiceover',
      fallbacks: result.fallbacks || [],
    });
    if (opts.synthesisDelayMs) await delay(opts.synthesisDelayMs);
  }
  return { ok: true, plan: nextPlan, generatedVoiceovers };
}

export function buildProofRenderCommand(plan, opts = {}) {
  const outputDir = path.resolve(opts.outputDir || OUTPUT_DIR);
  const timelineDir = path.join(outputDir, 'timeline');
  const outputPath = path.resolve(opts.outputPath || path.join(timelineDir, `${plan.projectId || 'timeline'}-${Date.now()}.mp4`));
  const main = firstClip(plan, 'video') || firstClip(plan, 'broll');
  if (!main) return { ok: false, error: 'No video or B-roll clip with a media path found' };

  const mainPath = resolveTimelineAssetPath(main.path, opts);
  if (!mainPath) return { ok: false, error: `Unsafe or unsupported main clip path: ${main.path}` };

  const broll = brollClips(plan)
    .filter((clip) => clip.id !== main.id)
    .slice(0, 1)
    .map((clip) => ({ ...clip, resolvedPath: resolveTimelineAssetPath(clip.path, opts) }))
    .filter((clip) => clip.resolvedPath);

  const voiceovers = voiceoverClips(plan)
    .filter((clip) => clip.path && !clip.placeholder)
    .slice(0, 4)
    .map((clip) => ({ ...clip, resolvedPath: resolveTimelineAssetPath(clip.path, opts) }))
    .filter((clip) => clip.resolvedPath);

  const ignoredPlaceholders = (plan.tracks || [])
    .flatMap((track) => track.clips || [])
    .filter((clip) => clip.placeholder).length;

  const width = plan.aspect === '9:16' ? 720 : plan.aspect === '1:1' ? 720 : 1280;
  const height = plan.aspect === '9:16' ? 1280 : plan.aspect === '1:1' ? 720 : 720;
  const duration = Math.max(1, Math.min(300, Number(plan.durationSec || main.durationSec || 8)));

  const args = ['-y', '-hide_banner', '-loglevel', 'warning', '-i', mainPath];
  for (const clip of broll) args.push('-i', clip.resolvedPath);
  for (const clip of voiceovers) args.push('-i', clip.resolvedPath);

  let filter;
  if (broll.length > 0) {
    const clip = broll[0];
    const start = Math.max(0, Number(clip.startSec || 0));
    const end = Math.max(start + 0.1, start + Number(clip.durationSec || 3));
    filter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[base];` +
      `[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[broll];` +
      `[base][broll]overlay=0:0:enable='between(t,${start},${end})'[v]`;
  } else {
    filter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[v]`;
  }

  const audioInputCount = 1 + broll.length;
  if (voiceovers.length > 0) {
    const parts = [filter, '[0:a]volume=0.35[basea]'];
    const audioLabels = ['[basea]'];
    voiceovers.forEach((clip, index) => {
      const inputIndex = audioInputCount + index;
      const delayMs = Math.max(0, Math.round(Number(clip.startSec || 0) * 1000));
      parts.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs},volume=1.25[vo${index}]`);
      audioLabels.push(`[vo${index}]`);
    });
    parts.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=1[a]`);
    filter = parts.join(';');
  }

  args.push(
    '-filter_complex', filter,
    '-map', '[v]',
    ...(voiceovers.length > 0 ? ['-map', '[a]'] : ['-map', '0:a?']),
    '-t', String(duration),
    '-r', '24',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  );

  return {
    ok: true,
    args,
    outputPath,
    publicUrl: normalizeOutputPublicUrl(outputPath, outputDir),
    ignoredPlaceholders,
  };
}

export function runFfmpeg(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(opts.ffmpegPath || 'ffmpeg', args, { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ ok: false, error: String(error?.message || error), stderr }));
    child.on('close', (code) => resolve({ ok: code === 0, code, stderr }));
  });
}

export async function renderTimelineProof(plan, opts = {}) {
  const prepared = await prepareVoiceoverAssets(plan, opts);
  if (!prepared.ok) return prepared;
  const command = buildProofRenderCommand(prepared.plan, opts);
  if (!command.ok) return command;
  fs.mkdirSync(path.dirname(command.outputPath), { recursive: true });
  const result = await (opts.runner || runFfmpeg)(command.args, opts);
  if (!result.ok) {
    return { ok: false, error: result.error || result.stderr || `ffmpeg exited ${result.code}`, stderr: result.stderr, command, generatedVoiceovers: prepared.generatedVoiceovers };
  }
  return {
    ok: true,
    outputPath: command.outputPath,
    publicUrl: command.publicUrl,
    ignoredPlaceholders: command.ignoredPlaceholders,
    generatedVoiceovers: prepared.generatedVoiceovers,
    stderr: result.stderr,
  };
}
