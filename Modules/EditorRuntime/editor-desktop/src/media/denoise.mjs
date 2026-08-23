import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { normalizeAudioFxRack, buildAudioFxFilterChain } from "../audio-fx.mjs";
import { mediaBinary, supportRoot, forceKillProcess, run, escapeFilterPath, hasAudioFilter } from "./core.mjs";

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const DENOISE_PRESETS = Object.freeze({
  balanced: {
    humEnabled: true,
    humDepth: 0.62,
    humHarmonics: 4,
    wind: 0.45,
    environment: 0.58,
    neural: 0.62,
    insect: 0.18,
    residual: 0.34,
    voiceRestore: 0.5,
  },
  wind: {
    humEnabled: false,
    humDepth: 0.35,
    humHarmonics: 3,
    wind: 0.9,
    environment: 0.62,
    neural: 0.7,
    insect: 0.08,
    residual: 0.42,
    voiceRestore: 0.58,
  },
  electrical: {
    humEnabled: true,
    humDepth: 0.92,
    humHarmonics: 6,
    wind: 0.28,
    environment: 0.54,
    neural: 0.55,
    insect: 0.12,
    residual: 0.34,
    voiceRestore: 0.52,
  },
  aircraft: {
    humEnabled: true,
    humDepth: 0.68,
    humHarmonics: 4,
    wind: 0.66,
    environment: 0.86,
    neural: 0.76,
    insect: 0.1,
    residual: 0.48,
    voiceRestore: 0.62,
  },
  insects: {
    humEnabled: false,
    humDepth: 0.35,
    humHarmonics: 3,
    wind: 0.32,
    environment: 0.66,
    neural: 0.68,
    insect: 0.82,
    residual: 0.56,
    voiceRestore: 0.64,
  },
  "mixed-heavy": {
    humEnabled: true,
    humDepth: 0.82,
    humHarmonics: 5,
    wind: 0.72,
    environment: 0.82,
    neural: 0.8,
    insect: 0.52,
    residual: 0.58,
    voiceRestore: 0.68,
  },
});

const clampDenoise = (value, fallback = 0) =>
  Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : fallback));

export function denoisePresetSettings(preset = "balanced") {
  return { ...(DENOISE_PRESETS[preset] || DENOISE_PRESETS.balanced) };
}

export function normalizeDenoiseConfig(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const preset = DENOISE_PRESETS[source.preset] ? source.preset : "balanced";
  const merged = {
    mode: "ai-isolation",
    strength: 0.85,
    preset,
    humFrequency: "auto",
    detectedHumFrequency: 0,
    ...denoisePresetSettings(preset),
    ...source,
  };
  const humFrequency = ["auto", "50", "60"].includes(String(merged.humFrequency))
    ? String(merged.humFrequency)
    : "auto";
  const detectedHumFrequency = [50, 60].includes(Number(merged.detectedHumFrequency))
    ? Number(merged.detectedHumFrequency)
    : 0;
  return {
    ...merged,
    mode: String(merged.mode || "ai-isolation").toLowerCase(),
    strength: clampDenoise(merged.strength, 0.85),
    preset,
    humEnabled: merged.humEnabled !== false,
    humFrequency,
    detectedHumFrequency,
    humDepth: clampDenoise(merged.humDepth, 0.62),
    humHarmonics: Math.max(1, Math.min(8, Math.round(Number(merged.humHarmonics) || 4))),
    wind: clampDenoise(merged.wind, 0.45),
    environment: clampDenoise(merged.environment, 0.58),
    neural: clampDenoise(merged.neural, 0.62),
    insect: clampDenoise(merged.insect, 0.18),
    residual: clampDenoise(merged.residual, 0.34),
    voiceRestore: clampDenoise(merged.voiceRestore, 0.5),
  };
}

export function denoiseConfigFingerprint(input = {}) {
  const config = normalizeDenoiseConfig(input);
  const stable = Object.fromEntries(
    [
      "mode", "strength", "preset", "humEnabled", "humFrequency",
      "detectedHumFrequency", "humDepth", "humHarmonics", "wind",
      "environment", "neural", "insect", "residual", "voiceRestore",
    ].map((key) => [key, config[key]]),
  );
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 20);
}

export function rnnoiseModelPath() {
  return [
    path.resolve(moduleDir, "../assets/models/std.rnnn"),
    path.resolve(moduleDir, "../../assets/models/std.rnnn"),
    path.resolve(moduleDir, "../../../models/std.rnnn"),
  ].find((candidate) => fs.existsSync(candidate));
}

const escapeAudioFilterPath = (str) =>
  String(str || "")
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");

