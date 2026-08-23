import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync, execSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  defaultSupportRoot,
  fallbackFontFiles,
  fontSearchRoots,
  isDarwin,
  isWindows,
  mediaSearchRoots,
  pathHasBinary,
  whichBinary,
} from "../platform.mjs";

const execFileAsync = promisify(execFile);
const statAsync = promisify(fs.stat);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

let encoderCatalog = null;
let audioFilterCatalog = null;

export function hasAudioFilter(name) {
  if (!audioFilterCatalog) {
    const result = spawnSync(mediaBinary("ffmpeg"), ["-hide_banner", "-filters"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 8 * 1024 * 1024,
    });
    audioFilterCatalog = String(result.stdout || result.stderr || "");
  }
  const safeName = String(name).replace(/[^a-z0-9_]/gi, "");
  return new RegExp(`\\b${safeName}\\b`, "i").test(audioFilterCatalog);
}

export function escapeDrawtext(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

export function escapeFilterPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

export function supportRoot() {
  const overridden = process.env.QUICKCUT_SUPPORT_ROOT;
  const root = overridden || defaultSupportRoot();
  const legacy = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "SubtitleProofreaderEditor",
  );
  if (!overridden && !fs.existsSync(root) && fs.existsSync(legacy)) {
    try {
      fs.cpSync(legacy, root, { recursive: true });
    } catch {
      /* legacy data remains untouched */
    }
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function usableBinary(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  if (isWindows) return filePath;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return filePath;
  } catch {
    try {
      fs.chmodSync(filePath, 0o755);
      fs.accessSync(filePath, fs.constants.X_OK);
      return filePath;
    } catch {
      return "";
    }
  }
}

export function mediaBinary(name) {
  const overriddenRoot = process.env.QUICKCUT_MEDIA_ROOT;
  const overridden = pathHasBinary(overriddenRoot, name);
  if (overridden) return overridden;
  const bundledDir = path.resolve(moduleDir, "../../../media");
  const bundled = usableBinary(pathHasBinary(bundledDir, name));
  if (bundled) return bundled;
  const fromPath = whichBinary(name);
  if (fromPath) return fromPath;
  for (const directory of mediaSearchRoots()) {
    const found = pathHasBinary(directory, name);
    if (found) return found;
  }
  throw new Error(
    isWindows
      ? `缺少视频处理组件：${name}。请安装 FFmpeg 并加入 PATH，或把它放到媒体目录。`
      : `缺少视频处理组件：${name}`,
  );
}

let hwaccelCatalog = null;
let hardwareProbe = null;

function availableEncoders() {
  if (encoderCatalog) return encoderCatalog;
  encoderCatalog = new Set();
  try {
    const result = spawnSync(mediaBinary("ffmpeg"), ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    const text = `${result.stdout || ""}\n${result.stderr || ""}`;
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*[A-Z.]+\s+([a-z0-9_]+)\s+/i);
      if (match) encoderCatalog.add(match[1]);
    }
  } catch {
    encoderCatalog = new Set();
  }
  return encoderCatalog;
}

function availableHwaccels() {
  if (hwaccelCatalog) return hwaccelCatalog;
  hwaccelCatalog = new Set();
  try {
    const result = spawnSync(mediaBinary("ffmpeg"), ["-hide_banner", "-hwaccels"], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    const text = `${result.stdout || ""}\n${result.stderr || ""}`;
    for (const line of text.split(/\r?\n/)) {
      const name = line.trim().toLowerCase();
      if (name && !/hardware acceleration/i.test(name) && /^[a-z0-9]+$/.test(name))
        hwaccelCatalog.add(name);
    }
  } catch {
    hwaccelCatalog = new Set();
  }
  return hwaccelCatalog;
}

function probeVideoEncoder(encoder, extra = []) {
  if (!availableEncoders().has(encoder)) return false;
  const output = path.join(
    os.tmpdir(),
    `quickcut-enc-${process.pid}-${encoder}-${crypto.randomUUID().slice(0, 8)}.mp4`,
  );
  try {
    const result = spawnSync(
      mediaBinary("ffmpeg"),
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=128x72:d=0.08:r=24",
        "-frames:v",
        "2",
        "-c:v",
        encoder,
        ...extra,
        "-an",
        output,
      ],
      { encoding: "utf8", timeout: 4000, windowsHide: true },
    );
    return result.status === 0 && fs.existsSync(output) && fs.statSync(output).size > 32;
  } catch {
    return false;
  } finally {
    try {
      fs.unlinkSync(output);
    } catch {
      /* probe file */
    }
  }
}

