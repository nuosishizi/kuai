import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildAudioFxFilterChain,
  learnNoiseBandProfile,
  normalizeAudioFxRack,
} from "../audio-fx.mjs";
import { mergeRanges } from "../pausecut.mjs";
import { mediaBinary, supportRoot, hasAudioFilter, run, escapeFilterPath, probeMedia } from "./core.mjs";
import {
  audioDenoiseFilter,
  buildProfessionalDenoiseChain,
  rnnoiseModelPath,
  audioMasterFilter,
  analyzeHumSamples,
} from "./denoise.mjs";

const execFileAsync = promisify(execFile);

export function keptSegments(duration, removals) {
  const ranges = mergeRanges(removals || [], duration);
  const segments = [];
  let cursor = 0;
  ranges.forEach((range) => {
    if (range.start > cursor + 0.002)
      segments.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  });
  if (cursor < duration - 0.002)
    segments.push({ start: cursor, end: duration });
  return segments;
}

export function appendMainClipAudioFilters(graph, config, inputLabel) {
  if (!inputLabel || !(config.mainAudioClips || []).length) return inputLabel;
  const filters = [];
  for (const clip of config.mainAudioClips || []) {
    const start = Math.max(0, Number(clip.start || 0));
    const end = Math.max(start + 0.002, Number(clip.end || start));
    const enable = `between(t,${start.toFixed(4)},${end.toFixed(4)})`;
    const volume = clip.muted
      ? 0
      : Math.max(0, Math.min(4, Number(clip.volume ?? 1)));
    if (clip.muted || Math.abs(volume - 1) > 0.001)
      filters.push(
        `volume=volume=${volume.toFixed(3)}:enable='${enable}'`,
      );
    const pan = Math.max(-1, Math.min(1, Number(clip.pan || 0)));
    if (Math.abs(pan) > 0.001)
      filters.push(
        `stereotools=balance_out=${pan.toFixed(3)}:enable='${enable}'`,
      );
    const fadeIn = Math.max(0, Math.min(end - start, Number(clip.fadeIn || 0)));
    const fadeOut = Math.max(
      0,
      Math.min(end - start, Number(clip.fadeOut || 0)),
    );
    if (fadeIn > 0.001)
      filters.push(
        `afade=t=in:st=${start.toFixed(4)}:d=${fadeIn.toFixed(4)}`,
      );
    if (fadeOut > 0.001)
      filters.push(
        `afade=t=out:st=${Math.max(start, end - fadeOut).toFixed(4)}:d=${fadeOut.toFixed(4)}`,
      );
  }
  if (!filters.length) return inputLabel;
  graph.push(`${inputLabel}${filters.join(",")}[clipprocesseda]`);
  return "[clipprocesseda]";
}

export function appendExternalAudio(
  graph,
  config,
  firstInputIndex,
  initialLabel = null,
) {
  const labels = initialLabel ? [initialLabel] : [];
  const outputDuration = Math.max(0.04, Number(config.outputDuration || 0));
  const speed = Math.max(0.5, Math.min(2, Number(config.audio?.speed || 1)));
  (config.audioAssets || []).forEach((audio, index) => {
    if (config.trackVisibility?.[audio.trackId] === false) return;
    const start = Math.max(0, Number(audio.start || 0));
    const end = Math.max(start + 0.04, Number(audio.end || start + 0.04));
    const sourceStart = Math.max(0, Number(audio.sourceStart || 0));
    const duration = Math.max(0.04, end - start);
    const sourceDuration = duration * speed;
    const volume = audio.muted
      ? 0
      : Math.max(0, Math.min(4, Number(audio.volume ?? 1)));
    const pan = Math.max(-1, Math.min(1, Number(audio.pan || 0)));
    const fadeIn = Math.max(0, Math.min(duration, Number(audio.fadeIn || 0)));
    const fadeOut = Math.max(0, Math.min(duration, Number(audio.fadeOut || 0)));
    const itemFilters = [
      `atrim=start=${sourceStart.toFixed(5)}:duration=${sourceDuration.toFixed(5)}`,
      "asetpts=PTS-STARTPTS",
    ];
    if (Math.abs(speed - 1) > 0.001)
      itemFilters.push(`atempo=${speed.toFixed(4)}`);
    const itemFx = buildAudioFxFilterChain(audio.fxRack || [], {
      bypass: !!audio.fxBypass,
      rnnoiseModel: rnnoiseModelPath(),
      detectedHumFrequency: Number(audio.detectedHumFrequency || 0),
      dialogueEnhance: hasAudioFilter("dialoguenhance"),
    });
    if (itemFx) itemFilters.push(itemFx);
    itemFilters.push(`volume=${volume.toFixed(3)}`);
    if (Math.abs(pan) > 0.001)
      itemFilters.push(`stereotools=balance_out=${pan.toFixed(3)}`);
    if (fadeIn > 0.001)
      itemFilters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(4)}`);
    if (fadeOut > 0.001)
      itemFilters.push(
        `afade=t=out:st=${Math.max(0, duration - fadeOut).toFixed(4)}:d=${fadeOut.toFixed(4)}`,
      );
    itemFilters.push(
      `adelay=${Math.round(start * 1000)}:all=1`,
      "apad",
      `atrim=duration=${outputDuration.toFixed(5)}`,
    );
    const label = `[externala${index}]`;
    graph.push(
      `[${firstInputIndex + index}:a]${itemFilters.join(",")}${label}`,
    );
    labels.push(label);
  });
  if (!labels.length) return null;
  if (labels.length === 1) return labels[0];
  graph.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,atrim=duration=${outputDuration.toFixed(5)}[mixeda]`,
  );
  return "[mixeda]";
}