export function buildProfessionalDenoiseChain(input = {}) {
  const config = normalizeDenoiseConfig(input);
  if (config.mode === "off" || config.strength <= 0.01) return "";
  const scale = 0.2 + config.strength * 0.8;
  const filters = ["aresample=48000"];

  // Wind and handling rumble are removed before noise learning so they do not
  // consume the spectral denoisers' reduction budget.
  const highpass = Math.round(42 + config.wind * scale * 58);
  filters.push(`highpass=f=${highpass}:p=2`);

  const forcedHum = Number(config.humFrequency);
  const humFrequency = [50, 60].includes(forcedHum)
    ? forcedHum
    : config.detectedHumFrequency;
  if (config.humEnabled && [50, 60].includes(humFrequency)) {
    const notchGain = -(6 + config.humDepth * scale * 20).toFixed(2);
    const notchQ = (18 + config.humDepth * 18).toFixed(1);
    for (let harmonic = 1; harmonic <= config.humHarmonics; harmonic += 1) {
      const frequency = humFrequency * harmonic;
      if (frequency >= 1000) break;
      filters.push(`equalizer=f=${frequency}:t=q:w=${notchQ}:g=${notchGain}`);
    }
  }

  if (config.environment > 0.01) {
    const reduction = (4 + config.environment * scale * 14).toFixed(2);
    const adaptivity = (0.52 + (1 - config.environment) * 0.22).toFixed(3);
    filters.push(
      `afftdn=nr=${reduction}:nf=-48:tn=1:tr=1:ad=${adaptivity}:fo=1.15:gs=8`,
    );
  }

  const model = rnnoiseModelPath();
  if (model && config.neural > 0.01) {
    const mix = Math.min(0.92, 0.16 + config.neural * scale * 0.78).toFixed(3);
    filters.push(`arnndn=m='${escapeAudioFilterPath(model)}':mix=${mix}`);
  }

  if (config.insect > 0.01) {
    const highDip = -(config.insect * scale * 5.5).toFixed(2);
    const highCut = Math.round(18000 - config.insect * scale * 3000);
    filters.push(`equalizer=f=7600:t=q:w=1.35:g=${highDip}`);
    filters.push(`lowpass=f=${highCut}:p=1`);
  } else {
    filters.push("lowpass=f=18000:p=1");
  }

  // A deliberately gentler second pass removes residual stationary noise.
  // It uses different parameters from pass one instead of blindly stacking an
  // identical noise reducer, which is more prone to metallic speech artifacts.
  if (config.residual > 0.01) {
    const reduction = (2.5 + config.residual * scale * 8.5).toFixed(2);
    filters.push(
      `afftdn=nr=${reduction}:nf=-55:tn=1:tr=1:ad=0.860:fo=0.92:gs=14`,
    );
  }

  if (config.voiceRestore > 0.01) {
    const restore = config.voiceRestore * scale;
    filters.push(`equalizer=f=185:t=q:w=0.90:g=${(restore * 1.8).toFixed(2)}`);
    filters.push(`equalizer=f=3200:t=q:w=1.05:g=${(restore * 2.2).toFixed(2)}`);
    filters.push(`highshelf=f=10500:g=${(restore * 0.9).toFixed(2)}`);
    filters.push(
      `deesser=i=${Math.min(0.55, 0.18 + restore * 0.34).toFixed(3)}:m=0.55:f=0.55`,
    );
  }
  filters.push("alimiter=limit=0.96");
  return filters.filter(Boolean).join(",");
}

function goertzelPower(samples, sampleRate, frequency) {
  if (!samples?.length || frequency <= 0 || frequency >= sampleRate / 2) return 0;
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previous2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, samples.length - 1));
    const current = Number(samples[index] || 0) * window + coefficient * previous - previous2;
    previous2 = previous;
    previous = current;
  }
  return Math.max(0, previous2 * previous2 + previous * previous - coefficient * previous * previous2);
}

function humCandidateScore(samples, sampleRate, fundamental) {
  const ratios = [];
  const weights = [0.5, 0.28, 0.1, 0.06, 0.04, 0.02];
  for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
    const frequency = fundamental * harmonic;
    if (frequency >= sampleRate / 2 - 10) break;
    const tone = Math.max(
      goertzelPower(samples, sampleRate, frequency - 0.35),
      goertzelPower(samples, sampleRate, frequency),
      goertzelPower(samples, sampleRate, frequency + 0.35),
    );
    const neighborhood = 0.5 * (
      goertzelPower(samples, sampleRate, frequency - 4) +
      goertzelPower(samples, sampleRate, frequency + 4)
    );
    ratios.push(10 * Math.log10((tone + 1e-20) / (neighborhood + 1e-20)));
  }
  let weighted = 0;
  let totalWeight = 0;
  for (let index = 0; index < ratios.length; index += 1) {
    const weight = weights[index] || 0;
    // A speech pitch can land on a third or later power-line harmonic. Make
    // the fundamental and 2nd harmonic decisive, and cap a single late spike
    // so male voice cannot masquerade as 60 Hz electrical hum.
    const bounded = Math.max(-12, Math.min(45, ratios[index]));
    weighted += bounded * weight;
    totalWeight += weight;
  }
  return totalWeight ? weighted / totalWeight : -120;
}

