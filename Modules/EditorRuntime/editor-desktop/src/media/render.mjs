import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mediaBinary,
  supportRoot,
  forceKillProcess,
  videoEncodeArgs,
  preferredVideoEncoder,
  preferredExportDecodeKind,
  normalizeExportDevice,
  encoderDisplayName,
  isHardwareEncoder,
  listBusyGpuApps,
  shouldSkipHardwareForBusyGpu,
  exportStallLimit,
  encoderStallMessage,
  exportIsStalled,
  isSpawnTooLongError,
  compactFfmpegFilterArgs,
  WINDOWS_SPAWN_SAFE_CHARS,
  shouldWriteFilterComplexScript,
  probeMedia,
  probeMediaAsync,
  sourceGeometry,
  sourceOrientationFilters,
  detectExportHardware,
  resetExportHardwareProbe,
  captionRasterItems,
  captionRastersUseMovieFilter,
  collectExportExtraInputs,
  composeCaptionRasterConcat,
  escapeFilterPath,
  escapeDrawtext,
  run,
  hasAudioFilter,
  decodeAccelArgs,
} from "./core.mjs";
import { buildProfessionalDenoiseChain, audioMasterFilter } from "./denoise.mjs";
import { writeAssSubtitleFile, animatedPosition } from "./ass.mjs";
import { buildAudioExportGraph, appendMainClipAudioFilters, appendExternalAudio, buildMainAudioClipsGraph, keptSegments } from "./audio-fx.mjs";
import { normalizeAudioFxRack } from "../audio-fx.mjs";
import { isDarwin, isWindows } from "../platform.mjs";

const execFileAsync = promisify(execFile);

const jobs = new Map();