export function buildMainAudioClipsGraph(graph, clips, speed, outputDuration, labelPrefix = "a", mainAudioInputIndex = 0) {
  const sortedClips = [...(clips || [])].sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
  const audioSegments = [];
  let timelineCursor = 0;

  sortedClips.forEach((clip, index) => {
    const start = Math.max(0, Number(clip.start || 0));
    const end = Math.max(start + 0.002, Number(clip.end || start));
    const sourceStart = Math.max(0, Number(clip.sourceStart || 0));
    const sourceEnd = Math.max(
      sourceStart + 0.002,
      Number(clip.sourceEnd || sourceStart + (end - start) * speed),
    );
    const clipDuration = Math.max(0.002, (sourceEnd - sourceStart) / speed);
    const edgeFade = Math.min(0.006, clipDuration / 4);

    if (start > timelineCursor + 0.002) {
      const gapDuration = start - timelineCursor;
      const gapLabel = `[${labelPrefix}gap${index}]`;
      graph.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${gapDuration.toFixed(5)},asetpts=PTS-STARTPTS${gapLabel}`,
      );
      audioSegments.push(gapLabel);
      timelineCursor = start;
    }

    const clipLabel = `[${labelPrefix}clip${index}]`;
    const clipFx = buildAudioFxFilterChain(clip.fxRack || [], {
      bypass: !!clip.fxBypass,
      rnnoiseModel: rnnoiseModelPath(),
      detectedHumFrequency: Number(clip.detectedHumFrequency || 0),
      dialogueEnhance: hasAudioFilter("dialoguenhance"),
    });
    const clipFxFilter = clipFx ? `,${clipFx}` : "";
    const fadeFilters = edgeFade > 0.001
      ? `,afade=t=in:st=0:d=${edgeFade.toFixed(5)},afade=t=out:st=${Math.max(0, clipDuration - edgeFade).toFixed(5)}:d=${edgeFade.toFixed(5)}`
      : "";
    graph.push(
      `[${mainAudioInputIndex}:a]atrim=start=${sourceStart.toFixed(5)}:end=${sourceEnd.toFixed(5)},asetpts=PTS-STARTPTS,atempo=${speed.toFixed(4)}${clipFxFilter}${fadeFilters}${clipLabel}`,
    );
    audioSegments.push(clipLabel);
    timelineCursor = start + clipDuration;
  });

  if (outputDuration > timelineCursor + 0.002) {
    const tailDuration = outputDuration - timelineCursor;
    const tailLabel = `[${labelPrefix}gaptail]`;
    graph.push(
      `anullsrc=r=48000:cl=stereo,atrim=duration=${tailDuration.toFixed(5)},asetpts=PTS-STARTPTS${tailLabel}`,
    );
    audioSegments.push(tailLabel);
  }

  if (audioSegments.length > 1) {
    graph.push(`${audioSegments.join("")}concat=n=${audioSegments.length}:v=0:a=1[joineda]`);
  } else if (audioSegments.length === 1) {
    graph.push(`${audioSegments[0]}anull[joineda]`);
  } else {
    graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${outputDuration.toFixed(5)}[joineda]`);
  }
}

export function buildAudioExportGraph(config, info, audioInputOffset = 1, mainAudioInputIndex = 0) {
  const graph = [];
  let label = null;
  const hasDenoisedMainAudio = !!(config.mainAudioPath && fs.existsSync(config.mainAudioPath));
  if (info.audioCodec || hasDenoisedMainAudio) {
    const segments = keptSegments(info.duration, config.removals || []);
    if (!segments.length && !(config.audioAssets || []).length)
      throw new Error("所有音频内容都被删除了，无法导出。");
    const speed = Math.max(0.5, Math.min(2, Number(config.audio?.speed || 1)));
    let cursor = Math.max(0, Number(config.mainTimelineOffset || 0));
    const fallback = segments.map((segment) => {
      const duration = (segment.end - segment.start) / speed;
      const clip = {
        sourceStart: segment.start,
        sourceEnd: segment.end,
        start: cursor,
        end: cursor + duration,
      };
      cursor += duration;
      return clip;
    });
    const clips =
      Array.isArray(config.mainAudioClips) && config.mainAudioClips.length
        ? config.mainAudioClips
        : fallback;
    const outputDuration = Math.max(
      0.04,
      Number(config.outputDuration || cursor || info.duration),
    );
    buildMainAudioClipsGraph(graph, clips, speed, outputDuration, "a", mainAudioInputIndex);
    label = "[joineda]";
    const effectiveAudioConfig = hasDenoisedMainAudio
      ? { ...config, denoise: { ...(config.denoise || {}), strength: 0 } }
      : config;
    const master = label
      ? audioMasterFilter(
          { ...effectiveAudioConfig, audio: { ...(config.audio || {}), speed: 1, offset: 0 } },
          info,
        )
      : "";
    if (master) {
      graph.push(`${label}${master}[denoiseda]`);
      label = "[denoiseda]";
    }
    label = appendMainClipAudioFilters(graph, config, label);
    if (label && (config.audioMutes || []).length) {
      const filters = config.audioMutes.map(
        (range) =>
          `volume=enable='between(t,${Number(range.start).toFixed(3)},${Number(range.end).toFixed(3)})':volume=0`,
      );
      graph.push(`${label}${filters.join(",")}[outa]`);
      label = "[outa]";
    }
  }
  label = appendExternalAudio(graph, config, audioInputOffset, label);
  if (!label) throw new Error("这个工程没有可导出的音频轨道。");
  return { graph: graph.join(";"), audioLabel: label };
}

function combinedAudioFxFilter(input = {}) {
  const filters = [];
  const quick = input.quickDenoise || input.denoise || {};
  if (Number(quick.strength || 0) > 0.01) {
    const quickFilter = audioDenoiseFilter(quick);
    if (quickFilter) filters.push(quickFilter);
  }
  const clipFilter = buildAudioFxFilterChain(input.clipFxRack || [], {
    bypass: !!input.clipFxBypass,
    rnnoiseModel: rnnoiseModelPath(),
    detectedHumFrequency: Number(input.detectedHumFrequency || 0),
    dialogueEnhance: hasAudioFilter("dialoguenhance"),
  });
  if (clipFilter) filters.push(clipFilter);
  const trackFilter = buildAudioFxFilterChain(input.trackFxRack || input.audioFxRack || [], {
    bypass: !!input.trackFxBypass || !!input.audioFxBypass,
    rnnoiseModel: rnnoiseModelPath(),
    detectedHumFrequency: Number(input.detectedHumFrequency || 0),
    dialogueEnhance: hasAudioFilter("dialoguenhance"),
  });
  if (trackFilter) filters.push(trackFilter);
  return filters.join(",") || "anull";
}

function rackNeedsAutomaticHum(rack = [], bypass = false) {
  if (bypass) return false;
  return normalizeAudioFxRack(rack).some((effect) =>
    effect.enabled && effect.type === "de-hummer" &&
    String(effect.params?.frequency || "auto") === "auto" &&
    ![50, 60].includes(Number(effect.params?.detectedFrequency || 0)),
  );
}

async function resolveAutomaticAudioFxHum(inputPath, time, settings = {}) {
  const alreadyDetected = Number(settings.detectedHumFrequency || 0);
  if ([50, 60].includes(alreadyDetected)) return settings;
  const needsAnalysis =
    rackNeedsAutomaticHum(settings.clipFxRack, settings.clipFxBypass) ||
    rackNeedsAutomaticHum(settings.trackFxRack || settings.audioFxRack, settings.trackFxBypass || settings.audioFxBypass);
  if (!needsAnalysis) return settings;
  const profile = await analyzeNoiseProfile(inputPath, {
    time: Math.max(0, Number(time || 0) - 1),
    duration: 6,
  });
  return { ...settings, detectedHumFrequency: Number(profile.humFrequency || 0) };
}

export async function learnAudioFxNoiseProfile(inputPath, options = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error("找不到需要学习噪声的音频。");
  const sampleRate = 24000;
  const time = Math.max(0, Number(options.time || 0));
  const duration = Math.max(0.25, Math.min(10, Number(options.duration || 2)));
  const bytes = await run(mediaBinary("ffmpeg"), [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-ss", time.toFixed(4), "-t", duration.toFixed(4),
    "-i", inputPath, "-vn", "-ac", "1", "-ar", String(sampleRate),
    "-f", "f32le", "pipe:1",
  ], { lowPriority: true });
  const samples = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    Math.floor(bytes.byteLength / 4),
  );
  const profile = learnNoiseBandProfile(samples, sampleRate);
  const hum = analyzeHumSamples(samples, sampleRate);
  return {
    ...profile,
    humFrequency: hum.humFrequency,
    humConfidence: hum.confidence,
    time,
    duration: Number((samples.length / sampleRate).toFixed(3)),
  };
}