export function analyzeHumSamples(samples, sampleRate = 12000) {
  const score50 = humCandidateScore(samples, sampleRate, 50);
  const score60 = humCandidateScore(samples, sampleRate, 60);
  const bestFrequency = score50 >= score60 ? 50 : 60;
  const bestScore = Math.max(score50, score60);
  const difference = Math.abs(score50 - score60);
  // Prefer a safe no-op over a false De-Hum notch. Weak/ambiguous cases stay
  // undetected and can still be selected manually in the UI.
  const detected = bestScore >= 5 && difference >= 1.25 ? bestFrequency : 0;
  return {
    humFrequency: detected,
    score50Db: Number(score50.toFixed(2)),
    score60Db: Number(score60.toFixed(2)),
    confidence: Number(Math.max(0, Math.min(1, (bestScore - 1.5) / 9 + difference / 24)).toFixed(3)),
  };
}

export async function analyzeNoiseProfile(inputPath, options = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error("找不到需要分析的音频。");
  const sampleRate = 12000;
  const bytes = await run(mediaBinary("ffmpeg"), [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-ss", String(Math.max(0, Number(options.time || 0))),
    "-t", String(Math.max(3, Math.min(15, Number(options.duration || 10)))),
    "-i", inputPath, "-vn", "-ac", "1", "-ar", String(sampleRate),
    "-f", "f32le", "pipe:1",
  ], { lowPriority: true });
  const samples = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    Math.floor(bytes.byteLength / 4),
  );
  if (!samples.length) throw new Error("没有读取到可分析的音频。");
  let sum = 0;
  let peak = 0;
  for (const sample of samples) {
    const value = Number(sample || 0);
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const hum = analyzeHumSamples(samples, sampleRate);
  return {
    ...hum,
    sampleSeconds: Number((samples.length / sampleRate).toFixed(2)),
    rmsDb: Number((20 * Math.log10(Math.sqrt(sum / samples.length) + 1e-12)).toFixed(2)),
    peakDb: Number((20 * Math.log10(peak + 1e-12)).toFixed(2)),
    message: hum.humFrequency
      ? `检测到 ${hum.humFrequency} Hz 工频嗡声，可启用 De-Hum 精准陷波。`
      : "没有可靠检测到 50/60 Hz 工频嗡声；不会自动强行陷波。",
  };
}