export function resetExportHardwareProbe() {
  hardwareProbe = null;
  encoderCatalog = null;
  hwaccelCatalog = null;
}

export function detectExportHardware() {
  if (hardwareProbe) return hardwareProbe;
  if (isDarwin) {
    hardwareProbe = {
      vendor: "apple",
      h264: "h264_videotoolbox",
      hevc: "hevc_videotoolbox",
      decode: "videotoolbox",
      nvencPreset: "",
      label: "Apple 硬件加速",
    };
    return hardwareProbe;
  }
  const encoders = availableEncoders();
  const hwaccels = availableHwaccels();
  if (
    encoders.has("h264_nvenc") &&
    (probeVideoEncoder("h264_nvenc", ["-preset", "p5", "-pix_fmt", "yuv420p"]) ||
      probeVideoEncoder("h264_nvenc", ["-preset", "medium", "-pix_fmt", "yuv420p"]))
  ) {
    hardwareProbe = {
      vendor: "nvidia",
      h264: "h264_nvenc",
      hevc: encoders.has("hevc_nvenc") ? "hevc_nvenc" : "libx265",
      decode: hwaccels.has("cuda") ? "cuda" : hwaccels.has("d3d11va") ? "d3d11va" : "",
      nvencPreset: "p4",
      label: "NVIDIA 显卡加速",
    };
    return hardwareProbe;
  }
  if (
    encoders.has("h264_qsv") &&
    (probeVideoEncoder("h264_qsv", ["-preset", "medium", "-pix_fmt", "nv12"]) ||
      probeVideoEncoder("h264_qsv", ["-pix_fmt", "nv12"]))
  ) {
    hardwareProbe = {
      vendor: "intel",
      h264: "h264_qsv",
      hevc: encoders.has("hevc_qsv") ? "hevc_qsv" : "libx265",
      decode: hwaccels.has("qsv") ? "qsv" : hwaccels.has("d3d11va") ? "d3d11va" : "",
      nvencPreset: "",
      label: "Intel 核显加速",
    };
    return hardwareProbe;
  }
  if (
    encoders.has("h264_amf") &&
    probeVideoEncoder("h264_amf", ["-quality", "speed", "-pix_fmt", "yuv420p"])
  ) {
    hardwareProbe = {
      vendor: "amd",
      h264: "h264_amf",
      hevc: encoders.has("hevc_amf") ? "hevc_amf" : "libx265",
      decode: hwaccels.has("d3d11va") ? "d3d11va" : "",
      nvencPreset: "",
      label: "AMD 显卡加速",
    };
    return hardwareProbe;
  }
  hardwareProbe = {
    vendor: "software",
    h264: "libx264",
    hevc: "libx265",
    decode: hwaccels.has("d3d11va") ? "d3d11va" : "",
    nvencPreset: "",
    label: "软件编码",
  };
  return hardwareProbe;
}

export function normalizeExportDevice(value) {
  return String(value || "").trim().toLowerCase() === "cpu" ? "cpu" : "gpu";
}

export function preferredVideoEncoder(useHevc, options = {}) {
  if (normalizeExportDevice(options.device || options.encoderDevice) === "cpu")
    return useHevc ? "libx265" : "libx264";
  const hardware = detectExportHardware();
  return useHevc ? hardware.hevc : hardware.h264;
}

export function encoderDisplayName(encoder = "") {
  if (/nvenc/.test(encoder)) return "🚀 NVIDIA NVENC 显卡加速";
  if (/qsv/.test(encoder)) return "🚀 Intel QSV 显卡加速";
  if (/amf/.test(encoder)) return "🚀 AMD AMF 显卡加速";
  if (/videotoolbox/.test(encoder)) return "🚀 Apple 硬件加速";
  if (encoder === "copy") return "⚡ 原码流直出";
  if (encoder.startsWith("libx")) return "⚙️ CPU 软件编码";
  return encoder || "编码器";
}