export async function renderAudioFxPreview(inputPath, time = 0, settings = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error("找不到需要试听的音频。");
  const directory = settings.previewDirectory
    ? path.resolve(settings.previewDirectory)
    : path.join(supportRoot(), "previews");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const outputPath = path.join(directory, `audio-fx-${crypto.randomUUID()}.m4a`);
  const mediaDuration = Math.max(0, Number(probeMedia(inputPath).duration || 0));
  const requestedTime = Math.max(0, Math.min(mediaDuration || Number(time || 0), Number(time || 0)));
  // Keep enough material after the listening point. Near the source tail we
  // move the audition point back instead of seeking straight to the file end.
  const auditionTime = mediaDuration > 0
    ? Math.min(requestedTime, Math.max(0, mediaDuration - Math.min(4, mediaDuration)))
    : requestedTime;
  const previewDuration = mediaDuration > 0 ? Math.min(8, mediaDuration) : 8;
  const startTime = Math.max(0, Math.min(auditionTime - 2, Math.max(0, mediaDuration - previewDuration)));
  const targetOffset = Math.max(0, auditionTime - startTime);
  const resolvedSettings = await resolveAutomaticAudioFxHum(inputPath, auditionTime, settings);
  await run(mediaBinary("ffmpeg"), [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", startTime.toFixed(4), "-t", previewDuration.toFixed(4), "-i", inputPath, "-vn",
    "-af", combinedAudioFxFilter(resolvedSettings),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", outputPath,
  ], { lowPriority: true });
  const stat = await fs.promises.stat(outputPath).catch(() => null);
  if (!stat?.isFile() || stat.size < 256) throw new Error("高级降噪试听文件生成失败。");
  return { path: outputPath, startTime, targetOffset, duration: previewDuration };
}

export async function renderAudioFxTrack(inputPath, destination, settings = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error("找不到需要处理的音频。");
  if (!destination) throw new Error("高级降噪音轨保存位置无效。");
  const outputPath = path.resolve(destination);
  const directory = path.dirname(outputPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(outputPath)}.${crypto.randomUUID()}.partial.m4a`);
  try {
    const resolvedSettings = await resolveAutomaticAudioFxHum(inputPath, 0, settings);
    await run(mediaBinary("ffmpeg"), [
      "-y", "-hide_banner", "-loglevel", "error", "-i", inputPath, "-vn",
      "-af", combinedAudioFxFilter(resolvedSettings),
      "-c:a", "aac", "-b:a", "224k", "-ar", "48000", temporary,
    ]);
    const stat = await fs.promises.stat(temporary).catch(() => null);
    if (!stat?.isFile() || stat.size < 256) throw new Error("高级降噪整轨没有正确生成。");
    await fs.promises.rename(temporary, outputPath);
    return outputPath;
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }
}