export function audioDenoiseFilter(mode, strength = 0.8, settings = {}) {
  const supplied = mode && typeof mode === "object"
    ? mode
    : { ...(settings || {}), mode, strength };
  const config = normalizeDenoiseConfig(supplied);
  const amount = config.strength;
  mode = config.mode;
  if (!mode || mode === "off" || amount <= 0.01) return "";
  if (["studio-chain", "professional", "pro"].includes(mode))
    return buildProfessionalDenoiseChain(config);
  const reduction = Math.round(8 + amount * 18);
  const model = rnnoiseModelPath();
  const neural = model
    ? `aresample=48000,arnndn=m='${escapeAudioFilterPath(model)}':mix=${(0.4 + amount * 0.6).toFixed(3)}`
    : "";
  // The bundled Windows FFmpeg build crashes inside anlmdn with 0xC0000005 /
  // 0xC0000374. Keep the stable neural and FFT denoisers on Windows; other
  // platforms may still add NL-means.
  const nlmeans = (value) =>
    process.platform === "win32"
      ? ""
      : `anlmdn=s=${Number(value).toFixed(4)}:p=0.002:r=0.006`;
  if (mode === "uvr5-master" || mode === "uvr5") {
    const warmthGain = (1.6 + amount * 1.8).toFixed(2);
    const presenceGain = (1.2 + amount * 1.6).toFixed(2);
    const crystal = (0.8 + amount * 1.0).toFixed(2);
    return [
      "highpass=f=58:p=2",
      "lowpass=f=17800",
      neural,
      "adeclick",
      `afftdn=nr=${Math.max(8, Math.round(10 + amount * 14))}:nf=-42:tn=1:tr=1`,
      nlmeans(0.0006 + amount * 0.0012),
      `equalizer=f=185:t=q:w=0.85:g=${warmthGain}`,
      "equalizer=f=1000:t=q:w=1.2:g=0.5",
      `equalizer=f=3300:t=q:w=1.05:g=${presenceGain}`,
      "highshelf=f=10500:g=1.2",
      `crystalizer=i=${crystal}:c=0`,
      "deesser=i=0.42:m=0.55:f=0.55",
      "alimiter=limit=0.96",
    ]
      .filter(Boolean)
      .join(",");
  }
  if (mode === "dereverb" || mode === "de-echo") {
    return [
      "highpass=f=60",
      "lowpass=f=17000",
      `afftdn=nr=${Math.max(6, Math.round(8 + amount * 12))}:nf=-45:tn=1:tr=1`,
      `equalizer=f=280:t=q:w=1.2:g=-${(1.5 + amount * 2.0).toFixed(2)}`,
      `equalizer=f=3000:t=q:w=0.9:g=${(1.0 + amount * 1.2).toFixed(2)}`,
      "alimiter=limit=0.98",
    ]
      .filter(Boolean)
      .join(",");
  }
  if (mode === "ai-isolation" || mode === "deepfilter") {
    return [
      "highpass=f=55",
      "lowpass=f=17500",
      neural,
      `afftdn=nr=${Math.max(8, Math.round(10 + amount * 14))}:nf=-42:tn=1`,
      `anlmdn=s=${(0.0006 + amount * 0.0012).toFixed(4)}:p=0.002:r=0.006`,
      "alimiter=limit=0.96",
    ]
      .filter(Boolean)
      .join(",");
  }
  if (mode === "gentle") {
    return [
      "highpass=f=50",
      "lowpass=f=18000",
      `afftdn=nr=${Math.max(6, Math.round(6 + amount * 10))}:nf=-45:tn=1`,
      nlmeans(0.0004 + amount * 0.0008),
      "alimiter=limit=0.98",
    ]
      .filter(Boolean)
      .join(",");
  }
  if (mode === "quality") {
    return [
      "highpass=f=60",
      "lowpass=f=16500",
      neural,
      `afftdn=nr=${Math.max(8, Math.round(reduction * 0.72))}:nf=-38:tn=1`,
      nlmeans(0.0005 + amount * 0.0014),
      "alimiter=limit=0.96",
    ]
      .filter(Boolean)
      .join(",");
  }
  if (mode === "strong") {
    return [
      "highpass=f=65",
      "lowpass=f=15800",
      neural,
      `afftdn=nr=${Math.max(7, Math.round(reduction * 0.62))}:nf=-38:tn=1`,
      "agate=threshold=0.006:ratio=1.6:attack=8:release=180",
      "alimiter=limit=0.96",
    ]
      .filter(Boolean)
      .join(",");
  }
  return `highpass=f=60,lowpass=f=16000,afftdn=nr=${Math.max(6, Math.round(reduction * 0.7))}:nf=-38:tn=1`;
}

function stableDenoiseFallbackFilter(strength = 0.8) {
  const amount = Math.max(0, Math.min(1, Number(strength || 0.8)));
  return `aresample=48000,highpass=f=60,lowpass=f=16500,afftdn=nr=${Math.round(8 + amount * 10)}:nf=-42:tn=1,alimiter=limit=0.97`;
}