export const EXPORT_ENCODE_STALL_MS = 15_000;
export const EXPORT_SOFTWARE_STALL_MS = 90_000;
export const EXPORT_BUSY_GPU_STALL_MS = 8_000;
const BUSY_GPU_PROCESS_LABELS = [
  ["resolve.exe", "达芬奇"],
  ["davinci resolve.exe", "达芬奇"],
  ["adobe premiere pro.exe", "Premiere"],
  ["premiere pro.exe", "Premiere"],
  ["afterfx.exe", "After Effects"],
  ["adobe media encoder.exe", "Media Encoder"],
];

export function isHardwareEncoder(encoder = "") {
  return /videotoolbox|nvenc|amf|qsv|_mf$/.test(String(encoder || ""));
}

export function listBusyGpuApps() {
  if (!isWindows) return [];
  try {
    const result = spawnSync("tasklist", ["/FO", "CSV", "/NH"], {
      encoding: "utf8",
      timeout: 4000,
      windowsHide: true,
    });
    const text = `${result.stdout || ""}`.toLowerCase();
    const found = [];
    for (const [exe, label] of BUSY_GPU_PROCESS_LABELS) {
      if (text.includes(exe) && !found.includes(label)) found.push(label);
    }
    return found;
  } catch {
    return [];
  }
}

export function shouldSkipHardwareForBusyGpu(encoder, busyApps = []) {
  // Respect user GPU choice: Never pre-emptively downgrade to CPU just because other video apps are open
  return false;
}

export function exportStallLimit(job = {}) {
  if (isHardwareEncoder(job.encoder))
    return job.gpuBusy ? EXPORT_BUSY_GPU_STALL_MS : EXPORT_ENCODE_STALL_MS;
  if (String(job.encoder || "").startsWith("libx") || job.encoder === "copy")
    return EXPORT_SOFTWARE_STALL_MS;
  return EXPORT_ENCODE_STALL_MS;
}

export function encoderStallMessage(job = {}) {
  if (isHardwareEncoder(job.encoder))
    return "编码器长时间没有输出画面。正在自动尝试切换为 CPU 软件编码…";
  return "编码器长时间没有输出画面。请检查素材是否能打开，或先关掉占满 CPU 的软件后重试。";
}

export function forceKillProcess(child) {
  if (!child) return;
  try {
    child.kill();
  } catch {
    /* already stopped */
  }
  const pid = Number(child.pid || 0);
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 4000,
      });
    } catch {
      /* process already gone */
    }
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* already stopped */
  }
}

export function preferredExportDecodeKind(encoder, hardwareDecode = "") {
  const hardwareEncode = isHardwareEncoder(encoder);
  if (!hardwareEncode) return "";
  // CUDA/QSV/D3D11 decode + CPU filter_complex (captions, color, scale)
  // often sits on frame 0. GPU encode still runs; only skip GPU decode.
  if (/videotoolbox/.test(String(encoder || "")) && hardwareDecode === "videotoolbox")
    return "videotoolbox";
  return "";
}

export function exportIsStalled(job, now = Date.now(), limit) {
  if (!job || job.frameProgress) return false;
  if (!["exporting", "preparing"].includes(String(job.state || ""))) return false;
  const last = Number(job.lastProgressAt || job.startedAt || now);
  const wait = Number(limit > 0 ? limit : exportStallLimit(job));
  return now - last >= wait;
}

export function decodeAccelArgs(kind) {
  if (kind === "videotoolbox") return ["-hwaccel", "videotoolbox"];
  if (kind === "cuda") return ["-hwaccel", "cuda", "-hwaccel_output_format", "nv12"];
  if (kind === "qsv") return ["-hwaccel", "qsv", "-hwaccel_output_format", "nv12"];
  if (kind === "d3d11va") return ["-hwaccel", "d3d11va"];
  return [];
}