export function buildExportGraph(config, info) {
  const width = Math.max(320, Math.round(config.width || 1080));
  const height = Math.max(320, Math.round(config.height || 1920));
  const fps = Math.max(24, Math.min(60, Number(config.fps || 30)));
  const segments = keptSegments(info.duration, config.removals || []);
  if (!segments.length) throw new Error("所有视频内容都被删除了，无法导出。");
  const graph = [];
  const speed = Math.max(0.5, Math.min(2, Number(config.audio?.speed || 1)));
  const legacyOffset = Math.max(0, Number(config.mainTimelineOffset || 0));
  let legacyCursor = legacyOffset;
  const fallbackMainClips = segments.map((segment) => {
    const duration = (segment.end - segment.start) / speed;
    const clip = {
      sourceStart: segment.start,
      sourceEnd: segment.end,
      start: legacyCursor,
      end: legacyCursor + duration,
      trackId: "video",
    };
    legacyCursor += duration;
    return clip;
  });
  const hasExplicitMainClips = Array.isArray(config.mainVideoClips) && config.mainVideoClips.length;
  const mainVideoClips = hasExplicitMainClips ? config.mainVideoClips : fallbackMainClips;
  const outputDuration = Math.max(
    0.04,
    Number(config.outputDuration || legacyCursor || info.duration),
  );
  const oriented = sourceOrientationFilters(info, { width, height });
  const linearCutMode = mainClipsUseConcat(mainVideoClips);
  if (linearCutMode) {
    const labels = [];
    const size = `${oriented.displayWidth}x${oriented.displayHeight}`;
    let cursor = 0;
    let gapIndex = 0;
    const pushGap = (duration) => {
      const label = `[vgap${gapIndex}]`;
      graph.push(
        `color=c=black:s=${size}:r=${fps}:d=${Math.max(0.02, duration).toFixed(5)},format=yuv420p${label}`,
      );
      labels.push(label);
      gapIndex += 1;
    };
    [...mainVideoClips]
      .sort((left, right) => Number(left.start || 0) - Number(right.start || 0))
      .forEach((clip, index) => {
        const start = Math.max(0, Number(clip.start || 0));
        const end = Math.max(start + 0.002, Number(clip.end || start));
        const sourceStart = Math.max(0, Number(clip.sourceStart || 0));
        const sourceEnd = Math.max(
          sourceStart + 0.002,
          Number(clip.sourceEnd || sourceStart + (end - start) * speed),
        );
        if (start > cursor + 0.005) pushGap(start - cursor);
        graph.push(
          `[0:v]trim=start=${sourceStart.toFixed(5)}:end=${sourceEnd.toFixed(5)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)},${oriented.filters.join(",")},format=yuv420p[vcut${index}]`,
        );
        labels.push(`[vcut${index}]`);
        cursor = Math.max(cursor, end);
      });
    if (outputDuration > cursor + 0.005) pushGap(outputDuration - cursor);
    if (labels.length === 1) graph.push(`${labels[0]}null[joinedv]`);
    else {
      graph.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=0[joinedv0]`);
      graph.push(
        `[joinedv0]tpad=stop_mode=clone:stop_duration=0.08,trim=duration=${outputDuration.toFixed(5)},setpts=PTS-STARTPTS[joinedv]`,
      );
    }
  } else {
    graph.push(
      `color=c=black:s=${oriented.displayWidth}x${oriented.displayHeight}:r=${fps}:d=${outputDuration.toFixed(5)}[maincanvas0]`,
    );
    mainVideoClips.forEach((clip, index) => {
    const start = Math.max(0, Number(clip.start || 0));
    const end = Math.max(start + 0.002, Number(clip.end || start));
    const sourceStart = Math.max(0, Number(clip.sourceStart || 0));
    const sourceEnd = Math.max(
      sourceStart + 0.002,
      Number(clip.sourceEnd || sourceStart + (end - start) * speed),
    );
    const settings = clip.settings || {},
      cropTop = Math.max(0, Math.min(95, Number(settings.cropTop || 0))),
      cropBottom = Math.max(0, Math.min(95, Number(settings.cropBottom || 0))),
      cropLeft = Math.max(0, Math.min(95, Number(settings.cropLeft || 0))),
      cropRight = Math.max(0, Math.min(95, Number(settings.cropRight || 0))),
      clipScale = Math.max(0.05, Number(settings.scale || 1)),
      rotation = Math.max(-360, Math.min(360, Number(settings.rotation || 0))),
      opacity = Math.max(0, Math.min(1, Number(settings.opacity ?? 1))),
      transformFilters = [
        ...oriented.filters,
      ];
    const cropW = Math.max(0.01, 1 - (cropLeft + cropRight) / 100);
    const cropH = Math.max(0.01, 1 - (cropTop + cropBottom) / 100);
    transformFilters.push(`scale=iw*${clipScale.toFixed(5)}:ih*${clipScale.toFixed(5)}:flags=lanczos+accurate_rnd`);
    if (cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0) {
      transformFilters.push(`crop=w=iw*${cropW.toFixed(4)}:h=ih*${cropH.toFixed(4)}:x=iw*${(cropLeft / 100).toFixed(4)}:y=ih*${(cropTop / 100).toFixed(4)}`);
    }
    if (Math.abs(rotation) > 0.001)
      transformFilters.push(
        `rotate=${rotation.toFixed(4)}*PI/180:ow=rotw(iw):oh=roth(ih):c=none`,
      );
    if (opacity < 0.999)
      transformFilters.push(
        `format=rgba,colorchannelmixer=aa=${opacity.toFixed(4)}`,
      );
    const padded = start > 0.001
      ? `setpts=(PTS-STARTPTS)/${speed.toFixed(4)},${transformFilters.join(",")},tpad=start_mode=add:start_duration=${start.toFixed(5)}:color=black@0,setpts=PTS-STARTPTS`
      : `setpts=(PTS-STARTPTS)/${speed.toFixed(4)},${transformFilters.join(",")}`;
    graph.push(
      `[0:v]trim=start=${sourceStart.toFixed(5)}:end=${sourceEnd.toFixed(5)},${padded}[mainraw${index}]`,
    );
    const clipX = (cropLeft > 0 || cropRight > 0)
      ? `(W-w/${cropW.toFixed(5)})/2+${Math.round(Number(settings.x || 0))}+${(cropLeft / 100).toFixed(5)}*w/${cropW.toFixed(5)}`
      : `(W-w)/2+${Math.round(Number(settings.x || 0))}`;
    const clipY = (cropTop > 0 || cropBottom > 0)
      ? `(H-h/${cropH.toFixed(5)})/2+${Math.round(Number(settings.y || 0))}+${(cropTop / 100).toFixed(5)}*h/${cropH.toFixed(5)}`
      : `(H-h)/2+${Math.round(Number(settings.y || 0))}`;
    graph.push(
      `[maincanvas${index}][mainraw${index}]overlay=x='${clipX}':y='${clipY}':enable='between(t,${start.toFixed(5)},${end.toFixed(5)})':eof_action=pass:shortest=0[maincanvas${index + 1}]`,
    );
    });
    graph.push(`[maincanvas${mainVideoClips.length}]null[joinedv]`);
  }
  const hasDenoisedMainAudio = !!(config.mainAudioPath && fs.existsSync(config.mainAudioPath));
  const mainAudioInputIndex = hasDenoisedMainAudio ? 1 : 0;
  if (info.audioCodec || hasDenoisedMainAudio) {
    const audioClips =
      Array.isArray(config.mainAudioClips) && config.mainAudioClips.length
        ? config.mainAudioClips
        : mainVideoClips;
    buildMainAudioClipsGraph(graph, audioClips, speed, outputDuration, "maina", mainAudioInputIndex);
  }
  const mainOffset = 0;
  let sourceVideoLabel = "[joinedv]";
  const color = config.color || {};
  const filters = [];
  const exposure = Math.max(-2, Math.min(2, Number(color.exposure || 0) / 50));
  if (Math.abs(exposure) > 0.001)
    filters.push(`exposure=exposure=${exposure.toFixed(3)}:black=0`);
  const contrast = Math.max(0.1, 1 + Number(color.contrast || 0) / 72);
  const pivot = Math.max(-1, Math.min(1, Number(color.pivot || 0) / 100));
  const saturation = Math.max(0, 1 + Number(color.saturation || 0) / 75);
  filters.push(
    `eq=brightness=${(-pivot * (contrast - 1) * 0.18).toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}`,
  );
  const lift = Math.max(-1, Math.min(1, Number(color.lift || 0) / 100));
  const gamma = Math.max(-1, Math.min(1, Number(color.gamma || 0) / 100));
  const gain = Math.max(-1, Math.min(1, Number(color.gain || 0) / 100));
  const blacks = Math.max(-1, Math.min(1, Number(color.blacks || 0) / 100));
  const whites = Math.max(-1, Math.min(1, Number(color.whites || 0) / 100));
  const fade = Math.max(0, Math.min(1, Number(color.fade || 0) / 100));
  if (
    Math.abs(lift) > 0.001 || Math.abs(gain) > 0.001 ||
    Math.abs(blacks) > 0.001 || Math.abs(whites) > 0.001 || fade > 0.001
  ) {
    const inputBlack = Math.max(-0.18, Math.min(0.18, -lift * 0.12 - blacks * 0.08));
    const outputBlack = Math.max(0, Math.min(0.22, lift * 0.12 + Math.max(0, blacks) * 0.06 + fade * 0.12));
    const inputWhite = Math.max(0.72, Math.min(1, 1 - Math.max(0, gain) * 0.18 - Math.max(0, whites) * 0.09));
    const outputWhite = Math.max(0.72, Math.min(1, 1 + Math.min(0, gain) * 0.18 + Math.min(0, whites) * 0.08 - fade * 0.05));
    filters.push(
      `colorlevels=rimin=${inputBlack.toFixed(3)}:gimin=${inputBlack.toFixed(3)}:bimin=${inputBlack.toFixed(3)}:rimax=${inputWhite.toFixed(3)}:gimax=${inputWhite.toFixed(3)}:bimax=${inputWhite.toFixed(3)}:romin=${outputBlack.toFixed(3)}:gomin=${outputBlack.toFixed(3)}:bomin=${outputBlack.toFixed(3)}:romax=${outputWhite.toFixed(3)}:gomax=${outputWhite.toFixed(3)}:bomax=${outputWhite.toFixed(3)}`,
    );
  }
  if (Math.abs(gamma) > 0.001) {
    const mid = Math.max(0.08, Math.min(0.92, 0.5 + gamma * 0.24));
    filters.push(`curves=all='0/0 0.5/${mid.toFixed(3)} 1/1'`);
  }
  const shadows = Math.max(-1, Math.min(1, Number(color.shadows || 0) / 100));
  const highlights = Math.max(-1, Math.min(1, Number(color.highlights || 0) / 100));
  if (Math.abs(shadows) > 0.001 || Math.abs(highlights) > 0.001) {
    const shadowPoint = Math.max(0.08, Math.min(0.43, 0.25 + shadows * 0.14));
    const highlightPoint = Math.max(0.57, Math.min(0.92, 0.75 + highlights * 0.14));
    filters.push(`curves=all='0/0 0.25/${shadowPoint.toFixed(3)} 0.5/0.5 0.75/${highlightPoint.toFixed(3)} 1/1'`);
  }
  const vibrance = Math.max(
    -2,
    Math.min(2, Number(color.vibrance || 0) / 50),
  );
  if (Math.abs(vibrance) > 0.001)
    filters.push(`vibrance=intensity=${vibrance.toFixed(3)}`);
  const hueShift = Math.max(-180, Math.min(180, Number(color.hue || 0) * 1.8));
  if (Math.abs(hueShift) > 0.001)
    filters.push(`hue=h=${hueShift.toFixed(2)}`);
  const temperature = Math.max(
    -0.5,
    Math.min(0.5, Number(color.temperature || 0) / 200),
  );
  const tint = Math.max(-0.4, Math.min(0.4, Number(color.tint || 0) / 250));
  if (Math.abs(temperature) > 0.001 || Math.abs(tint) > 0.001)
    filters.push(
      `colorbalance=rs=${temperature.toFixed(3)}:gs=${tint.toFixed(3)}:bs=${(-temperature).toFixed(3)}:rm=${(temperature * 0.55).toFixed(3)}:gm=${(tint * 0.65).toFixed(3)}:bm=${(-temperature * 0.55).toFixed(3)}`,
    );
  const midtoneDetail = Math.max(-100, Math.min(100, Number(color.midtoneDetail || 0)));
  if (Math.abs(midtoneDetail) > 0.1)
    filters.push(`unsharp=9:9:${(midtoneDetail / 32).toFixed(3)}:7:7:0`);
  const sharpness = Math.max(0, Math.min(100, Number(color.sharpness || 0)));
  if (sharpness > 0.1)
    filters.push(`unsharp=5:5:${(sharpness / 42).toFixed(3)}:5:5:0`);
  const vignette = Math.max(0, Math.min(1, Number(color.vignette || 0) / 100));
  if (vignette > 0.01)
    filters.push(
      `vignette=angle=PI/${(4.8 - vignette * 3.35).toFixed(3)}:eval=frame`,
    );
  const beauty = config.beauty || {};
  const smoothing = Math.max(
    0,
    Math.min(1, Number(beauty.smoothing || 0) / 100),
  );
  const blemish = Math.max(
    0,
    Math.min(1, Number(beauty.blemish || 0) / 100),
  );
  const texture = Math.max(
    0,
    Math.min(1, Number(beauty.texture || 0) / 100),
  );
  const whitening = Math.max(
    0,
    Math.min(1, Number(beauty.whitening || 0) / 100),
  );
  const brighten = Math.max(
    -1,
    Math.min(1, Number(beauty.brighten || 0) / 100),
  );
  const warmth = Math.max(-1, Math.min(1, Number(beauty.warmth || 0) / 50));
  const rosy = Math.max(
    -1,
    Math.min(1, Number(beauty.rosy || 0) / 100),
  );
  if (Math.abs(warmth) > 0.01 || Math.abs(rosy) > 0.01)
    filters.push(
      `colorbalance=rs=${(warmth * 0.075 + rosy * 0.045).toFixed(3)}:gs=${(-rosy * 0.018).toFixed(3)}:bs=${(-warmth * 0.075 - rosy * 0.025).toFixed(3)}:rm=${(warmth * 0.045 + rosy * 0.035).toFixed(3)}:gm=0:bm=${(-warmth * 0.045).toFixed(3)}`,
    );
  // Do not simulate skin whitening with a global luma/gamma lift. That brightens sky/walls.
  // Preview uses an actual skin mask. Export keeps color changes conservative until a dedicated
  // face segmentation path is available; smoothing/detail remain visible without flattening the frame.
  if (Math.abs(brighten) > 0.01 || whitening > 0.01)
    filters.push(
      `colorbalance=rm=${(brighten * 0.022 + whitening * 0.018).toFixed(3)}:gm=${(brighten * 0.014 + whitening * 0.012).toFixed(3)}:bm=${(-whitening * 0.004).toFixed(3)}`,
    );
  if (texture > 0.01)
    filters.push(
      `unsharp=5:5:${(0.2 + texture * 1.8).toFixed(3)}:5:5:0`,
    );
  const transform = config.videoTransform || {};
  const scale = Math.max(0.05, Number(transform.scale || 1));
  const rotation = Math.max(-360, Math.min(360, Number(transform.rotation || 0)));
  filters.push(
    `scale=w=${Math.round(width * scale)}:h=${Math.round(height * scale)}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos+accurate_rnd`,
    "setsar=1",
  );
  if (Math.abs(rotation) > 0.001)
    filters.push(`rotate=${rotation.toFixed(4)}*PI/180:ow=rotw(iw):oh=roth(ih):c=none`);
  let gradedInput = sourceVideoLabel;
  if (smoothing > 0.01 || blemish > 0.01) {
    // hqdn3d is SIMD-optimised and keeps the hardware encoder fed.  The old
    // smartblur + bilateral chain evaluated two neighbourhood filters for
    // every 1080p frame and could sit at 0% for minutes before frame one.
    graph.push(
      `${sourceVideoLabel}hqdn3d=${(0.18 + smoothing * 0.92 + blemish * 0.52).toFixed(2)}:${(0.14 + smoothing * 0.58).toFixed(2)}:${(0.28 + smoothing * 0.76).toFixed(2)}:${(0.18 + smoothing * 0.48).toFixed(2)},unsharp=5:5:${(0.16 + texture * 1.05 + smoothing * 0.06).toFixed(3)}:5:5:0[beautymerged]`,
    );
    gradedInput = "[beautymerged]";
  }
  const lutPath = String(config.lut?.path || "");
  const lutStrength = Math.max(
    0,
    Math.min(1, Number(config.lut?.intensity ?? 1)),
  );
  if (lutPath && fs.existsSync(lutPath) && lutStrength > 0.001) {
    graph.push(`${gradedInput}${filters.join(",")}[gradedbase]`);
    if (lutStrength >= 0.999)
      graph.push(
        `[gradedbase]lut3d=file='${escapeFilterPath(lutPath)}':interp=tetrahedral[main]`,
      );
    else {
      graph.push(`[gradedbase]split=2[lutoriginal][lutinput]`);
      graph.push(
        `[lutinput]lut3d=file='${escapeFilterPath(lutPath)}':interp=tetrahedral[lutresult]`,
      );
      graph.push(
        `[lutoriginal][lutresult]blend=all_expr='A*${(1 - lutStrength).toFixed(4)}+B*${lutStrength.toFixed(4)}'[main]`,
      );
    }
  } else graph.push(`${gradedInput}${filters.join(",")}[main]`);
  graph.push(`color=c=black:s=${width}x${height}:r=${fps}[base]`);
  const x = `(W-w)/2+${Math.round(Number(transform.x || 0))}`;
  const y = `(H-h)/2+${Math.round(Number(transform.y || 0))}`;
  let layer = 0;
  let inputIndex = hasDenoisedMainAudio ? 2 : 1;
  const mainTrackIds = [...new Set(mainVideoClips.map((clip) => clip.trackId || "video"))];
  const mainTrackLabels = new Map();
  if (mainTrackIds.length > 1) {
    const labels = mainTrackIds.map((_, index) => `[maintrack${index}]`);
    graph.push(`[main]split=${mainTrackIds.length}${labels.join("")}`);
    mainTrackIds.forEach((trackId, index) =>
      mainTrackLabels.set(trackId, labels[index]),
    );
  } else mainTrackLabels.set(mainTrackIds[0] || "video", "[main]");
  const consumedMainTracks = new Set();
  const preparedVideos = (config.videoLayers || []).map((video, index) => {
    const cropTop = Math.max(0, Math.min(95, Number(video.cropTop || 0)));
    const cropBottom = Math.max(0, Math.min(95, Number(video.cropBottom || 0)));
    const cropLeft = Math.max(0, Math.min(95, Number(video.cropLeft || 0)));
    const cropRight = Math.max(0, Math.min(95, Number(video.cropRight || 0)));
    const videoScale = Math.max(0.03, Number(video.scale || 1));
    const clipDuration = Math.max(
      0.04,
      Number(video.end || 0) - Number(video.start || 0),
    );
    const sourceDuration = clipDuration * speed;
    const videoFilters = [];
    const cropW = Math.max(0.01, 1 - (cropLeft + cropRight) / 100);
    const cropH = Math.max(0.01, 1 - (cropTop + cropBottom) / 100);
    videoFilters.push(
      `scale=w=${Math.max(8, Math.round(width * videoScale))}:h=${Math.max(8, Math.round(height * videoScale))}:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd`,
    );
    if (cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0) {
      videoFilters.push(`crop=w=iw*${cropW.toFixed(4)}:h=ih*${cropH.toFixed(4)}:x=iw*${(cropLeft / 100).toFixed(4)}:y=ih*${(cropTop / 100).toFixed(4)}`);
    }
    if (Math.abs(Number(video.rotation || 0)) > 0.001)
      videoFilters.push(
        `rotate=${Number(video.rotation).toFixed(4)}*PI/180:ow=rotw(iw):oh=roth(ih):c=none`,
      );
    videoFilters.push(
      "format=rgba",
      `colorchannelmixer=aa=${Math.max(0, Math.min(1, Number(video.opacity ?? 1))).toFixed(3)}`,
    );
    const overlayStart = Math.max(0, Number(video.start || 0));
    const overlayPad = overlayStart > 0.001
      ? `,tpad=start_mode=add:start_duration=${overlayStart.toFixed(5)}:color=black@0`
      : "";
    graph.push(
      `[${inputIndex}:v]trim=start=${Math.max(0, Number(video.sourceStart || 0)).toFixed(5)}:duration=${sourceDuration.toFixed(5)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)},${videoFilters.join(",")}${overlayPad},setpts=PTS-STARTPTS[overlayv${index}]`,
    );
    inputIndex += 1;
    return { video, label: `[overlayv${index}]` };
  });
  const preparedImages = (config.images || []).map((image, index) => {
    const cropTop = Math.max(0, Math.min(95, Number(image.cropTop || 0)));
    const cropBottom = Math.max(0, Math.min(95, Number(image.cropBottom || 0)));
    const cropLeft = Math.max(0, Math.min(95, Number(image.cropLeft || 0)));
    const cropRight = Math.max(0, Math.min(95, Number(image.cropRight || 0)));
    const imageScale = Math.max(0.03, Number(image.scale ?? 1));
    const imageFilters = [];
    const cropW = Math.max(0.01, 1 - (cropLeft + cropRight) / 100);
    const cropH = Math.max(0.01, 1 - (cropTop + cropBottom) / 100);
    if (!image.pixelExact) {
      if (image.sourceWidth && image.sourceHeight) {
        const targetW = Math.max(8, Math.round(Number(image.sourceWidth) * imageScale));
        const targetH = Math.max(8, Math.round(Number(image.sourceHeight) * imageScale));
        imageFilters.push(`scale=${targetW}:${targetH}:flags=lanczos+accurate_rnd`);
      } else if (Math.abs(imageScale - 1) > 0.001) {
        imageFilters.push(`scale=trunc(iw*${imageScale.toFixed(4)}/2)*2:trunc(ih*${imageScale.toFixed(4)}/2)*2:flags=lanczos+accurate_rnd`);
      }
    }
    if (cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0) {
      imageFilters.push(`crop=w=iw*${cropW.toFixed(4)}:h=ih*${cropH.toFixed(4)}:x=iw*${(cropLeft / 100).toFixed(4)}:y=ih*${(cropTop / 100).toFixed(4)}`);
    }
    if (Math.abs(Number(image.rotation || 0)) > 0.001)
      imageFilters.push(
        `rotate=${Number(image.rotation).toFixed(4)}*PI/180:ow=rotw(iw):oh=roth(ih):c=none`,
      );
    imageFilters.push(
      "format=rgba",
      `colorchannelmixer=aa=${Math.max(0, Math.min(1, Number(image.opacity ?? 1))).toFixed(3)}`,
    );
    if (image.enterAnimation || image.exitAnimation)
      imageFilters.push(`fps=${Math.max(1, Number(config.fps || info.frameRate || 30)).toFixed(3)}`);
    if (image.enterAnimation) {
      const duration = Math.max(0.15, Number(image.enterDuration || 0.45));
      imageFilters.push(
        `fade=t=in:st=${Math.max(0, Number(image.start || 0)).toFixed(4)}:d=${duration.toFixed(4)}:alpha=1`,
      );
    }
    if (image.exitAnimation) {
      const duration = Math.max(0.15, Number(image.exitDuration || 0.45));
      imageFilters.push(
        `fade=t=out:st=${Math.max(Number(image.start || 0), Number(image.end || 0) - duration).toFixed(4)}:d=${duration.toFixed(4)}:alpha=1`,
      );
    }
    if (config.captionRastersViaMovie && image._quickCutCaptionRaster) {
      graph.push(
        `movie='${escapeFilterPath(image.path)}':loop=1,${imageFilters.join(",")}[img${index}]`,
      );
      return { image, label: `[img${index}]` };
    }
    graph.push(
      `[${inputIndex}:v]${imageFilters.join(",")}[img${index}]`,
    );
    inputIndex += 1;
    return { image, label: `[img${index}]` };
  });
  graph.push("[base]null[layer0]");
  const addTextItems = (items) => {
    for (const text of items || []) {
      layer += 1;
      const style = text.style || {};
      const resolvedFont = resolveFontFile(style);
      if (!resolvedFont)
        throw new Error("找不到可用于导出的字体文件，请先在字体面板载入字体。");
      const fontFile = `:fontfile='${escapeDrawtext(resolvedFont)}'`;
      const textScale = Math.max(0.05, Math.min(8, Number(text.scale || 1)));
      const backgroundPadding = Math.max(
        Number(style.backgroundWidth ?? style.padding ?? 14),
        Number(style.backgroundHeight ?? style.padding ?? 14),
      );
      const background = style.backgroundEnabled
        ? `:box=1:boxcolor=${style.background || "black"}@${Math.max(0, Math.min(1, Number(style.backgroundOpacity ?? 0.7))).toFixed(2)}:boxborderw=${Math.round(backgroundPadding * textScale)}`
        : "";
      const shadowDistance = Number(style.shadowDistance ?? style.shadow ?? 0),
        shadowAngle = (Number(style.shadowAngle ?? 45) * Math.PI) / 180,
        shadowX = Math.round(Math.cos(shadowAngle) * shadowDistance * textScale),
        shadowY = Math.round(Math.sin(shadowAngle) * shadowDistance * textScale);
      const shadow =
        Number(style.shadowOpacity ?? 0.8) > 0 &&
        Number(style.shadowBlur ?? style.shadow ?? 0) > 0
          ? `:shadowx=${shadowX}:shadowy=${shadowY}:shadowcolor=${style.shadowColor || "black"}@${Math.max(0, Math.min(1, Number(style.shadowOpacity ?? 0.8))).toFixed(2)}`
          : "";
      const border =
        Number(style.stroke || 0) > 0
          ? `:borderw=${Math.round(Number(style.stroke || 2) * textScale)}:bordercolor=${style.strokeColor || "black"}`
          : "";
      const lineSpacing = Math.round(
        (Number(style.lineHeight || 1.15) - 1) *
          Number(style.fontSize || 54) *
          textScale,
      );
      const baseX = `(w-text_w)/2+${Math.round(Number(text.x || 0))}`,
        baseY = `(h-text_h)/2+${Math.round(Number(text.y || 0))}`,
        animatedX = animatedPosition(text, "x", baseX, 130),
        animatedY = animatedPosition(text, "y", baseY, 130),
        alpha = animatedAlpha(text, 1),
        content = spacedText(casedText(text.text, style.textCase), style.wordSpacing);
      const enable = `between(t,${Number(text.start || 0).toFixed(3)},${Number(text.end || info.duration).toFixed(3)})`,
        backgroundX = animatedPosition(
          text,
          "x",
          `(w-text_w)/2+${Math.round(Number(text.x || 0) + Number(style.backgroundX || 0))}`,
          130,
        ),
        backgroundY = animatedPosition(
          text,
          "y",
          `(h-text_h)/2+${Math.round(Number(text.y || 0) + Number(style.backgroundY || 0))}`,
          130,
        ),
        backgroundDraw = style.backgroundEnabled
          ? `drawtext=text='${escapeDrawtext(content)}'${fontFile}:fontsize=${Math.round(Number(style.fontSize || 54) * textScale)}:line_spacing=${lineSpacing}:fontcolor=white@0:x='${backgroundX}':y='${backgroundY}'${background}:enable='${enable}',`
          : "";
      const draw = `${backgroundDraw}drawtext=text='${escapeDrawtext(content)}'${fontFile}:fontsize=${Math.round(Number(style.fontSize || 54) * textScale)}:line_spacing=${lineSpacing}:fontcolor=${style.color || "white"}:alpha='${alpha}':x='${animatedX}':y='${animatedY}'${shadow}${border}:enable='${enable}'`;
      graph.push(`[layer${layer - 1}]${draw}[layer${layer}]`);
    }
  };
  const order =
    Array.isArray(config.trackOrder) && config.trackOrder.length
      ? [...config.trackOrder].reverse()
      : ["video", "image", "text", "caption"];
  let captionRendered = false;
  for (const key of order) {
    const kind = config.trackDefinitions?.[key]?.kind || key;
    if (config.trackVisibility?.[key] === false) continue;
    if (kind === "video") {
      const mainLabel = mainTrackLabels.get(key);
      if (mainLabel && config.includeVideo !== false) {
        const ranges = mainVideoClips.filter(
          (clip) => (clip.trackId || "video") === key,
        );
        const enable = ranges
          .map(
            (clip) =>
              `between(t,${Math.max(0, Number(clip.start || 0)).toFixed(3)},${Math.max(Number(clip.start || 0), Number(clip.end || 0)).toFixed(3)})`,
          )
          .join("+");
        layer += 1;
        graph.push(
          `[layer${layer - 1}]${mainLabel}overlay=x='${x}':y='${y}':enable='${enable || "1"}':eof_action=pass:shortest=0[layer${layer}]`,
        );
        consumedMainTracks.add(key);
      }
      for (const { video, label } of preparedVideos.filter(
        (item) =>
          item.video.trackId === key ||
          (!item.video.trackId && key === "video-overlay"),
      )) {
        layer += 1;
        const vCropTop = Math.max(0, Math.min(95, Number(video.cropTop || 0)));
        const vCropBottom = Math.max(0, Math.min(95, Number(video.cropBottom || 0)));
        const vCropLeft = Math.max(0, Math.min(95, Number(video.cropLeft || 0)));
        const vCropRight = Math.max(0, Math.min(95, Number(video.cropRight || 0)));
        const vCropW = Math.max(0.01, 1 - (vCropLeft + vCropRight) / 100);
        const vCropH = Math.max(0.01, 1 - (vCropTop + vCropBottom) / 100);
        const vBaseX = (vCropLeft > 0 || vCropRight > 0)
          ? `(W-w/${vCropW.toFixed(5)})/2+${Math.round(Number(video.x || 0))}+${(vCropLeft / 100).toFixed(5)}*w/${vCropW.toFixed(5)}`
          : `(W-w)/2+${Math.round(Number(video.x || 0))}`;
        const vBaseY = (vCropTop > 0 || vCropBottom > 0)
          ? `(H-h/${vCropH.toFixed(5)})/2+${Math.round(Number(video.y || 0))}+${(vCropTop / 100).toFixed(5)}*h/${vCropH.toFixed(5)}`
          : `(H-h)/2+${Math.round(Number(video.y || 0))}`;
        graph.push(
          `[layer${layer - 1}]${label}overlay=x='${vBaseX}':y='${vBaseY}':enable='between(t,${Number(video.start || 0).toFixed(3)},${Number(video.end || info.duration).toFixed(3)})':eof_action=pass:shortest=0[layer${layer}]`,
        );
      }
    } else if (kind === "image") {
      for (const { image, label } of preparedImages.filter(
        (item) =>
          !item.image?._quickCutCaptionRaster &&
          (item.image.trackId === key || (!item.image.trackId && key === "image")),
      )) {
        layer += 1;
        const iCropTop = Math.max(0, Math.min(95, Number(image.cropTop || 0)));
        const iCropBottom = Math.max(0, Math.min(95, Number(image.cropBottom || 0)));
        const iCropLeft = Math.max(0, Math.min(95, Number(image.cropLeft || 0)));
        const iCropRight = Math.max(0, Math.min(95, Number(image.cropRight || 0)));
        const iCropW = Math.max(0.01, 1 - (iCropLeft + iCropRight) / 100);
        const iCropH = Math.max(0.01, 1 - (iCropTop + iCropBottom) / 100);
        const iBaseX = (iCropLeft > 0 || iCropRight > 0)
          ? `(W-w/${iCropW.toFixed(5)})/2+${Math.round(Number(image.x || 0))}+${(iCropLeft / 100).toFixed(5)}*w/${iCropW.toFixed(5)}`
          : `(W-w)/2+${Math.round(Number(image.x || 0))}`;
        const iBaseY = (iCropTop > 0 || iCropBottom > 0)
          ? `(H-h/${iCropH.toFixed(5)})/2+${Math.round(Number(image.y || 0))}+${(iCropTop / 100).toFixed(5)}*h/${iCropH.toFixed(5)}`
          : `(H-h)/2+${Math.round(Number(image.y || 0))}`;
        const imageX = animatedPosition(
          image,
          "x",
          iBaseX,
          220,
        );
        const imageY = animatedPosition(
          image,
          "y",
          iBaseY,
          220,
        );
        graph.push(
          `[layer${layer - 1}]${label}overlay=x='${imageX}':y='${imageY}':enable='between(t,${Number(image.start || 0).toFixed(3)},${Number(image.end || info.duration).toFixed(3)})':eof_action=pass:shortest=0[layer${layer}]`,
        );
      }
    } else if (kind === "text")
      addTextItems(
        (config.titles || []).filter(
          (item) => item.trackId === key || (!item.trackId && key === "text"),
        ),
      );
    else if (kind === "caption" && !captionRendered) {
      const rasters = preparedImages.filter((item) => item.image?._quickCutCaptionRaster);
      for (const { image, label } of rasters) {
        layer += 1;
        graph.push(
          `[layer${layer - 1}]${label}overlay=x='(W-w)/2+${Number(image.x || 0)}':y='(H-h)/2+${Number(image.y || 0)}':enable='between(t,${Number(image.start || 0).toFixed(3)},${Number(image.end || info.duration).toFixed(3)})':eof_action=pass:shortest=0[layer${layer}]`,
        );
      }
      if (rasters.length || config.captionRasterized) {
        captionRendered = true;
      } else if (config.captionAssPath) {
        layer += 1;
        const fontFile = resolveFontFile(config.captions?.[0]?.style || {});
        const fontsDir = fontFile
          ? path.dirname(fontFile)
          : path.join(supportRoot(), "fonts");
        graph.push(
          `[layer${layer - 1}]ass=filename='${escapeFilterPath(config.captionAssPath)}':original_size=${Math.round(width)}x${Math.round(height)}:fontsdir='${escapeFilterPath(fontsDir)}'[layer${layer}]`,
        );
        captionRendered = true;
      } else {
        addTextItems(config.captions || []);
        captionRendered = true;
      }
    }
  }
  for (const [trackId, label] of mainTrackLabels)
    if (!consumedMainTracks.has(trackId)) graph.push(`${label}nullsink`);
  let audioLabel =
    (info.audioCodec || hasDenoisedMainAudio) && config.includeAudio !== false ? "[joineda]" : null;
  if ((info.audioCodec || hasDenoisedMainAudio) && config.includeAudio === false)
    graph.push("[joineda]anullsink");
  if (audioLabel && mainOffset > 0.001) {
    graph.push(
      `${audioLabel}adelay=${Math.round(mainOffset * 1000)}:all=1[mainoffseta]`,
    );
    audioLabel = "[mainoffseta]";
  }
  const effectiveAudioConfig = hasDenoisedMainAudio
    ? { ...config, denoise: { ...(config.denoise || {}), strength: 0 } }
    : config;
  const master = audioLabel
    ? audioMasterFilter(
        { ...effectiveAudioConfig, audio: { ...(config.audio || {}), speed: 1, offset: 0 } },
        info,
      )
    : "";
  if (audioLabel && master) {
    graph.push(`${audioLabel}${master}[denoiseda]`);
    audioLabel = "[denoiseda]";
  }
  audioLabel = appendMainClipAudioFilters(graph, config, audioLabel);
  if (audioLabel && (config.audioMutes || []).length) {
    const muteFilters = config.audioMutes.map(
      (range) =>
        `volume=enable='between(t,${Number(range.start).toFixed(3)},${Number(range.end).toFixed(3)})':volume=0`,
    );
    graph.push(`${audioLabel}${muteFilters.join(",")}[outa]`);
    audioLabel = "[outa]";
  }
  audioLabel =
    config.includeAudio === false
      ? null
      : appendExternalAudio(graph, config, inputIndex, audioLabel);
  const videoLabel = `[layer${layer}]`;
  return { graph: graph.join(";"), videoLabel, audioLabel, width, height, fps };
}

function visualTransformIsDefault(value = {}) {
  return Math.abs(Number(value.x || 0)) < 0.001 &&
    Math.abs(Number(value.y || 0)) < 0.001 &&
    Math.abs(Number(value.scale || 1) - 1) < 0.001 &&
    Math.abs(Number(value.rotation || 0)) < 0.001 &&
    Math.abs(Number(value.opacity ?? 1) - 1) < 0.001 &&
    (value.blendMode || "normal") === "normal";
}

export function clipHasCustomVisual(settings = {}) {
  if (!visualTransformIsDefault(settings)) return true;
  return ["cropTop", "cropBottom", "cropLeft", "cropRight"].some(
    (key) => Math.abs(Number(settings[key] || 0)) > 0.01,
  );
}

export function mainClipsUseConcat(clips = []) {
  const list = [...(clips || [])].sort(
    (left, right) => Number(left.start || 0) - Number(right.start || 0),
  );
  if (!list.length) return false;
  const track = list[0].trackId || "video";
  for (let index = 0; index < list.length; index += 1) {
    const clip = list[index];
    if ((clip.trackId || "video") !== track) return false;
    if (clipHasCustomVisual(clip.settings || {})) return false;
    if (index > 0 && Number(clip.start || 0) < Number(list[index - 1].end || 0) - 0.02)
      return false;
  }
  return true;
}

function canSmartCopy(config, info, format) {
  const clips = config.mainVideoClips || [],
    clip = clips[0],
    sourceCodec = String(info.videoCodec || "").toLowerCase(),
    sourceIsWebSafe = /h264|avc|hevc|h265/.test(sourceCodec),
    codecMatches = (config.codec === "source" && (format === "mov" || sourceIsWebSafe)) || (config.codec === "hevc"
      ? /hevc|h265/.test(sourceCodec)
      : /h264|avc/.test(sourceCodec)),
    noColor = Object.values(config.color || {}).every(
      (value) => Math.abs(Number(value || 0)) < 0.001,
    ),
    noBeauty = Object.values(config.beauty || {}).every(
      (value) => Math.abs(Number(value || 0)) < 0.001,
    );
  return ["mp4", "mov"].includes(format) && codecMatches &&
    Number(config.width) === Number(info.displayWidth || info.width) &&
    Number(config.height) === Number(info.displayHeight || info.height) &&
    Math.abs(Number(config.fps || info.frameRate) - Number(info.frameRate || config.fps)) < 0.1 &&
    clips.length === 1 && Number(clip.start || 0) < 0.002 &&
    Math.abs(Number(clip.sourceStart || 0)) < 0.002 &&
    Math.abs(Number(clip.sourceEnd || info.duration) - Number(info.duration)) < 0.04 &&
    Math.abs(Number(config.outputDuration || info.duration) - Number(info.duration)) < 0.04 &&
    visualTransformIsDefault(config.videoTransform) &&
    visualTransformIsDefault(clip.settings) && noColor && noBeauty &&
    !(config.removals || []).length && !(config.audioMutes || []).length &&
    !(config.videoLayers || []).length && !(config.images || []).length &&
    !(config.titles || []).length && !(config.captions || []).length &&
    !(config.audioAssets || []).length && config.includeVideo !== false &&
    config.includeAudio !== false && !config.audioProcessingEnabled &&
    Number(config.denoise?.strength || 0) <= 0.01 &&
    !normalizeAudioFxRack(config.audioFxRack || []).some((effect) => effect.enabled) &&
    !(config.mainAudioClips || []).some((item) =>
      normalizeAudioFxRack(item.fxRack || []).some((effect) => effect.enabled),
    );
}

export function startExport(config) {
  if (!config?.inputPath || !fs.existsSync(config.inputPath))
    throw new Error("没有可导出的视频文件。");
  if (!config?.outputPath) throw new Error("请选择导出保存位置。");
  const info = probeMedia(config.inputPath);
  const id = crypto.randomUUID();
  const job = {
    id,
    state: "preparing",
    progress: 0.02,
    error: "",
    outputPath: config.outputPath,
    child: null,
    startedAt: Date.now(),
    stage: "prepare",
    frameProgress: false,
    message: "正在准备导出… · 已用 0:00",
  };
  jobs.set(id, job);
  const format = String(
    config.format || path.extname(config.outputPath).slice(1) || "mp4",
  ).toLowerCase();
  if (canSmartCopy(config, info, format)) job.mode = "smart-copy";
  setImmediate(() => {
    try {
      beginExportJob(config, info, job);
    } catch (error) {
      job.state = "failed";
      job.error = error?.message || String(error);
      job.message = job.error;
    }
  });
  return { jobId: id, mode: job.mode || "preparing" };
}

function beginExportJob(config, info, job) {
  job.stage = "prepare";
  job.message = exportStageMessage(job);
  const format = String(
    config.format || path.extname(config.outputPath).slice(1) || "mp4",
  ).toLowerCase();
  if (canSmartCopy(config, info, format)) {
    const args = [
      "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
      "-i", config.inputPath,
      "-map", "0:v:0", "-map", "0:a?", "-c", "copy",
      "-map_metadata", "0", "-movflags", "+faststart",
      "-t", String(Math.max(0.04, Number(config.outputDuration || info.duration))),
      "-stats_period", "0.2", "-progress", "pipe:1", "-nostats", config.outputPath,
    ];
    const child = spawn(mediaBinary("ffmpeg"), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid) {
      try { os.setPriority(child.pid, 5); } catch {}
    }
    job.child = child;
    job.state = "exporting";
    job.progress = Math.max(job.progress, 0.02);
    job.encoder = "copy";
    job.mode = "smart-copy";
    monitorExport(child, job, config, info);
    return;
  }
  job.stage = "captions";
  job.message = exportStageMessage(job);
  if (format !== "mp3" && (config.captions || []).length) {
    const alreadyRastered = !!(config.captionRasterized ||
      (config.images || []).some((image) => image?._quickCutCaptionRaster));
    if (alreadyRastered) config.captionRasterized = true;
    else {
      const rasterized = process.platform === "darwin" && prepareSharedCaptionRaster(config);
      if (!rasterized) config.captionAssPath = createAssSubtitleFile(config);
    }
    if (captionRasterItems(config).length >= 2) {
      job.message = "正在合并字幕叠层…";
      try {
        composeCaptionRasterConcat(config, info);
      } catch {
        /* keep individual rasters; movie/script path still works */
      }
    }
  }
  if (normalizeExportDevice(config.encoderDevice || config.device) !== "cpu")
    resetExportHardwareProbe();
  const hardware = detectExportHardware();
  const busyGpuApps = listBusyGpuApps();
  job.gpuBusy = busyGpuApps.length > 0;
  job.busyGpuApps = busyGpuApps;
  const hasDenoisedMainAudio = !!(config.mainAudioPath && fs.existsSync(config.mainAudioPath));
  const extraInputs = [];
  if (format === "mp3") {
    for (const audio of config.audioAssets || []) extraInputs.push("-i", audio.path);
    const mainSource = hasDenoisedMainAudio ? config.mainAudioPath : config.inputPath;
    const inputs = ["-i", mainSource, ...extraInputs];
    const built = buildAudioExportGraph(config, info, 1, 0);
    const args = [
      "-y",
      "-hide_banner",
      ...inputs,
      "-filter_complex",
      built.graph,
      "-map",
      built.audioLabel,
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-t",
      String(Math.max(0.04, Number(config.outputDuration || info.duration))),
      "-stats_period",
      "0.2",
      "-progress",
      "pipe:1",
      "-nostats",
      config.outputPath,
    ];
    const child = spawn(mediaBinary("ffmpeg"), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid) {
      try { os.setPriority(child.pid, 5); } catch {}
    }
    job.child = child;
    job.state = "exporting";
    job.progress = Math.max(job.progress, 0.02);
    monitorExport(child, job, config, info);
    return;
  }
  const preparedInputs = collectExportExtraInputs(config);
  config.captionRastersViaMovie = preparedInputs.captionRastersViaMovie;
  if (hasDenoisedMainAudio) {
    extraInputs.push("-i", config.mainAudioPath);
  }
  extraInputs.push(...preparedInputs.extraInputs);
  let built = buildExportGraph(config, info);
  const colorProfiles = {
      bt709: { space: "bt709", primaries: "bt709", transfer: "bt709", pixel: "yuv420p" },
      p3: { space: "bt709", primaries: "smpte432", transfer: "iec61966-2-1", pixel: "yuv420p" },
      bt2020: { space: "bt2020nc", primaries: "bt2020", transfer: "bt709", pixel: "yuv420p" },
      hlg: { space: "bt2020nc", primaries: "bt2020", transfer: "arib-std-b67", pixel: "p010le", hdr: true },
      pq: { space: "bt2020nc", primaries: "bt2020", transfer: "smpte2084", pixel: "p010le", hdr: true },
    },
    colorProfile = colorProfiles[config.colorSpace] || colorProfiles.bt709,
    useHevc = config.codec === "hevc" ||
      (config.codec === "source" && /hevc|h265/.test(String(info.videoCodec || "").toLowerCase())) ||
      colorProfile.hdr;
  const encoderDevice = normalizeExportDevice(config.encoderDevice || config.device);
  const fallbackEncoder = useHevc ? "libx265" : "libx264";
  let preferredEncoder = preferredVideoEncoder(useHevc, { device: encoderDevice });
  if (encoderDevice !== "cpu" && shouldSkipHardwareForBusyGpu(preferredEncoder, busyGpuApps)) {
    preferredEncoder = fallbackEncoder;
    job.stage = "retry";
    job.message = `检测到${busyGpuApps.join("、")}占用核显，改用 CPU 编码…`;
  }
  const encodeQueue = [preferredEncoder];
  if (encoderDevice !== "cpu" && preferredEncoder !== fallbackEncoder) encodeQueue.push(fallbackEncoder);
  const launch = (encoder, rest, decodeKind) => {
    const logical = Math.max(2, Number(os.cpus?.().length || 4));
    const budget = config.resourceBudget && typeof config.resourceBudget === "object" ? config.resourceBudget : {};
    const hardwareEncode = isHardwareEncoder(encoder);
    const workerThreads = Math.max(2, Math.min(6, Number(budget.workerThreads || Math.ceil(logical / 2))));
    const filterThreads = Math.max(
      1,
      Math.min(
        6,
        Number(
          budget.filterThreads ||
            (hardwareEncode ? Math.ceil(logical / 2) : isDarwin ? 4 : 2),
        ),
      ),
    );
    const decodeKindNow =
      decodeKind === undefined
        ? preferredExportDecodeKind(encoder, hardware.decode)
        : decodeKind === "none"
          ? ""
          : decodeKind;
    const inputs = [...decodeAccelArgs(decodeKindNow), "-i", config.inputPath, ...extraInputs];
    const args = [
      "-y",
      "-hide_banner",
      "-threads", String(workerThreads),
      "-filter_threads", String(filterThreads),
      "-filter_complex_threads", String(filterThreads),
      ...inputs,
      "-filter_complex",
      built.graph,
      "-map",
      built.videoLabel,
    ];
    if (built.audioLabel) args.push("-map", built.audioLabel);
    args.push("-r", String(built.fps));
    args.push(
      ...videoEncodeArgs(encoder, {
        bitrate: config.bitrate || (config.quality === "high" ? "20M" : "12M"),
        fps: built.fps,
        qualityMode: config.qualityMode,
        quality: config.quality,
        hdr: colorProfile.hdr,
        gpuBusy: !!job.gpuBusy,
      }),
    );
    args.push(
      "-pix_fmt",
      colorProfile.pixel,
      "-colorspace",
      colorProfile.space,
      "-color_primaries",
      colorProfile.primaries,
      "-color_trc",
      colorProfile.transfer,
    );
    if (built.audioLabel) args.push("-c:a", "aac", "-b:a", "192k");
    args.push(
      "-t",
      String(Math.max(0.04, Number(config.outputDuration || info.duration))),
      "-movflags",
      "+faststart",
      "-loglevel",
      "error",
      "-stats_period",
      "0.2",
      "-progress",
      "pipe:1",
      "-nostats",
      config.outputPath,
    );
    const packed = compactFfmpegFilterArgs(args, {
      binary: mediaBinary("ffmpeg"),
      directory: config.captionRasterDirectory || path.join(supportRoot(), "temp"),
      rasterCount: captionRasterItems(config).length,
      force: !!config.forceFilterComplexScript,
    });
    if (packed.scriptPath) config.filterComplexScriptPath = packed.scriptPath;
    const child = spawn(mediaBinary("ffmpeg"), packed.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid) {
      try { os.setPriority(child.pid, 5); } catch {}
    }
    job.child = child;
    job.state = "exporting";
    job.progress = Math.max(job.progress, 0.02);
    job.encoder = encoder;
    job.vendor = hardware.vendor;
    job.mode = hardwareEncode ? "hardware-quality" : "software-fallback";
    job.stage = "encoding";
    job.encoderLabel = encoderDisplayName(encoder);
    job.decodeKind = decodeKindNow || "none";
    const retry = (reason = "") => {
      job.progress = 0.015;
      job.error = "";
      job.stallRetried = false;
      job.lastProgressAt = Date.now();
      if (String(reason).includes("ENAMETOOLONG") && !config.spawnLengthRetried) {
        config.spawnLengthRetried = true;
        config.captionRastersViaMovie = true;
        config.forceFilterComplexScript = true;
        extraInputs.length = 0;
        extraInputs.push(...collectExportExtraInputs(config).extraInputs);
        built = buildExportGraph(config, info);
        launch(encoder, rest, decodeKind);
        return;
      }
      if (decodeKindNow && decodeKindNow !== "none") {
        launch(encoder, rest, decodeKindNow === "cuda" ? "d3d11va" : "none");
        return;
      }
      if (rest.length) {
        launch(rest[0], rest.slice(1), rest[0] === fallbackEncoder ? "none" : undefined);
      }
    };
    monitorExport(
      child,
      job,
      config,
      info,
      (decodeKindNow && decodeKindNow !== "none") || rest.length ? retry : null,
    );
  };
  launch(encodeQueue[0], encodeQueue.slice(1));
}

function clockToSeconds(match) {
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function parseFfmpegProgress(text, options = {}) {
  const duration = Math.max(0.1, Number(options.duration || 0));
  const fps = Math.max(1, Number(options.fps || 30));
  const source = String(text || "");
  const us = [...source.matchAll(/^out_time_us=(\d+)/gm)].pop();
  const clock = [...source.matchAll(/^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/gm)].pop();
  const ms = [...source.matchAll(/^out_time_ms=(\d+)/gm)].pop();
  const frame = [...source.matchAll(/^frame=(\d+)/gm)].pop();
  const speed = [...source.matchAll(/^speed=\s*([0-9.]+)x/gm)].pop();
  let seconds = 0;
  if (us) seconds = Number(us[1]) / 1e6;
  else if (clock) seconds = clockToSeconds(clock);
  else if (ms) {
    const value = Number(ms[1]);
    seconds = value > duration * 10_000 ? value / 1e6 : value / 1e3;
  } else if (frame) seconds = Number(frame[1]) / fps;
  return {
    seconds: Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
    ended: /^progress=end$/m.test(source),
    speed: speed ? Number(speed[1]) : 0,
  };
}

export function formatExportClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function refreshExportJob(job) {
  if (!job || ["completed", "failed", "cancelled"].includes(job.state)) {
    if (job) job.message = exportStageMessage(job);
    return job;
  }
  if (!job.startedAt) job.startedAt = Date.now();
  const elapsed = (Date.now() - job.startedAt) / 1000;
  if (!job.frameProgress) {
    const soft = Math.min(0.16, 0.02 + elapsed / 36);
    job.progress = Math.max(Number(job.progress || 0.02), soft);
  }
  job.message = exportStageMessage(job);
  return job;
}

function exportStageMessage(job) {
  const elapsed = Math.max(0, (Date.now() - (job.startedAt || Date.now())) / 1000);
  const percent = Math.round((job.progress || 0) * 100);
  const label = job.encoderLabel || encoderDisplayName(job.encoder || "");
  const used = formatExportClock(elapsed);
  if (job.state === "completed") return label ? `✅ 导出完成 · ${label} · 共用时 ${used}` : `✅ 导出完成 · 共用时 ${used}`;
  if (job.state === "failed") return job.error || "视频导出失败。";
  if (job.state === "cancelled") return "已取消导出";
  if (job.stage === "retry") {
    return `⚠️ 显卡编码无响应，已自动转为 CPU 软件编码… · 已用 ${used}`;
  }
  if (job.stage === "prepare" || job.stage === "captions" || job.state === "preparing")
    return `正在准备导出（字幕/滤镜/硬件加速）… · 已用 ${used}`;
  if (job.stage === "muxing" || (job.progress >= 0.98 && job.state === "exporting"))
    return `正在封装文件… ${percent}% · ${label} · 已用 ${used}`;
  if (!job.frameProgress) {
    const hardware = isHardwareEncoder(job.encoder);
    if (elapsed >= 8) {
      return hardware
        ? `正在启动显卡编码器… ${percent}% · ${label} · 已用 ${used}`
        : `正在启动 CPU 编码器… ${percent}% · ${label} · 已用 ${used}`;
    }
    return `正在启动编码器… ${percent}% · ${label} · 已用 ${used}`;
  }
  if (job.speed > 0)
    return `正在导出 ${percent}% · ${label} · ${job.speed.toFixed(1)}x 实时倍速 · 已用 ${used}`;
  return `正在导出 ${percent}% · ${label} · 已用 ${used}`;
}

export function cleanFfmpegErrorMessage(rawStderr) {
  if (!rawStderr || typeof rawStderr !== "string") return "视频导出失败。";
  const lines = rawStderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(
      (l) =>
        !/^(frame|fps|stream_\d+_\d+|bitrate|total_size|out_time(_us|_ms)?|dup_frames|drop_frames|speed|progress)=/i.test(
          l,
        ),
    )
    .filter(
      (l) =>
        !/^ffmpeg version|^built with|^configuration:|^lib(av|sw|postproc)/i.test(
          l,
        ),
    );

  if (!lines.length) return "视频导出失败。";

  const errorLines = lines.filter((l) =>
    /(\[error\]|\[fatal\]|error|failed|invalid|cannot|unable|no such|denied|broken pipe|exceeded|out of memory|encoder.*error|conversion failed)/i.test(
      l,
    ),
  );

  const selected = errorLines.length ? errorLines : lines.slice(-4);
  return selected.slice(-4).join("\n");
}

function monitorExport(child, job, config, info, retry = null) {
  let stderr = "", progressBuffer = "";
  const token = {};
  job.monitorToken = token;
  job.startedAt = job.startedAt || Date.now();
  job.lastProgressAt = Date.now();
  job.speed = 0;
  job.retryLock = false;
  job.encoderLabel = encoderDisplayName(job.encoder || "");
  const duration = Math.max(0.1, Number(config.outputDuration || info.duration || 0));
  const fps = Math.max(1, Number(config.fps || info.frameRate || 30));
  const abandoned = () => job.monitorToken !== token;
  const requestRetry = (reason = "") => {
    if (abandoned() || job.retryLock || !retry) return false;
    job.retryLock = true;
    job.state = "preparing";
    job.stage = "retry";
    job.frameProgress = false;
    job.message = exportStageMessage(job);
    retry(reason);
    return true;
  };
  refreshExportJob(job);
  const stallWatch = setInterval(() => {
    if (abandoned() || ["completed", "failed", "cancelled"].includes(job.state) || job.frameProgress) {
      clearInterval(stallWatch);
      return;
    }
    if (!exportIsStalled(job) || job.stallRetried) return;
    job.stallRetried = true;
    if (retry) {
      job.stage = "retry";
      job.message = exportStageMessage(job);
      forceKillProcess(child);
      setTimeout(() => requestRetry("stall"), 1200);
    } else {
      job.state = "failed";
      job.error = encoderStallMessage(job);
      job.message = job.error;
      forceKillProcess(child);
    }
    clearInterval(stallWatch);
  }, 500);
  child.stdout?.on("data", (chunk) => {
    if (abandoned()) return;
    const text = chunk.toString();
    progressBuffer = (progressBuffer + text).slice(-8000);
    const parsed = parseFfmpegProgress(progressBuffer, { duration, fps });
    if (parsed.seconds > 0) {
      job.frameProgress = true;
      job.progress = Math.max(
        job.progress || 0,
        Math.min(parsed.ended ? 0.99 : 0.98, parsed.seconds / duration),
      );
      job.lastProgressAt = Date.now();
      job.stage = parsed.ended ? "muxing" : "encoding";
    }
    if (parsed.speed > 0) job.speed = parsed.speed;
    if (parsed.ended) job.stage = "muxing";
    refreshExportJob(job);
    const lastNewline = progressBuffer.lastIndexOf("\n");
    if (lastNewline > 0) progressBuffer = progressBuffer.slice(lastNewline + 1);
  });
  child.stderr?.on("data", (chunk) => {
    if (abandoned()) return;
    const text = chunk.toString();
    stderr = (stderr + text).slice(-16000);
    if (!job.frameProgress || /progress=/i.test(text)) {
      const parsed = parseFfmpegProgress(text, { duration, fps });
      if (parsed.seconds > 0) {
        job.frameProgress = true;
        job.progress = Math.max(
          job.progress || 0,
          Math.min(parsed.ended ? 0.99 : 0.98, parsed.seconds / duration),
        );
        job.lastProgressAt = Date.now();
      }
      if (parsed.speed > 0) job.speed = parsed.speed;
      if (parsed.ended) job.stage = "muxing";
      refreshExportJob(job);
    }
  });
  child.on("error", (error) => {
    if (abandoned()) return;
    if (isSpawnTooLongError(error) && retry && !config.spawnLengthRetried) {
      job.state = "preparing";
      job.stage = "retry";
      job.message = "导出命令太长，正在改用字幕脚本重试…";
      requestRetry("ENAMETOOLONG");
      return;
    }
    job.state = "failed";
    job.error = isSpawnTooLongError(error)
      ? "导出命令太长，显卡通道无法启动。请再导一次，或改勾 CPU。"
      : error.message;
    job.message = job.error;
  });
  child.on("close", (code) => {
    clearInterval(stallWatch);
    if (abandoned()) return;
    if (job.child === child) job.child = null;
    if (job.state === "cancelled") {
      if (config.captionAssPath)
        try {
          fs.unlinkSync(config.captionAssPath);
        } catch {
          /* temporary subtitle file */
        }
      return;
    }
    if (code === 0 && fs.existsSync(config.outputPath)) {
      job.state = "completed";
      job.progress = 1;
      job.stage = "done";
      job.message = exportStageMessage(job);
    } else if (job.state === "failed") {
      job.message = job.error || job.message;
    } else if (retry) {
      requestRetry(stderr);
      return;
    } else {
      job.state = "failed";
      job.error = cleanFfmpegErrorMessage(stderr);
      job.message = job.error;
    }
    if (config.captionAssPath)
      try {
        fs.unlinkSync(config.captionAssPath);
      } catch {
        /* temporary subtitle file */
      }
  });
}

export function exportStatus(jobId) {
  const job = jobs.get(String(jobId || ""));
  if (!job) throw new Error("导出任务已经不存在。");
  refreshExportJob(job);
  return {
    jobId: job.id,
    state: job.state,
    progress: job.progress,
    error: job.error,
    outputPath: job.outputPath,
    encoder: job.encoder || "",
    vendor: job.vendor || "",
    mode: job.mode || "",
    stage: job.stage || "",
    speed: job.speed || 0,
    elapsed: job.startedAt ? (Date.now() - job.startedAt) / 1000 : 0,
    encoderLabel: job.encoderLabel || encoderDisplayName(job.encoder || ""),
    message: job.message || "",
  };
}

export function cancelExport(jobId) {
  const job = jobs.get(String(jobId || ""));
  if (!job || ["completed", "failed", "cancelled"].includes(job.state))
    return false;
  job.state = "cancelled";
  forceKillProcess(job.child);
  return true;
}