export function audioMasterFilter(config, info) {
  const audio = config.audio || {};
  const filters = [];
  const trackFxRack = normalizeAudioFxRack(config.audioFxRack || []);
  if (
    !config.audioProcessingEnabled &&
    Number(config.denoise?.strength || 0) <= 0.01 &&
    !trackFxRack.some((effect) => effect.enabled)
  ) return "";
  const offset = Math.max(
    -Number(config.outputDuration || info.duration),
    Math.min(
      Number(config.outputDuration || info.duration),
      Number(audio.offset || 0),
    ),
  );
  if (offset > 0.001) filters.push(`adelay=${Math.round(offset * 1000)}:all=1`);
  else if (offset < -0.001)
    filters.push(`atrim=start=${(-offset).toFixed(4)},asetpts=PTS-STARTPTS`);
  const mode = String(audio.channelMode || "original");
  if (Number(info.channels || 0) === 1 || mode === "left")
    filters.push("pan=stereo|c0=c0|c1=c0");
  else if (mode === "right") filters.push("pan=stereo|c0=c1|c1=c1");
  else if (mode === "mix")
    filters.push("pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1");
  const lowCut = Math.max(20, Math.min(300, Number(audio.lowCut || 60)));
  const highCut = Math.max(
    4000,
    Math.min(20000, Number(audio.highCut || 16500)),
  );
  filters.push(`highpass=f=${Math.round(lowCut)}`);
  filters.push(`lowpass=f=${Math.round(highCut)}`);
  const denoise = audioDenoiseFilter(
    config.denoise?.mode,
    config.denoise?.strength,
    config.denoise,
  );
  if (denoise) filters.push(denoise);
  if (!config.mainAudioFxPreRendered) {
    const audioFx = buildAudioFxFilterChain(trackFxRack, {
      bypass: !!config.audioFxBypass,
      rnnoiseModel: rnnoiseModelPath(),
      detectedHumFrequency: Number(config.denoise?.detectedHumFrequency || 0),
      dialogueEnhance: hasAudioFilter("dialoguenhance"),
    });
    if (audioFx) filters.push(audioFx);
  }
  const volume = Math.max(0, Math.min(4, Number(audio.volume ?? 1)));
  if (Math.abs(volume - 1) > 0.001) filters.push(`volume=${volume.toFixed(3)}`);
  const bass = Math.max(-12, Math.min(12, Number(audio.bass || 0)));
  const treble = Math.max(-12, Math.min(12, Number(audio.treble || 0)));
  if (Math.abs(bass) > 0.01)
    filters.push(`bass=g=${bass.toFixed(2)}:f=110:w=0.6`);
  if (Math.abs(treble) > 0.01)
    filters.push(`treble=g=${treble.toFixed(2)}:f=6500:w=0.5`);
  const presence = Math.max(0, Math.min(100, Number(audio.presence || 0)));
  if (presence > 0.1)
    filters.push(
      `equalizer=f=3200:t=q:w=1.1:g=${(presence * 0.12).toFixed(2)}`,
    );
  const deesser = Math.max(0, Math.min(100, Number(audio.deesser || 0)));
  if (deesser > 0.1)
    filters.push(
      `deesser=i=${(deesser / 100).toFixed(3)}:m=${(0.45 + deesser / 190).toFixed(3)}:f=0.55`,
    );
  const voiceEnhance = Math.max(
    0,
    Math.min(100, Number(audio.voiceEnhance || 0)),
  );
  if (voiceEnhance > 0.1) {
    filters.push(
      `equalizer=f=180:t=q:w=0.8:g=${(voiceEnhance * 0.045).toFixed(2)}`,
    );
    filters.push(
      `crystalizer=i=${(voiceEnhance * 0.055).toFixed(2)}:c=0`,
    );
  }
  const compressor = Math.max(0, Math.min(1, Number(audio.compressor || 0)));
  if (compressor > 0.01)
    filters.push(
      `acompressor=threshold=${(0.32 - compressor * 0.2).toFixed(3)}:ratio=${(1.5 + compressor * 5.5).toFixed(2)}:attack=12:release=160:makeup=${(1 + compressor * 1.2).toFixed(2)}`,
    );
  const pan = Math.max(-1, Math.min(1, Number(audio.pan || 0)));
  if (Math.abs(pan) > 0.01)
    filters.push(`stereotools=balance_out=${pan.toFixed(3)}`);
  const speed = Math.max(0.5, Math.min(2, Number(audio.speed || 1)));
  if (Math.abs(speed - 1) > 0.001) filters.push(`atempo=${speed.toFixed(4)}`);
  if (audio.normalize)
    filters.push("dynaudnorm=f=250:g=15:p=0.93:m=8:r=0.12:c=1");
  if (audio.limiter !== false)
    filters.push("alimiter=limit=0.96:attack=5:release=80");
  return filters.join(",");
}