function parseMbps(value, fallback = 12) {
  const raw = String(value || "").trim();
  const amount = Number.parseFloat(raw);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;
  if (/k$/i.test(raw)) return amount / 1000;
  if (/m$/i.test(raw)) return amount;
  return amount > 200 ? amount / 1000 : amount;
}

export function videoEncodeArgs(encoder, options = {}) {
  const fps = Math.max(1, Number(options.fps || 30));
  const mbps = parseMbps(options.bitrate, options.quality === "high" ? 20 : 12);
  const qualityMode = String(options.qualityMode || "balanced");
  const hdr = !!options.hdr;
  const args = [
    "-c:v",
    encoder,
    "-b:v",
    `${mbps}M`,
    "-maxrate",
    `${Math.ceil(mbps * 1.32)}M`,
    "-bufsize",
    `${Math.ceil(mbps * 2)}M`,
    "-g",
    String(Math.max(24, Math.round(fps * 2))),
  ];
  if (encoder === "h264_videotoolbox")
    args.push("-profile:v", "high", "-realtime", "true");
  if (encoder === "hevc_videotoolbox")
    args.push("-profile:v", hdr ? "main10" : "main", "-tag:v", "hvc1", "-realtime", "true");
  if (encoder === "h264_nvenc" || encoder === "hevc_nvenc") {
    const preset = qualityMode === "fast" ? "p7" : qualityMode === "maximum" ? "p3" : "p5";
    const lookahead = options.gpuBusy || qualityMode === "fast" ? 0 : qualityMode === "maximum" ? 20 : 8;
    args.push("-preset", preset, "-rc", "vbr", "-gpu", "0", "-rc-lookahead", String(lookahead));
    if (encoder === "hevc_nvenc")
      args.push("-profile:v", hdr ? "main10" : "main", "-tag:v", "hvc1");
    else args.push("-profile:v", "high");
  }
  if (encoder === "h264_amf" || encoder === "hevc_amf") {
    args.push(
      "-quality",
      qualityMode === "fast" ? "speed" : qualityMode === "maximum" ? "quality" : "balanced",
      "-rc",
      "vbr_peak",
    );
    if (encoder === "hevc_amf") args.push("-tag:v", "hvc1");
  }
  if (encoder === "h264_qsv" || encoder === "hevc_qsv") {
    args.push("-preset", qualityMode === "fast" ? "veryfast" : qualityMode === "maximum" ? "slow" : "medium");
    if (options.gpuBusy) args.push("-async_depth", "1");
    if (encoder === "hevc_qsv")
      args.push("-profile:v", hdr ? "main10" : "main", "-tag:v", "hvc1");
  }
  if (encoder.startsWith("libx"))
    args.push("-preset", qualityMode === "fast" ? "veryfast" : qualityMode === "maximum" ? "medium" : "fast");
  return args;
}

export function run(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { lowPriority = false, ...spawnOptions } = options;
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOptions,
    });
    if (lowPriority && child.pid)
      try {
        os.setPriority(child.pid, 12);
      } catch {}
    const stdout = [];
    let stderr = "";
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-12000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(stdout))
        : reject(new Error(stderr.trim() || `媒体处理失败（${code}）`)),
    );
  });
}

const probeArguments = (inputPath) => [
  "-v",
  "error",
  // The bundled ffprobe is intentionally compatible with older macOS
  // releases.  `-show_streams/-show_format` exposes rotation side data on
  // both old and new ffprobe builds; the narrower `stream_side_data` section
  // selector is rejected by some versions before export can even start.
  "-show_streams",
  "-show_format",
  "-of",
  "json",
  inputPath,
];