export function findDeepFilterBinary() {
  const isWin = process.platform === "win32";
  const binaryName = isWin ? "deepfilter.exe" : "deepfilter";
  const altBinaryName = isWin ? "deep-filter.exe" : "deep-filter";
  const candidates = [
    process.env.QUICKCUT_DEEPFILTER_BIN,
    process.env.QUICKCUT_MEDIA_ROOT ? path.join(process.env.QUICKCUT_MEDIA_ROOT, binaryName) : "",
    process.env.QUICKCUT_MEDIA_ROOT ? path.join(process.env.QUICKCUT_MEDIA_ROOT, altBinaryName) : "",
    path.resolve(moduleDir, "../../media", binaryName),
    path.resolve(moduleDir, "../../media", altBinaryName),
    path.resolve(moduleDir, "../media", binaryName),
    path.resolve(moduleDir, "../media", altBinaryName),
    path.resolve(moduleDir, "../runtime/media", binaryName),
    path.resolve(moduleDir, "../runtime/media", altBinaryName),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

export function hasDeepFilterEngine() {
  return Boolean(findDeepFilterBinary());
}

export function findDemucsBinary() {
  const isWin = process.platform === "win32";
  const binaryNames = isWin ? ["demucs.exe", "denoiser.exe"] : ["demucs", "denoiser"];
  const engineRoot = path.join(supportRoot(), "engines", "demucs");
  const candidates = [
    process.env.QUICKCUT_DEMUCS_BIN,
    ...binaryNames.map((b) => (process.env.QUICKCUT_MEDIA_ROOT ? path.join(process.env.QUICKCUT_MEDIA_ROOT, b) : "")),
    ...binaryNames.map((b) => path.join(engineRoot, b)),
    ...binaryNames.map((b) => path.join(engineRoot, "bin", b)),
    ...binaryNames.map((b) => path.join(engineRoot, "Scripts", b)),
    ...binaryNames.map((b) => path.resolve(moduleDir, "../../media", b)),
    ...binaryNames.map((b) => path.resolve(moduleDir, "../media", b)),
    ...binaryNames.map((b) => path.resolve(moduleDir, "../runtime/media", b)),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      if (!isWin && (fs.statSync(candidate).mode & 0o111) === 0) continue;
      return candidate;
    } catch {}
  }
  return "";
}

export function hasDemucsEngine() {
  const binary = findDemucsBinary();
  if (!binary) return false;
  try {
    const checked = spawnSync(binary, ["--help"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    return !checked.error && checked.status === 0;
  } catch {
    return false;
  }
}

const demucsInstallJobs = new Map();

export function startDemucsInstall(input = {}) {
  const jobId = crypto.randomUUID();
  const alreadyInstalled = hasDemucsEngine();
  const job = {
    id: jobId,
    status: alreadyInstalled ? "ready" : "error",
    progress: alreadyInstalled ? 100 : 0,
    message: alreadyInstalled
      ? "Meta Demucs 本地引擎已验证可用。"
      : "未检测到可执行的 Demucs 引擎；本次将使用内置 FFmpeg 稳定降噪，不会伪装成安装成功。",
    error: alreadyInstalled ? null : "Demucs 自动安装源尚未配置",
    startedAt: Date.now(),
    cancelled: false,
  };
  demucsInstallJobs.set(jobId, job);

  return { jobId, status: job.status, progress: job.progress, message: job.message };
}

export function demucsInstallStatus(jobId) {
  const job = demucsInstallJobs.get(jobId);
  if (!job) return { status: "unknown", progress: 0, message: "任务不存在" };
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
  };
}

export function cancelDemucsInstall(jobId) {
  const job = demucsInstallJobs.get(jobId);
  if (job) {
    job.cancelled = true;
    job.status = "cancelled";
    job.message = "已取消安装";
  }
  return { ok: true };
}

export async function renderDemucsTrack(inputPath, strength = 0.85, outputPath, options = {}) {
  const bin = findDemucsBinary();
  if (!bin) throw new Error("未找到 Meta Demucs 引擎二进制文件");
  const tempDir = path.join(supportRoot(), "temp", `demucs-${crypto.randomUUID()}`);
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  const rawWav = path.join(tempDir, "input_raw.wav");

  const ffmpegArgs = ["-y", "-hide_banner", "-loglevel", "error"];
  if (options.time != null && options.duration != null) {
    ffmpegArgs.push("-ss", String(Math.max(0, Number(options.time))), "-t", String(Math.max(0.1, Number(options.duration))));
  }
  ffmpegArgs.push("-i", inputPath, "-vn", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", rawWav);

  try {
    await run(mediaBinary("ffmpeg"), ffmpegArgs);
    if (!fs.existsSync(rawWav) || fs.statSync(rawWav).size < 128) {
      throw new Error("Demucs 临时音频抽取失败");
    }

    // Run demucs CLI (or denoiser)
    const isDenoiser = path.basename(bin).toLowerCase().includes("denoiser");
    if (isDenoiser) {
      await run(bin, ["--model", "dns64", "--out", tempDir, rawWav]);
    } else {
      await run(bin, ["--two-stems", "vocals", "-n", "htdemucs", "-o", tempDir, rawWav]);
    }

    // Locate the output vocal wav in tempDir
    const findVocalsWav = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const res = findVocalsWav(fullPath);
          if (res) return res;
        } else if (
          entry.name.endsWith(".wav") &&
          entry.name !== "input_raw.wav" &&
          (entry.name.includes("vocals") || entry.name.includes("clean") || entry.name.includes("denoised"))
        ) {
          return fullPath;
        }
      }
      return "";
    };

    const cleanedWavPath =
      findVocalsWav(tempDir) ||
      fs
        .readdirSync(tempDir)
        .map((f) => path.join(tempDir, f))
        .find((f) => f.endsWith(".wav") && !f.includes("input_raw"));

    if (!cleanedWavPath || !fs.existsSync(cleanedWavPath)) {
      throw new Error("Demucs 输出人声音频文件缺失");
    }

    // Encode back to 48kHz high-quality M4A
    await run(mediaBinary("ffmpeg"), [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      cleanedWavPath,
      "-c:a",
      "aac",
      "-b:a",
      "224k",
      "-ar",
      "48000",
      outputPath,
    ]);

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 256) {
      throw new Error("Demucs 降噪音轨编码生成失败");
    }
    return outputPath;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

export async function renderDeepFilterTrack(inputPath, strength = 0.8, outputPath, options = {}) {
  const bin = findDeepFilterBinary();
  if (!bin) throw new Error("未找到 DeepFilterNet 引擎二进制文件");
  const tempDir = path.join(supportRoot(), "temp", `deepfilter-${crypto.randomUUID()}`);
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  const rawWav = path.join(tempDir, "input_48k.wav");

  const amount = Math.max(0, Math.min(1, Number(strength || 0.8)));
  const attenDb = Math.round(10 + amount * 90); // 10 dB to 100 dB

  const ffmpegArgs = ["-y", "-hide_banner", "-loglevel", "error"];
  if (options.time != null && options.duration != null) {
    ffmpegArgs.push("-ss", String(Math.max(0, Number(options.time))), "-t", String(Math.max(0.1, Number(options.duration))));
  }
  ffmpegArgs.push("-i", inputPath, "-vn", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", rawWav);

  try {
    await run(mediaBinary("ffmpeg"), ffmpegArgs);
    if (!fs.existsSync(rawWav) || fs.statSync(rawWav).size < 128) {
      throw new Error("48kHz 临时音频抽取失败");
    }

    // Run deepfilter CLI
    await run(bin, [rawWav, "-o", tempDir, "--atten-lim-db", String(attenDb)]);

    // Locate the cleaned wav in tempDir
    const files = fs.readdirSync(tempDir);
    const cleanedWavName =
      files.find((f) => f.endsWith(".wav") && f !== "input_48k.wav") ||
      files.find((f) => f.includes("clean") || f.includes("output"));
    const cleanedWavPath = cleanedWavName ? path.join(tempDir, cleanedWavName) : "";
    if (!cleanedWavPath || !fs.existsSync(cleanedWavPath)) {
      throw new Error("DeepFilterNet 输出文件缺失");
    }

    // Encode to target M4A
    await run(mediaBinary("ffmpeg"), [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      cleanedWavPath,
      "-c:a",
      "aac",
      "-b:a",
      "224k",
      "-ar",
      "48000",
      outputPath,
    ]);

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 256) {
      throw new Error("AI 降噪音轨编码生成失败");
    }
    return outputPath;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

async function resolveAutomaticHum(inputPath, input, time = 0) {
  const config = normalizeDenoiseConfig(input);
  if (
    !["studio-chain", "professional", "pro"].includes(config.mode) ||
    !config.humEnabled ||
    config.humFrequency !== "auto" ||
    config.detectedHumFrequency
  ) return config;
  try {
    const profile = await analyzeNoiseProfile(inputPath, { time, duration: 10 });
    return { ...config, detectedHumFrequency: profile.humFrequency || 0 };
  } catch (error) {
    console.warn("Automatic hum analysis failed; continuing without a forced notch:", error?.message);
    return config;
  }
}

export async function renderDenoisePreview(
  inputPath,
  time,
  mode,
  strength,
  settings = {},
) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error("找不到需要降噪的音频。");
  const directory = path.join(supportRoot(), "previews");
  fs.mkdirSync(directory, { recursive: true });
  const outputPath = path.join(directory, `denoise-${crypto.randomUUID()}.m4a`);

  const supplied = { ...(settings || {}), mode: mode || settings?.mode, strength };
  const resolvedConfig = await resolveAutomaticHum(inputPath, supplied, Math.max(0, Number(time || 0) - 2));
  const effectiveMode = resolvedConfig.mode;
  const startTime = Math.max(0, Number(time || 0) - 2);

  // If Demucs is selected and Demucs binary exists, try demucs
  if (effectiveMode === "demucs" && hasDemucsEngine()) {
    try {
      return await renderDemucsTrack(inputPath, strength, outputPath, {
        time: startTime,
        duration: 8,
      });
    } catch (err) {
      console.warn("Demucs preview fallback to ffmpeg:", err?.message);
    }
  }

  // If AI isolation is selected and DeepFilter binary exists, try deepfilter first
  if (["ai-isolation", "deepfilter"].includes(effectiveMode) && hasDeepFilterEngine()) {
    try {
      return await renderDeepFilterTrack(inputPath, strength, outputPath, {
        time: startTime,
        duration: 8,
      });
    } catch (err) {
      console.warn("DeepFilter preview fallback to ffmpeg:", err?.message);
    }
  }

  // Graceful fallback / traditional filter graph
  const filter = audioDenoiseFilter(resolvedConfig) || "anull";
  const previewArgs = (audioFilter) => [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(startTime),
    "-t",
    "8",
    "-i",
    inputPath,
    "-vn",
    "-af",
    audioFilter,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    outputPath,
  ];
  try {
    await run(mediaBinary("ffmpeg"), previewArgs(filter));
  } catch (error) {
    console.warn("Denoise preview advanced filters failed; retrying stable chain:", error?.message);
    await fs.promises.unlink(outputPath).catch(() => {});
    await run(mediaBinary("ffmpeg"), previewArgs(stableDenoiseFallbackFilter(strength)));
  }
  return outputPath;
}

export async function renderLutPreviewFrame(inputPath, time, lutPath) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error("请先导入视频。");
  if (!lutPath || !fs.existsSync(lutPath)) throw new Error("LUT 文件不存在。");
  // LUT frames are disposable OS-temporary files. Keeping them outside the
  // project cache prevents an explicit cache-clear from deleting a frame
  // while FFmpeg is still writing it.
  const directory = path.join(os.tmpdir(), "QuickCut", "previews", "lut");
  const outputPath = path.join(directory, `lut-${crypto.randomUUID()}.jpg`);
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", String(Math.max(0, Number(time || 0))),
    "-i", inputPath,
    "-vf", `lut3d=file='${escapeFilterPath(lutPath)}':interp=tetrahedral,scale=540:-2:flags=bilinear`,
    "-frames:v", "1", "-q:v", "3", outputPath,
  ];
  // Cache cleanup may run concurrently with preview generation. Recreate the
  // directory and retry once if it disappears between mkdir and FFmpeg open.
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    await run(mediaBinary("ffmpeg"), args, { lowPriority: true });
  } catch (error) {
    await fs.promises.unlink(outputPath).catch(() => {});
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    await run(mediaBinary("ffmpeg"), args, { lowPriority: true }).catch(() => {
      throw error;
    });
  }
  return outputPath;
}

export async function renderDenoisedTrack(
  inputPath,
  mode,
  strength,
  destination = "",
  settings = {},
) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error("找不到需要降噪的音频。");
  const directory = destination
    ? path.dirname(path.resolve(destination))
    : path.join(supportRoot(), "previews");
  fs.mkdirSync(directory, { recursive: true });
  const outputPath = destination
    ? path.resolve(destination)
    : path.join(directory, `denoised-track-${crypto.randomUUID()}.m4a`);

  const supplied = { ...(settings || {}), mode: mode || settings?.mode, strength };
  const resolvedConfig = await resolveAutomaticHum(inputPath, supplied, 0);
  const effectiveMode = resolvedConfig.mode;

  // If Demucs is selected and Demucs binary exists, try demucs
  if (effectiveMode === "demucs" && hasDemucsEngine()) {
    try {
      return await renderDemucsTrack(inputPath, strength, outputPath);
    } catch (err) {
      console.warn("Demucs full track fallback to ffmpeg:", err?.message);
    }
  }

  // If AI isolation is selected and DeepFilter binary exists, try deepfilter first
  if (["ai-isolation", "deepfilter"].includes(effectiveMode) && hasDeepFilterEngine()) {
    try {
      return await renderDeepFilterTrack(inputPath, strength, outputPath);
    } catch (err) {
      console.warn("DeepFilter full track fallback to ffmpeg:", err?.message);
    }
  }

  // Graceful fallback / traditional filter graph
  const temporary = path.join(
    directory,
    `.${path.basename(outputPath)}.${crypto.randomUUID()}.partial.m4a`,
  );
  const filter = audioDenoiseFilter(resolvedConfig) || "anull";
  const trackArgs = (audioFilter) => [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-af",
    audioFilter,
    "-c:a",
    "aac",
    "-b:a",
    "224k",
    temporary,
  ];
  try {
    try {
      await run(mediaBinary("ffmpeg"), trackArgs(filter));
    } catch (error) {
      console.warn("Denoise track advanced filters failed; retrying stable chain:", error?.message);
      await fs.promises.unlink(temporary).catch(() => {});
      await run(mediaBinary("ffmpeg"), trackArgs(stableDenoiseFallbackFilter(strength)));
    }
    const stat = await fs.promises.stat(temporary).catch(() => null);
    if (!stat?.isFile() || stat.size < 256)
      throw new Error("降噪音轨没有正确生成，请重试。");
    await fs.promises.rename(temporary, outputPath);
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }
  return outputPath;
}