function parseAspect(value, fallback = 0) {
  const text = String(value || "").trim();
  if (!text || text === "N/A" || text === "0/1") return fallback;
  const parts = text.split("/").map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return parts[0] / parts[1];
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function sourceGeometry(info = {}, fallback = {}) {
  const encodedWidth = Math.max(2, Number(info.width || fallback.width || 1080));
  const encodedHeight = Math.max(2, Number(info.height || fallback.height || 1920));
  const rotation = Number(info.rotation || 0);
  const quarterTurn = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const displayWidth = Math.max(
    2,
    Math.round(Number(info.displayWidth || (quarterTurn ? encodedHeight : encodedWidth))),
  );
  const displayHeight = Math.max(
    2,
    Math.round(Number(info.displayHeight || (quarterTurn ? encodedWidth : encodedHeight))),
  );
  return { encodedWidth, encodedHeight, displayWidth, displayHeight, rotation };
}

export function sourceOrientationFilters(info = {}, fallback = {}) {
  const geo = sourceGeometry(info, fallback);
  return {
    ...geo,
    filters: [
      `scale=${geo.displayWidth}:${geo.displayHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos+accurate_rnd`,
      `pad=${geo.displayWidth}:${geo.displayHeight}:(ow-iw)/2:(oh-ih)/2:black`,
      "setsar=1",
    ],
  };
}

function parsedMediaInfo(inputPath, data) {
  const video =
    data.streams?.find((stream) => stream.codec_type === "video") || {};
  const audio =
    data.streams?.find((stream) => stream.codec_type === "audio") || {};
  const frameRateParts = String(video.r_frame_rate || "0/1")
    .split("/")
    .map(Number);
  const frameRate =
    frameRateParts.length === 2 && frameRateParts[1]
      ? frameRateParts[0] / frameRateParts[1]
      : Number(frameRateParts[0] || 0);
  const rawRotation = Number(
      video.side_data_list?.find((item) => Number.isFinite(Number(item.rotation)))?.rotation ??
      video.tags?.rotate ?? 0,
    ),
    rotation = Number.isFinite(rawRotation) ? rawRotation : 0,
    quarterTurn = Math.abs(Math.round(rotation / 90)) % 2 === 1,
    encodedWidth = Number(video.width || 0),
    encodedHeight = Number(video.height || 0),
    sar = parseAspect(video.sample_aspect_ratio, 1);
  let displayWidth = Math.abs(sar - 1) > 0.01 ? Math.round(encodedWidth * sar) : encodedWidth;
  let displayHeight = encodedHeight;
  if (quarterTurn) {
    const swapped = displayWidth;
    displayWidth = displayHeight;
    displayHeight = swapped;
  }
  return {
    path: inputPath,
    name: path.basename(inputPath),
    duration: Number(data.format?.duration || 0),
    size: Number(data.format?.size || fs.statSync(inputPath).size),
    width: encodedWidth,
    height: encodedHeight,
    displayWidth,
    displayHeight,
    rotation,
    videoCodec: video.codec_name || "",
    audioCodec: audio.codec_name || "",
    sampleRate: Number(audio.sample_rate || 0),
    channels: Number(audio.channels || 0),
    frameRate: Number.isFinite(frameRate) ? frameRate : 0,
  };
}

export function probeMedia(inputPath) {
  if (!fs.existsSync(inputPath)) throw new Error("素材文件已经不存在。");
  const result = spawnSync(mediaBinary("ffprobe"), probeArguments(inputPath), {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || "无法读取素材信息。");
  return parsedMediaInfo(inputPath, JSON.parse(result.stdout));
}

export async function probeMediaAsync(inputPath) {
  if (!fs.existsSync(inputPath)) throw new Error("素材文件已经不存在。");
  const result = await run(mediaBinary("ffprobe"), probeArguments(inputPath));
  return parsedMediaInfo(inputPath, JSON.parse(result.toString("utf8")));
}

function mediaPreviewPath(inputPath, kind = "video") {
  if (
    !inputPath ||
    !fs.existsSync(inputPath) ||
    !["video", "audio"].includes(kind)
  )
    return "";
  const stat = fs.statSync(inputPath);
  const key = crypto
    .createHash("sha256")
    .update(`${inputPath}:${stat.size}:${stat.mtimeMs}:${kind}`)
    .digest("hex")
    .slice(0, 20);
  const directory = path.join(supportRoot(), "previews", "media");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return path.join(directory, `${key}.png`);
}

export function cachedMediaPreview(inputPath, kind = "video") {
  const outputPath = mediaPreviewPath(inputPath, kind);
  return outputPath &&
    fs.existsSync(outputPath) &&
    fs.statSync(outputPath).size > 100
    ? outputPath
    : null;
}

export function createMediaPreview(inputPath, kind = "video") {
  const outputPath = mediaPreviewPath(inputPath, kind);
  if (!outputPath) return null;
  const cached = cachedMediaPreview(inputPath, kind);
  if (cached) return cached;
  const audioArgs = [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          inputPath,
          "-filter_complex",
          "aformat=channel_layouts=mono,showwavespic=s=240x135:colors=0x4fc9a0:scale=sqrt,format=rgba",
          "-frames:v",
          "1",
          outputPath,
        ];
  const videoArgs = (seek) => [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(seek),
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-an",
    "-frames:v",
    "1",
    "-vf",
    "scale=240:135:force_original_aspect_ratio=decrease,pad=240:135:(ow-iw)/2:(oh-ih)/2:color=0x111315",
    outputPath,
  ];
  const attempts = kind === "video" ? [videoArgs(0.2), videoArgs(0)] : [audioArgs];
  let created = false;
  for (const args of attempts) {
    try {
      fs.unlinkSync(outputPath);
    } catch {}
    const result = spawnSync(mediaBinary("ffmpeg"), args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (
      result.status === 0 &&
      fs.existsSync(outputPath) &&
      fs.statSync(outputPath).size > 100
    ) {
      created = true;
      break;
    }
  }
  if (!created) return null;
  return outputPath;
}

export async function createMediaPreviewAsync(inputPath, kind = "video") {
  const outputPath = mediaPreviewPath(inputPath, kind);
  if (!outputPath) return null;
  const cached = cachedMediaPreview(inputPath, kind);
  if (cached) return cached;
  const audioArgs = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-filter_complex",
    "aformat=channel_layouts=mono,showwavespic=s=240x135:colors=0x4fc9a0:scale=sqrt,format=rgba",
    "-frames:v",
    "1",
    outputPath,
  ];
  const videoArgs = (seek) => [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(seek),
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-an",
    "-frames:v",
    "1",
    "-vf",
    "scale=240:135:force_original_aspect_ratio=decrease,pad=240:135:(ow-iw)/2:(oh-ih)/2:color=0x111315",
    outputPath,
  ];
  const attempts =
    kind === "video" ? [videoArgs(0.2), videoArgs(0)] : [audioArgs];
  for (const args of attempts) {
    await fs.promises.unlink(outputPath).catch(() => {});
    try {
      await run(mediaBinary("ffmpeg"), args);
      const stat = await fs.promises.stat(outputPath).catch(() => null);
      if (stat?.size > 100) return outputPath;
    } catch {
      /* Try the next seek position before giving up. */
    }
  }
  return null;
}

export async function extractStillFrame(inputPath, time = 0, destination = "") {
  if (!inputPath || !fs.existsSync(inputPath))
    throw new Error("视频文件已经不存在。");
  const directory = destination
    ? path.dirname(destination)
    : path.join(supportRoot(), "stills");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const outputPath =
    destination || path.join(directory, `still-${crypto.randomUUID()}.png`);
  await run(mediaBinary("ffmpeg"), [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(Math.max(0, Number(time || 0))),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    outputPath,
  ]);
  return outputPath;
}

export async function createProjectCover(input = {}) {
  const inputPath = input.inputPath;
  const destination = input.destination;
  if (!inputPath || !fs.existsSync(inputPath))
    throw new Error("找不到用于工程封面的主视频。");
  if (!destination) throw new Error("工程封面保存位置无效。");
  const canvasWidth = 216;
  const canvasHeight = 384;
  const projectWidth = Math.max(1, Number(input.projectWidth || 1080));
  const projectHeight = Math.max(1, Number(input.projectHeight || 1920));
  const transform = input.videoTransform || {};
  const scale = Math.max(0.05, Math.min(8, Number(transform.scale || 1)));
  const rotation = Number(transform.rotation || 0);
  const offsetX = Number(transform.x || 0) * canvasWidth / projectWidth;
  const offsetY = Number(transform.y || 0) * canvasHeight / projectHeight;
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp.png`;
  const filter =
    `[0:v]scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease,` +
    `scale=iw*${scale.toFixed(5)}:ih*${scale.toFixed(5)},` +
    `rotate=${rotation.toFixed(4)}*PI/180:c=none:ow=rotw(iw):oh=roth(ih)[covervideo];` +
    `[1:v][covervideo]overlay=x='(W-w)/2+${offsetX.toFixed(3)}':` +
    `y='(H-h)/2+${offsetY.toFixed(3)}':shortest=1,format=rgb24[cover]`;
  try {
    await run(mediaBinary("ffmpeg"), [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(Math.max(0, Number(input.time || 0))),
      "-i",
      inputPath,
      "-f",
      "lavfi",
      "-i",
      `color=c=0x0e0f10:s=${canvasWidth}x${canvasHeight}:d=1`,
      "-filter_complex",
      filter,
      "-map",
      "[cover]",
      "-frames:v",
      "1",
      temporary,
    ]);
    await fs.promises.rename(temporary, destination);
    return destination;
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }
}

export const WINDOWS_SPAWN_SAFE_CHARS = 24000;

export function estimateSpawnCommandLength(binary, args = []) {
  const quote = (value) => {
    const text = String(value ?? "");
    if (!text) return '""';
    if (!/[\s"]/.test(text)) return text;
    return `"${text.replace(/"/g, '\\"')}"`;
  };
  return [binary, ...args].reduce((sum, part) => sum + quote(part).length + 1, 0);
}

export function captionRasterItems(config = {}) {
  return (config.images || []).filter((image) => image?._quickCutCaptionRaster);
}

export function captionRastersUseMovieFilter(config = {}) {
  const rasters = captionRasterItems(config);
  if (!rasters.length) return false;
  const listed = rasters.reduce((sum, image) => sum + String(image.path || "").length + 16, 0);
  return rasters.length >= 8 || listed >= 6000 || (process.platform === "win32" && rasters.length >= 6);
}

export function collectExportExtraInputs(config = {}) {
  const viaMovie = captionRastersUseMovieFilter(config);
  const extraInputs = [];
  for (const video of config.videoLayers || []) extraInputs.push("-i", video.path);
  for (const image of config.images || []) {
    if (image?._quickCutCaptionConcat) {
      extraInputs.push("-f", "concat", "-safe", "0", "-i", image.path);
      continue;
    }
    if (viaMovie && image?._quickCutCaptionRaster) continue;
    // Decode still images sparsely and let overlay repeat the processed frame.
    // Animated images are promoted back to the output FPS after scaling below.
    extraInputs.push("-framerate", "1", "-loop", "1", "-i", image.path);
  }
  for (const audio of config.audioAssets || []) extraInputs.push("-i", audio.path);
  return { extraInputs, captionRastersViaMovie: viaMovie };
}

function concatFileRef(filePath) {
  return `'${String(filePath || "").replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

function writeTransparentPng(dest, width, height) {
  const result = spawnSync(
    mediaBinary("ffmpeg"),
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=black@0.0:s=${Math.max(2, width)}x${Math.max(2, height)}:r=1:d=0.04`,
      "-vf",
      "format=rgba,colorchannelmixer=aa=0",
      "-frames:v",
      "1",
      dest,
    ],
    { windowsHide: true, timeout: 20000 },
  );
  return result.status === 0 && fs.existsSync(dest);
}

function padRasterToFrame(image, dest, frameW, frameH) {
  const srcW = Math.max(0, Number(image.sourceWidth || 0));
  const srcH = Math.max(0, Number(image.sourceHeight || 0));
  const vf = srcW > 0 && srcH > 0
    ? `pad=${frameW}:${frameH}:${Math.round((frameW - srcW) / 2 + Number(image.x || 0))}:${Math.round((frameH - srcH) / 2 + Number(image.y || 0))}:black@0`
    : `pad=${frameW}:${frameH}:(ow-iw)/2+${Number(image.x || 0)}:(oh-ih)/2+${Number(image.y || 0)}:black@0`;
  const result = spawnSync(
    mediaBinary("ffmpeg"),
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      image.path,
      "-vf",
      vf,
      "-frames:v",
      "1",
      dest,
    ],
    { windowsHide: true, timeout: 30000 },
  );
  return result.status === 0 && fs.existsSync(dest) ? dest : "";
}

export function composeCaptionRasterConcat(config = {}, info = {}) {
  const rasters = captionRasterItems(config).sort(
    (left, right) => Number(left.start || 0) - Number(right.start || 0),
  );
  if (rasters.length < 2) return "";
  const width = Math.max(2, Math.round(Number(config.width || info.width || 1080)));
  const height = Math.max(2, Math.round(Number(config.height || info.height || 1920)));
  const duration = Math.max(0.04, Number(config.outputDuration || info.duration || 1));
  const directory = config.captionRasterDirectory
    || path.join(supportRoot(), "temp", `caption-concat-${crypto.randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const emptyPath = path.join(directory, "empty.png");
  if (!writeTransparentPng(emptyPath, width, height)) return "";
  const files = rasters.map((image, index) => {
    if (image.fullFrame || (Number(image.sourceWidth) === width && Number(image.sourceHeight) === height))
      return image.path;
    return padRasterToFrame(image, path.join(directory, `full-${index}.png`), width, height) || image.path;
  });
  const lines = ["ffconcat version 1.0"];
  let cursor = 0;
  rasters.forEach((image, index) => {
    const start = Math.max(0, Number(image.start || 0));
    const end = Math.max(start + 0.02, Number(image.end || start));
    if (start > cursor + 0.005) {
      lines.push(`file ${concatFileRef(emptyPath)}`);
      lines.push(`duration ${(start - cursor).toFixed(3)}`);
    }
    lines.push(`file ${concatFileRef(files[index])}`);
    lines.push(`duration ${(end - start).toFixed(3)}`);
    cursor = Math.max(cursor, end);
  });
  if (cursor < duration - 0.005) {
    lines.push(`file ${concatFileRef(emptyPath)}`);
    lines.push(`duration ${(duration - cursor).toFixed(3)}`);
  }
  lines.push(`file ${concatFileRef(emptyPath)}`);
  const listPath = path.join(directory, "captions.concat");
  fs.writeFileSync(listPath, `${lines.join("\n")}\n`, "utf8");
  config.images = [
    ...(config.images || []).filter((image) => !image?._quickCutCaptionRaster),
    {
      path: listPath,
      start: 0,
      end: duration,
      x: 0,
      y: 0,
      pixelExact: true,
      fullFrame: true,
      _quickCutCaptionRaster: true,
      _quickCutCaptionConcat: true,
      trackId: "caption",
    },
  ];
  config.captionRasterized = true;
  return listPath;
}

export function shouldWriteFilterComplexScript(args = [], options = {}) {
  const index = args.indexOf("-filter_complex");
  const graph = index >= 0 ? String(args[index + 1] || "") : "";
  const length = estimateSpawnCommandLength(options.binary || "ffmpeg", args);
  const limit = Number(options.limit || WINDOWS_SPAWN_SAFE_CHARS);
  if (length >= limit) return true;
  if (graph.length >= 8000) return true;
  if (options.force) return true;
  if (process.platform === "win32" && Number(options.rasterCount || 0) >= 12) return true;
  return false;
}

export function compactFfmpegFilterArgs(args = [], options = {}) {
  const list = [...args];
  const index = list.findIndex(
    (item, offset) => item === "-filter_complex" && typeof list[offset + 1] === "string",
  );
  if (index < 0) return { args: list, scriptPath: "" };
  if (!shouldWriteFilterComplexScript(list, options)) return { args: list, scriptPath: "" };
  const directory = options.directory || path.join(supportRoot(), "temp");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const scriptPath = path.join(directory, `export-filter-${crypto.randomUUID()}.ffscript`);
  fs.writeFileSync(scriptPath, list[index + 1], "utf8");
  list.splice(index, 2, "-filter_complex_script", scriptPath);
  return { args: list, scriptPath };
}

export function isSpawnTooLongError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "");
  return code === "ENAMETOOLONG" || /ENAMETOOLONG/i.test(message);
}
