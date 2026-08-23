import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { CAPTION_WORD_MARGIN_EM, estimatedWordWidth, normalizedFontWeight, paintedLineWidth, wordGap, wrapCaptionWordList } from "../text-layout.mjs";
import {
  defaultSupportRoot,
  fallbackFontFiles,
  fontSearchRoots,
  isDarwin,
  isWindows,
} from "../platform.mjs";
import { mediaBinary, supportRoot, estimateSpawnCommandLength, WINDOWS_SPAWN_SAFE_CHARS, shouldWriteFilterComplexScript } from "./core.mjs";

const execFileAsync = promisify(execFile);

function resolveFontFile(style = {}) {
  const candidates = [style.fontFile, ...fallbackFontFiles()];
  const direct = candidates.find(
    (candidate) => candidate && fs.existsSync(candidate),
  );
  if (direct) return direct;
  if (!isWindows) {
    const matched = spawnSync("fc-match", ["-f", "%{file}", "sans-serif"], {
      encoding: "utf8",
    });
    const file = String(matched.stdout || "").trim();
    if (matched.status === 0 && file && fs.existsSync(file)) return file;
  }
  return "";
}

function escapeDrawtext(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

function escapeFilterPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function animationMotion(id = "") {
  const value = String(id || "").toLowerCase();
  if (value.includes("orbit") || value.includes("ring")) return "rotate";
  if (value.includes("comet") || value.includes("flare")) return "right";
  if (value.includes("dust")) return "up";
  if (value.includes("halo") || value.includes("rays") || value.includes("burst")) return "zoom";
  if (value.includes("left")) return "left";
  if (value.includes("right")) return "right";
  if (value.includes("up") || value === "rise" || value.includes("word-rise"))
    return "up";
  if (value.includes("down") || value === "drop") return "down";
  if (value.includes("rotate") || value.includes("roll") || value === "tilt")
    return "rotate";
  if (value.includes("zoom") || value.includes("scale") || value.includes("pop"))
    return "zoom";
  if (value.includes("wipe") || value.includes("reveal") || value === "typewriter")
    return "wipe";
  return value ? "fade" : "";
}

function animationIntensity(item, mode) {
  const id = item?.[`${mode}Animation`];
  if (!id) return "0";
  const start = Math.max(0, Number(item.start || 0));
  const end = Math.max(start + 0.04, Number(item.end || start + 0.04));
  const duration = Math.min(
    end - start,
    Math.max(0.15, Number(item[`${mode}Duration`] || 0.45)),
  );
  return mode === "enter"
    ? `if(between(t,${start.toFixed(4)},${(start + duration).toFixed(4)}),1-(t-${start.toFixed(4)})/${duration.toFixed(4)},0)`
    : `if(between(t,${(end - duration).toFixed(4)},${end.toFixed(4)}),(t-${(end - duration).toFixed(4)})/${duration.toFixed(4)},0)`;
}

export function animatedPosition(item, axis, base, distance = 180) {
  const entries = ["enter", "exit"].map((mode) => ({
    motion: animationMotion(item?.[`${mode}Animation`]),
    factor: animationIntensity(item, mode),
  }));
  const additions = [];
  for (const entry of entries) {
    let amount = 0;
    if (axis === "x" && entry.motion === "left") amount = -distance;
    if (axis === "x" && entry.motion === "right") amount = distance;
    if (axis === "y" && entry.motion === "up") amount = distance * 0.62;
    if (axis === "y" && entry.motion === "down") amount = -distance * 0.62;
    if (entry.motion === "rotate") amount = axis === "x" ? -distance * 0.18 : distance * 0.1;
    if (amount) additions.push(`(${amount.toFixed(2)})*(${entry.factor})`);
  }
  return additions.length ? `${base}+${additions.join("+")}` : base;
}

function animatedAlpha(item, baseOpacity = 1) {
  const enter = animationIntensity(item, "enter"),
    exit = animationIntensity(item, "exit");
  if (enter === "0" && exit === "0")
    return Math.max(0, Math.min(1, Number(baseOpacity ?? 1))).toFixed(3);
  return `${Math.max(0, Math.min(1, Number(baseOpacity ?? 1))).toFixed(3)}*(1-max(${enter},${exit}))`;
}

function spacedText(value, wordSpacing = 0) {
  const count = Math.max(1, Math.min(8, 1 + Math.round(Number(wordSpacing || 0) / 6)));
  return String(value || "").replace(/ /g, " ".repeat(count));
}

function casedText(value, mode = "none") {
  const text = String(value || "");
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  if (mode === "title")
    return text.replace(/\b([\p{L}])/gu, (letter) => letter.toUpperCase());
  return text;
}

function assColor(value, alpha = 0) {
  const hex = String(value || "#ffffff")
    .replace("#", "")
    .padEnd(6, "f")
    .slice(0, 6);
  const [red, green, blue] = [
    hex.slice(0, 2),
    hex.slice(2, 4),
    hex.slice(4, 6),
  ];
  return `&H${Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0")}${blue}${green}${red}`.toUpperCase();
}

function assOverrideColor(value) {
  const full = assColor(value, 0);
  return `&H${full.slice(-6)}&`;
}

function assAlpha(opacity = 1) {
  const alpha = Math.round((1 - Math.max(0, Math.min(1, Number(opacity)))) * 255);
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}&`;
}

function assTime(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remaining = value % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${remaining.toFixed(2).padStart(5, "0")}`;
}

function escapeAssText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/[{}]/g, "")
    .replace(/\r?\n/g, " ");
}

export function captionRasterOverlayOffset(frameW, frameH, x, y, w, h) {
  return {
    x: Number(x || 0) - (Number(frameW || 0) - Number(w || 0)) / 2,
    y: Number(y || 0) - (Number(frameH || 0) - Number(h || 0)) / 2,
  };
}

function captionLayoutOrigin(caption = {}, canvas = {}) {
  const width = Math.max(320, Number(canvas.width || 1080));
  const height = Math.max(320, Number(canvas.height || 1920));
  const x = Number.isFinite(Number(caption.x)) ? Number(caption.x) : 0;
  const y = Number.isFinite(Number(caption.y)) ? Number(caption.y) : 538;
  return {
    width,
    height,
    scale: Math.max(0.05, Math.min(8, Number(caption.scale || 1))),
    boxWidth: Math.max(160, Math.min(width, Number(caption.width || width * 0.8))),
    posX: Math.round(width / 2 + x),
    posY: Math.round(height / 2 + y),
  };
}

function spokenHighlightEnabled(style = {}) {
  return style.highlightEnabled !== false;
}

export function previewShadowOpacity(style = {}) {
  const strength = Math.max(0, Math.min(10, Number(style.shadow || 0)));
  const opacity = Math.max(0, Math.min(1, Number(style.shadowOpacity ?? 0.8)));
  return opacity * (0.18 + 0.82 * (strength / 10));
}

export function assDropShadow(style = {}, scale = 1) {
  const strength = Math.max(0, Number(style.shadow || 0));
  if (strength <= 0.01 || previewShadowOpacity(style) <= 0.01) return null;
  const distance = Math.max(0, Number(style.shadowDistance || 0) * scale);
  const angle = (Number(style.shadowAngle ?? 45) * Math.PI) / 180;
  return {
    sx: Math.round(Math.cos(angle) * distance),
    sy: Math.round(Math.sin(angle) * distance),
    blur: Math.max(0, Number(style.shadowBlur || 0) * scale * (0.55 + strength * 0.07)),
    color: assOverrideColor(style.shadowColor || "#000000"),
    alpha: assAlpha(previewShadowOpacity(style)),
  };
}

function assTypographyTags(style = {}, fontSize, letterSpacing) {
  const family = style.fontFamily ? `\\fn${String(style.fontFamily).replace(/[{}]/g, "")}` : "";
  return `${family}\\fs${Number(fontSize).toFixed(2)}\\fsp${Number(letterSpacing || 0).toFixed(2)}\\b${normalizedFontWeight(style.fontWeight || 700)}${style.fontItalic ? "\\i1" : "\\i0"}`;
}

function assStrokeTags(style = {}, scale = 1) {
  const outline = Math.max(0, Number(style.stroke || 0) * scale);
  if (outline <= 0.01) return "\\bord0";
  return `\\bord${outline.toFixed(1)}\\3c${assOverrideColor(style.strokeColor || "#000000")}`;
}

function usesSpokenWordExport(style = {}) {
  const animation = String(style.animation || "fade");
  return (
    spokenHighlightEnabled(style) ||
    animation === "karaoke" ||
    animation === "typewriter" ||
    animation.startsWith("word-") ||
    ["underline", "outline-active"].includes(animation)
  );
}

function assAnimationTags(animation, x, y, durationMs, style = {}) {
  const end = Math.max(120, Math.min(durationMs, 520));
  const pin = `\\an5\\pos(${x},${y})`;
  const tags = {
    fade: `${pin}\\fad(180,90)`,
    rise: `\\an5\\move(${x},${y + 90},${x},${y},0,${end})\\fad(100,70)`,
    "slide-left": `\\an5\\move(${x - 240},${y},${x},${y},0,${end})\\fad(80,70)`,
    "slide-right": `\\an5\\move(${x + 240},${y},${x},${y},0,${end})\\fad(80,70)`,
    zoom: `${pin}\\fscx55\\fscy55\\t(0,${end},\\fscx100\\fscy100)`,
    flip: `${pin}\\frx75\\t(0,${end},\\frx0)`,
    shake: `\\an5\\move(${x - 9},${y},${x + 9},${y},0,100)\\t(100,220,\\frz-2)\\t(220,360,\\frz2)\\t(360,480,\\frz0)`,
    glow: `${pin}\\blur7\\t(0,${end},\\blur0)\\t(${end},${Math.min(durationMs, end + 350)},\\blur4)`,
    stretch: `${pin}\\fscx25\\fsp-4\\t(0,${end},\\fscx100\\fsp0)`,
    drop: `\\an5\\move(${x},${y - 180},${x},${y},0,${end})`,
    swing: `${pin}\\frz12\\t(0,${Math.round(end * 0.65)},\\frz-3)\\t(${Math.round(end * 0.65)},${end},\\frz0)`,
    "neon-pulse": `${pin}\\blur5\\t(0,220,\\blur0)\\t(220,440,\\blur5)\\t(440,620,\\blur0)`,
    blink: `${pin}\\alpha&HAA&\\t(0,90,\\alpha&H00&)\\t(90,180,\\alpha&HAA&)\\t(180,270,\\alpha&H00&)`,
    typewriter: `${pin}\\fad(80,40)`,
    // Alisha：方向可选，四个方向共享同一套渐显滑入。
    "alisha-reveal": (() => {
      const d = String(style.animationDirection || "leftToRight");
      const fromX = d === "leftToRight" ? x - 180 : d === "rightToLeft" ? x + 180 : x;
      const fromY = d === "bottomToTop" ? y + 140 : d === "topToBottom" ? y - 140 : y;
      return `\\an5\\move(${fromX},${fromY},${x},${y},0,${Math.min(end, 360)})\\alpha&HFF&\\t(0,${Math.min(end, 320)},\\alpha&H00&)\\fad(0,80)`;
    })(),
    "donald-cut": `${pin}\\fad(35,25)`,
  };
  return tags[animation] || pin;
}

function captionWordDisplays(caption, style = {}) {
  if (Array.isArray(caption?.words) && caption.words.length) {
    return caption.words
      .map((word) => casedText(String(word.display || "").trim(), style.textCase))
      .filter(Boolean);
  }
  return casedText(String(caption?.text || ""), style.textCase).split(/\s+/).filter(Boolean);
}

function captionAssLines(caption, style, boxWidth, canvasWidth = 1080) {
  const width = Math.max(80, Number(boxWidth || canvasWidth * 0.8));
  const lines = wrapCaptionWordList(
    captionWordDisplays(caption, style),
    style,
    width,
    style.captionLines,
    Math.max(0.2, Number(caption.scale || 1)),
  ).map((line) => line.join(" ").trim()).filter(Boolean);
  return lines.length ? lines : captionWordDisplays(caption, style);
}

function markWrappedCaptionWords(caption, style, boxWidth) {
  const words = Array.isArray(caption.words) && caption.words.length
    ? caption.words.map((word) => ({
        display: String(word.display || "").trim(),
        start: Number(word.start ?? caption.start),
        end: Number(word.end ?? caption.end),
      })).filter((word) => word.display)
    : String(caption.text || "").split(/\s+/).filter(Boolean).map((display, index, list) => ({
        display,
        start: Number(caption.start) + ((Number(caption.end) - Number(caption.start)) * index) / Math.max(1, list.length),
        end: Number(caption.start) + ((Number(caption.end) - Number(caption.start)) * (index + 1)) / Math.max(1, list.length),
      }));
  const lines = wrapCaptionWordList(
    words.map((word) => word.display),
    style,
    Math.max(80, Number(boxWidth || 860)),
    style.captionLines,
    Math.max(0.2, Number(caption.scale || 1)),
  );
  const marked = [];
  let cursor = 0;
  lines.forEach((line, lineIndex) => {
    line.forEach((token, tokenIndex) => {
      const word = words[cursor] || { display: token, start: caption.start, end: caption.end };
      cursor += 1;
      marked.push({
        ...word,
        display: casedText(word.display || token, style.textCase),
        breakAfter: tokenIndex === line.length - 1 && lineIndex < lines.length - 1,
      });
    });
  });
  return marked.length ? marked : words;
}

function assWordSeparator(style = {}, fontSize = 54) {
  const size = Math.max(10, Number(fontSize || 54));
  const extra = Number(style.wordSpacing || 0);
  const hard = Math.max(0, Math.min(6, Math.round((size * CAPTION_WORD_MARGIN_EM + extra) / Math.max(8, size * 0.3))));
  return ` ${"\\h".repeat(hard)}`;
}

function stableWordAssEvents(caption, style, x, y, animation, boxWidth = 860) {
  const words = markWrappedCaptionWords(caption, style, boxWidth);
  if (!words.length) return [];
  const base = assOverrideColor(style.color || "#ffffff");
  const weightTag = `\\b${normalizedFontWeight(style.fontWeight || 700)}`;
  const hi = assOverrideColor(style.highlight || "#ffd21f");
  const stroke = assOverrideColor(style.strokeColor || "#000000");
  const effectiveScale = Math.max(0.2, Number(caption.scale || 1));
  const outline = Math.max(0, Number(style.stroke || 0) * effectiveScale);
  const activeOutline = Math.max(outline, animation === "word-box" || animation === "word-ring" ? 3 * effectiveScale : outline);
  const fontSize = Math.max(10, Number(style.fontSize || 54) * effectiveScale);
  const letterSpacing = Number(style.letterSpacing || 0) * effectiveScale;
  const gap = wordGap(style, fontSize);
  const wordWidths = words.map((word) => estimatedWordWidth(word.display || "", style, fontSize, 1));
  const totalWidth = wordWidths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, words.length - 1);
  const left = x - totalWidth / 2;
  const separator = assWordSeparator(style, fontSize);
  const wordTimes = words.map((word, index) => {
    const start = Math.max(Number(caption.start), Number(word.start ?? (Number(caption.start) + (Number(caption.end)-Number(caption.start))*index/words.length)));
    const next = words[index + 1];
    const nextStart = next ? Number(next.start ?? NaN) : NaN;
    const end = Math.min(Number(caption.end), Math.max(start + 0.025,
      Number.isFinite(nextStart) ? nextStart : Number(word.end ?? (Number(caption.start) + (Number(caption.end)-Number(caption.start))*(index+1)/words.length))));
    return { start, end };
  });
  return words.flatMap((_, activeIndex) => {
    const { start, end } = wordTimes[activeIndex];
    const content = words.map((word, index) => {
      const escaped = escapeAssText(word.display);
      let styled;
      if (index !== activeIndex)
        styled = `{\\1c${base}\\3c${stroke}\\bord${outline.toFixed(1)}\\u0}${escaped}`;
      else if (animation === "word-pill")
        styled = `{\\1c&H000000&\\3c${stroke}\\bord${outline.toFixed(1)}\\u0}${escaped}`;
      else if (animation === "underline")
        styled = `{\\1c${hi}\\3c${stroke}\\bord${outline.toFixed(1)}\\u1}${escaped}`;
      else if (animation === "outline-active" || animation === "word-box" || animation === "word-ring")
        styled = `{\\1c${base}\\3c${hi}\\bord${activeOutline.toFixed(1)}\\u0}${escaped}`;
      else
        styled = `{\\1c${hi}\\3c${stroke}\\bord${outline.toFixed(1)}\\u0}${escaped}`;
      const gap = word.breakAfter ? "\\N" : index < words.length - 1 ? separator : "";
      return `${styled}${gap}`;
    }).join("");
    const events = [];
    if (animation === "word-pill") {
      const before = wordWidths.slice(0, activeIndex).reduce((sum, width) => sum + width, 0) + gap * activeIndex;
      const activeX = left + before + wordWidths[activeIndex] / 2;
      events.push(vectorRectEvent(start, end, {
        x: activeX,
        y,
        width: wordWidths[activeIndex] + Math.max(10, fontSize * 0.22),
        height: fontSize * 1.18,
      }, style.highlight || "#ffd21f", 1, 1));
    }
    const typeTags = assTypographyTags(style, fontSize, letterSpacing);
    const strokeTags = assStrokeTags(style, effectiveScale);
    const drop = assDropShadow(style, effectiveScale);
    if (drop) {
      const shadowRun = words.map((word, index) => {
        const escaped = escapeAssText(word.display);
        const gap = word.breakAfter ? "\\N" : index < words.length - 1 ? separator : "";
        return `{\\1c${drop.color}\\bord0\\shad0}${escaped}${gap}`;
      }).join("");
      events.push(`Dialogue: 1,${assTime(start)},${assTime(end)},Default,,0,0,0,,{\\an5\\pos(${x + drop.sx},${y + drop.sy})${typeTags}\\1c${drop.color}\\1a${drop.alpha}\\bord0\\shad0\\blur${Math.max(0.1, drop.blur).toFixed(1)}}${shadowRun}`);
    }
    events.push(`Dialogue: 2,${assTime(start)},${assTime(end)},Default,,0,0,0,,{\\an5\\pos(${x},${y})${typeTags}${strokeTags}\\shad0}${content}`);
    return events;
  }).filter(Boolean);
}

function karaokeAssText(caption, animation) {
  // 兼容旧工程：新的一键成片逐字样式走 stableWordAssEvents，确保所有词位置固定。
  return escapeAssText(caption.text || "");
}

function linePulseAssEvents(caption, style, x, y, fontSize) {
  const words = Array.isArray(caption.words) && caption.words.length
    ? caption.words
    : String(caption.text || "").split(/\s+/).filter(Boolean).map((display, index, list) => ({
        display,
        start: Number(caption.start) + (Number(caption.end) - Number(caption.start)) * index / list.length,
        end: Number(caption.start) + (Number(caption.end) - Number(caption.start)) * (index + 1) / list.length,
      }));
  if (words.length < 2) return [];
  let split = Math.ceil(words.length / 2);
  const totalChars = words.reduce((sum, word) => sum + String(word.display || "").length + 1, 0);
  let chars = 0;
  for (let index = 0; index < words.length - 1; index += 1) {
    chars += String(words[index].display || "").length + 1;
    if (chars >= totalChars / 2) { split = index + 1; break; }
  }
  const lines = [words.slice(0, split), words.slice(split)];
  if (!lines[1].length) return [];
  const boundary = Math.max(Number(caption.start) + 0.04, Number(lines[1][0].start || caption.start));
  const periods = [
    [Number(caption.start), Math.min(Number(caption.end), boundary), 0],
    [Math.min(Number(caption.end), boundary), Number(caption.end), 1],
  ].filter(([start, end]) => end > start + 0.002);
  const offset = Math.round(fontSize * 0.62);
  return periods.flatMap(([start, end, active]) => lines.map((line, index) => {
    const scale = index === active ? 130 : 100;
    const lineY = y + (index === 0 ? -offset : offset);
    const text = escapeAssText(
      spacedText(casedText(line.map((word) => word.display || "").join(" ").replace(/\s+([.,!?;:])/g, "$1"), style.textCase), style.wordSpacing),
    );
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,{\\pos(${x},${lineY})\\fscx${scale}\\fscy${scale}}${text}`;
  }));
}


function lineRiseAssEvents(caption, style, x, y, fontSize) {
  const words = Array.isArray(caption.words) && caption.words.length
    ? caption.words
    : String(caption.text || "").split(/\s+/).filter(Boolean).map((display, index, list) => ({
        display,
        start: Number(caption.start) + (Number(caption.end) - Number(caption.start)) * index / Math.max(1, list.length),
        end: Number(caption.start) + (Number(caption.end) - Number(caption.start)) * (index + 1) / Math.max(1, list.length),
      }));
  if (words.length < 2) return [];
  const split = Math.max(1, Math.ceil(words.length / 2));
  const lines = [words.slice(0, split), words.slice(split)];
  const mid = Math.max(Number(caption.start) + 0.08, Number(lines[1][0]?.start || (Number(caption.start) + Number(caption.end)) / 2));
  const end = Number(caption.end);
  const rise = Math.max(55, Math.round(fontSize * 1.25));
  const weight = normalizedFontWeight(style.fontWeight || 700);
  const text1 = escapeAssText(spacedText(casedText(lines[0].map(w => w.display).join(" "), style.textCase), style.wordSpacing));
  const text2 = escapeAssText(spacedText(casedText(lines[1].map(w => w.display).join(" "), style.textCase), style.wordSpacing));
  const enter1 = Math.max(120, Math.min(420, Math.round((mid - Number(caption.start)) * 700)));
  const enter2 = Math.max(120, Math.min(420, Math.round((end - mid) * 700)));
  return [
    `Dialogue: 2,${assTime(caption.start)},${assTime(Math.min(end, mid + 0.18))},Default,,0,0,0,,{\\move(${x},${y + rise},${x},${y - Math.round(fontSize * 0.45)},0,${enter1})\\b${weight}\\fad(50,80)}${text1}`,
    `Dialogue: 2,${assTime(mid)},${assTime(end)},Default,,0,0,0,,{\\move(${x},${y + rise},${x},${y + Math.round(fontSize * 0.45)},0,${enter2})\\b${weight}\\fad(50,50)}${text2}`,
  ];
}

function captionBackgroundLines(caption, style, fontSize, scale, boxWidth = 860) {
  return wrapCaptionWordList(
    captionWordDisplays(caption, style),
    style,
    Math.max(80, Number(boxWidth || caption.width || 860)),
    style.captionLines,
    scale,
  );
}

export function estimatedCaptionBox(caption, style, fontSize, scale, x, y, boxWidth = 860) {
  const lines = captionBackgroundLines(caption, style, fontSize, scale, boxWidth);
  const widthPad = Math.max(0, Number(style.backgroundWidth ?? style.padding ?? 14)) * scale;
  const heightPad = Math.max(0, Number(style.backgroundHeight ?? style.padding ?? 14)) * scale;
  const textWidth = Math.max(
    0,
    ...lines.map((line) => paintedLineWidth(line, style, fontSize, scale)),
  );
  const fitText = style.backgroundFitText !== false;
  const lineMode = String(style.backgroundMode || "block") === "line";
  const width = !fitText && !lineMode
    ? Math.max(80, Number(style.boxWidth || boxWidth || 864) * scale)
    : Math.max(80, textWidth + widthPad * 2) * Math.max(0.2, Number(style.backgroundScaleX || 1));
  const lineCount = Math.max(1, lines.length);
  const lineStep = fontSize * Math.max(1.05, Number(style.lineHeight || 1.15));
  const height = Math.max(
    28,
    lineStep * lineCount + heightPad * 2,
  ) * Math.max(0.2, Number(style.backgroundScaleY || 1));
  return {
    width,
    height,
    x: x + Number(style.backgroundX ?? style.backgroundOffsetX ?? 0) * scale,
    y: y + Number(style.backgroundY ?? style.backgroundOffsetY ?? 0) * scale,
    lines,
    lineStep,
    widthPad,
    heightPad,
    fitText,
    lineMode,
  };
}

function captionBackgroundEvents(caption, style, fontSize, scale, x, y, boxWidth = 860) {
  if (!style.backgroundEnabled) return [];
  const box = estimatedCaptionBox(caption, style, fontSize, scale, x, y, boxWidth);
  const rawRadius = Number(style.backgroundRadius ?? style.radius ?? 14);
  const color = style.background || "#000000";
  const opacity = Number(style.backgroundOpacity ?? 0.7);
  if (box.lineMode && box.lines.length) {
    const mid = (box.lines.length - 1) / 2;
    return box.lines.map((line, index) => {
      const lineWidth = Math.max(
        80,
        paintedLineWidth(line, style, fontSize, scale) + box.widthPad * 2,
      );
      const lineBox = {
        width: lineWidth,
        height: Math.max(28, box.lineStep + box.heightPad * 2),
        x: box.x,
        y: box.y + (index - mid) * box.lineStep,
      };
      const radius = String(style.backgroundMode || "") === "pill" || rawRadius >= 35
        ? Math.min(lineBox.width / 2, lineBox.height / 2)
        : Math.min(lineBox.width / 2, lineBox.height / 2, rawRadius * scale);
      return vectorRectEvent(caption.start, caption.end, lineBox, color, opacity, 0, radius);
    });
  }
  const isCapsule = String(style.backgroundMode || "") === "pill" || rawRadius >= 35;
  const radius = isCapsule
    ? Math.min(box.width / 2, box.height / 2)
    : Math.min(box.width / 2, box.height / 2, rawRadius * scale);
  return [vectorRectEvent(caption.start, caption.end, box, color, opacity, 0, radius)];
}

function vectorRectEvent(start, end, box, color, opacity = 1, layer = 0, radius = 0) {
  const left = Math.round(box.x - box.width / 2), top = Math.round(box.y - box.height / 2);
  const width = Math.max(1, Math.round(box.width)), height = Math.max(1, Math.round(box.height));
  const ass = assOverrideColor(color || "#000000");
  const alpha = assAlpha(opacity);
  const r = Math.max(0, Math.min(Math.floor(width / 2), Math.floor(height / 2), Math.round(radius)));
  let path = `m 0 0 l ${width} 0 l ${width} ${height} l 0 ${height}`;
  if (r > 1) {
    const k = Math.round(r * 0.55228475);
    const w = width, h = height;
    path = `m ${r} 0 l ${w - r} 0 b ${w - r + k} 0 ${w} ${r - k} ${w} ${r} l ${w} ${h - r} b ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h} l ${r} ${h} b ${r - k} ${h} 0 ${h - r + k} 0 ${h - r} l 0 ${r} b 0 ${r - k} ${r - k} 0 ${r} 0`;
  }
  return `Dialogue: ${layer},${assTime(start)},${assTime(end)},Default,,0,0,0,,{\\an7\\pos(${left},${top})\\p1\\1c${ass}\\alpha${alpha}\\bord0\\shad0}${path}{\\p0}`;
}

function fullUnderlineEvent(caption, style, x, y, fontSize, scale) {
  if (!style.fontUnderline || String(style.underlineMode || "line") !== "line") return "";
  const text = casedText(caption.text || "", style.textCase);
  const words = String(text).split(/\s+/).filter(Boolean);
  const width = Math.max(40, words.reduce((sum, word) => sum + estimatedWordWidth(word, style, fontSize, scale), 0) + wordGap(style, fontSize) * Math.max(0, words.length - 1));
  const thickness = Math.max(1, Number(style.underlineThickness || 1) * scale);
  const box = { x, y: y + fontSize * 0.62, width, height: thickness };
  return vectorRectEvent(caption.start, caption.end, box, style.color || "#ffffff", 1, 1);
}


function sharedRasterAnimationSupported(style = {}) {
  const animation = String(style.animation || "fade");
  return ["", "none", "fade", "alisha-reveal", "rise", "drop"].includes(animation);
}

function rasterEnterAnimation(style = {}) {
  const animation = String(style.animation || "");
  if (animation === "fade") return "fade";
  if (animation === "rise") return "slide-up";
  if (animation === "drop") return "slide-down";
  if (animation === "alisha-reveal") {
    const direction = String(style.animationDirection || "leftToRight");
    if (direction === "rightToLeft") return "slide-right";
    if (direction === "bottomToTop") return "slide-up";
    if (direction === "topToBottom") return "slide-down";
    return "slide-left";
  }
  return "";
}

function prepareSharedCaptionRaster(config) {
  if (!process.env.QUICKCUT_APP_EXECUTABLE) return false;
  if (!(config.captions || []).length) return false;
  const style = config.captions[0]?.style || {};
  if (!sharedRasterAnimationSupported(style)) return false;

  const executable = process.env.QUICKCUT_APP_EXECUTABLE;
  if (!fs.existsSync(executable)) return false;
  const directory = path.join(supportRoot(), "temp", `caption-raster-${crypto.randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const jobs = (config.captions || []).map((caption, index) => ({
    text: casedText(caption.text || "", style.textCase),
    outputPath: path.join(directory, `caption-${String(index).padStart(4, "0")}.png`),
    maxWidth: Math.max(80, Number(caption.width || config.width * 0.80)),
    scale: Math.max(0.05, Math.min(8, Number(caption.scale || 1))),
    style,
    activeWordIndex: -1,
  }));
  const manifestPath = path.join(directory, "manifest.json");
  const resultPath = path.join(directory, "result.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ jobs }), { mode: 0o600 });

  const run = spawnSync(executable, ["--render-caption-manifest", manifestPath, resultPath], {
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env },
  });
  if (run.status !== 0 || !fs.existsSync(resultPath)) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
    return false;
  }
  let results = [];
  try {
    results = JSON.parse(fs.readFileSync(resultPath, "utf8")).results || [];
  } catch {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
    return false;
  }
  if (results.length !== jobs.length) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
    return false;
  }

  const rasterImages = results.map((result, index) => {
    const caption = config.captions[index];
    const enterAnimation = rasterEnterAnimation(style);
    return {
      path: result.outputPath,
      start: Number(caption.start || 0),
      end: Number(caption.end || 0),
      x: Number(caption.x || 0),
      y: Number(caption.y || 0),
      rotation: 0,
      opacity: 1,
      pixelExact: true,
      enterAnimation,
      enterDuration: Math.min(0.45, Math.max(0.15, (Number(caption.end || 0) - Number(caption.start || 0)) * 0.24)),
      _quickCutCaptionRaster: true,
    };
  });
  config.images = [...(config.images || []), ...rasterImages];
  config.captionRasterized = true;
  config.captionRasterDirectory = directory;
  return true;
}

export function writeAssSubtitleFile(config, destination = "") {
  return createAssSubtitleFile(config, destination);
}

function createAssSubtitleFile(config, destination = "") {
  const captions = config.captions || [];
  if (!captions.length) return "";
  const style = { ...(captions[0].style || {}) };
  const resolvedFontPath = resolveFontFile(style);
  const resolvedFontMeta = resolvedFontPath ? readFontMetadata(resolvedFontPath) : null;
  if (resolvedFontMeta?.family) style.fontFamily = resolvedFontMeta.family;
  if (resolvedFontPath) style.fontFile = resolvedFontPath;
  const width = Math.max(320, Math.round(config.width || 1080));
  const height = Math.max(320, Math.round(config.height || 1920));
  const scale = Math.max(0.05, Math.min(8, Number(captions[0].scale || 1)));
  const fontSize = Math.max(
    10,
    Math.round(Number(style.fontSize || 54) * scale),
  );
  const backgroundEnabled = !!style.backgroundEnabled;
  const outline = Math.max(0, Math.round(Number(style.stroke || 0) * scale));
  const shadow = 0;
  const letterSpacing = Number(style.letterSpacing || 0) * scale;
  const firstOrigin = captionLayoutOrigin(captions[0], { width, height });
  const textBoxWidth = firstOrigin.boxWidth;
  const horizontalMargin = Math.max(0, Math.round((width - textBoxWidth) / 2));
  const animation = style.animation || "fade";
  const events = captions.flatMap((caption) => {
    const origin = captionLayoutOrigin(caption, { width, height });
    const x = origin.posX;
    const y = origin.posY;
    const result = [];
    const durationMs = Math.round((Number(caption.end) - Number(caption.start)) * 1000);
    const baseTags = assAnimationTags(animation, x, y, durationMs, style);
    if (style.backgroundEnabled)
      result.push(...captionBackgroundEvents(caption, style, fontSize, origin.scale, x, y, origin.boxWidth));
    const wrappedLines = captionAssLines(caption, style, origin.boxWidth, width);
    const wrappedAss = wrappedLines.map((line) => escapeAssText(line)).join("\\N");
    const drop = assDropShadow(style, origin.scale);
    const wordPaint = usesSpokenWordExport(style);
    if (drop && wrappedAss && !wordPaint) {
      result.push(`Dialogue: 1,${assTime(caption.start)},${assTime(caption.end)},Default,,0,0,0,,{\\an5\\pos(${x + drop.sx},${y + drop.sy})\\1c${drop.color}\\1a${drop.alpha}\\bord0\\shad0\\blur${Math.max(0.1, drop.blur).toFixed(1)}}${wrappedAss}`);
    }
    const glow = Math.max(0, Number(style.glow || 0));
    if (glow > 0.01) {
      const glowPx = glow * origin.scale;
      const glowText = wrappedAss;
      const glowColor = assOverrideColor(style.glowColor || style.color || "#ffffff");
      const familyTag = style.fontFamily ? `\\fn${String(style.fontFamily).replace(/[{}]/g, "")}` : "";
      result.push(`Dialogue: 0,${assTime(caption.start)},${assTime(caption.end)},Default,,0,0,0,,{\\an5\\pos(${x},${y})${familyTag}\\fs${fontSize}\\1a&HFF&\\3c${glowColor}\\3a&H70&\\bord${Math.max(1.2, glowPx * 0.22).toFixed(1)}\\blur${Math.max(2, glowPx * 0.95).toFixed(1)}\\shad0}${glowText}`);
      result.push(`Dialogue: 1,${assTime(caption.start)},${assTime(caption.end)},Default,,0,0,0,,{\\an5\\pos(${x},${y})${familyTag}\\fs${fontSize}\\1a&HFF&\\3c${glowColor}\\3a&H35&\\bord${Math.max(0.8, glowPx * 0.12).toFixed(1)}\\blur${Math.max(1.5, glowPx * 0.48).toFixed(1)}\\shad0}${glowText}`);
    }
    if (animation === "line-pulse" || animation === "donald-line-grow") {
      const lines = linePulseAssEvents(caption, style, x, y, fontSize).map((line) => line.replace(/^Dialogue: 0,/, "Dialogue: 2,"));
      if (lines.length) result.push(...lines);
    } else if (animation === "line-rise") {
      result.push(...lineRiseAssEvents(caption, style, x, y, fontSize));
    } else if (wordPaint) {
      result.push(...stableWordAssEvents(caption, style, x, y, animation === "fade" ? "karaoke" : animation, origin.boxWidth));
    } else {
      result.push(`Dialogue: 2,${assTime(caption.start)},${assTime(caption.end)},Default,,0,0,0,,{${baseTags}${assStrokeTags(style, origin.scale)}\\shad0\\b${normalizedFontWeight(style.fontWeight || 700)}}${wrappedAss}`);
    }
    const underline = fullUnderlineEvent(caption, style, x, y, fontSize, scale);
    if (underline) result.push(underline);
    return result;
  });
  const directory = path.join(supportRoot(), "temp");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filePath = destination || path.join(directory, `captions-${crypto.randomUUID()}.ass`);
  if (destination) fs.mkdirSync(path.dirname(destination), { recursive: true });
  const horizontal = { left: 1, center: 2, right: 3 }[
      style.textAlign || "center"
    ],
    verticalBase = { bottom: 0, middle: 3, top: 6 }[
      style.verticalAlign || "middle"
    ],
    alignment = verticalBase + horizontal,
    backColor = backgroundEnabled
      ? assColor(
          style.background || "#000000",
          1 - Number(style.backgroundOpacity ?? 0.7),
        )
      : assColor(
          style.shadowColor || "#000000",
          1 - Number(style.shadowOpacity ?? 0.8),
        ),
    backgroundPadding = Math.max(
      Number(style.backgroundWidth ?? style.padding ?? 14),
      Number(style.backgroundHeight ?? style.padding ?? 14),
    );
  const content = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${style.fontFamily || "Helvetica"},${fontSize},${assColor(style.color || "#ffffff")},${assColor(style.color || "#ffffff")},${assColor(style.strokeColor || "#000000")},${backColor},${normalizedFontWeight(style.fontWeight || 700)},${style.fontItalic ? -1 : 0},${style.fontUnderline && String(style.underlineMode || "line") === "word" ? -1 : 0},0,100,100,${letterSpacing.toFixed(2)},0,1,${outline},${shadow},${alignment},${horizontalMargin},${horizontalMargin},0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join("\n")}\n`;
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  return filePath;
}

const fontMetadataCache = new Map();
function decodeFontNameString(buffer, platformId) {
  if (!buffer?.length) return "";
  if (platformId === 0 || platformId === 3) {
    let out = "";
    for (let i = 0; i + 1 < buffer.length; i += 2) {
      const code = buffer.readUInt16BE(i);
      if (code) out += String.fromCharCode(code);
    }
    return out.replace(/\u0000/g, "").trim();
  }
  return buffer.toString("latin1").replace(/\u0000/g, "").trim();
}

function readFontMetadata(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const cacheKey = `${filePath}:${stat.size}:${stat.mtimeMs}`;
    const cached = fontMetadataCache.get(cacheKey);
    if (cached) return cached;
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 20) return null;
    let sfntOffset = 0;
    if (buffer.toString("ascii", 0, 4) === "ttcf") {
      const count = buffer.readUInt32BE(8);
      if (!count || buffer.length < 16) return null;
      sfntOffset = buffer.readUInt32BE(12);
    }
    if (sfntOffset + 12 > buffer.length) return null;
    const numTables = buffer.readUInt16BE(sfntOffset + 4);
    let nameOffset = -1, nameLength = 0;
    for (let i = 0; i < numTables; i += 1) {
      const record = sfntOffset + 12 + i * 16;
      if (record + 16 > buffer.length) break;
      if (buffer.toString("ascii", record, record + 4) !== "name") continue;
      nameOffset = sfntOffset + buffer.readUInt32BE(record + 8);
      nameLength = buffer.readUInt32BE(record + 12);
      break;
    }
    if (nameOffset < 0 || nameOffset + 6 > buffer.length) return null;
    const count = buffer.readUInt16BE(nameOffset + 2);
    const strings = nameOffset + buffer.readUInt16BE(nameOffset + 4);
    const candidates = new Map();
    for (let i = 0; i < count; i += 1) {
      const rec = nameOffset + 6 + i * 12;
      if (rec + 12 > buffer.length) break;
      const platform = buffer.readUInt16BE(rec);
      const language = buffer.readUInt16BE(rec + 4);
      const nameId = buffer.readUInt16BE(rec + 6);
      const length = buffer.readUInt16BE(rec + 8);
      const offset = buffer.readUInt16BE(rec + 10);
      if (![1, 2, 4, 6, 16, 17].includes(nameId)) continue;
      const start = strings + offset, end = start + length;
      if (start < 0 || end > buffer.length || end <= start) continue;
      const value = decodeFontNameString(buffer.subarray(start, end), platform);
      if (!value) continue;
      const score = (language === 0x0409 ? 100 : 0) + (platform === 3 ? 20 : platform === 0 ? 15 : 0);
      const current = candidates.get(nameId);
      if (!current || score > current.score) candidates.set(nameId, { value, score });
    }
    const family = candidates.get(16)?.value || candidates.get(1)?.value || path.basename(filePath, path.extname(filePath)).replace(/[-_]/g, " ");
    const subfamily = candidates.get(17)?.value || candidates.get(2)?.value || "";
    const fullName = candidates.get(4)?.value || [family, subfamily].filter(Boolean).join(" ");
    const postscriptName = candidates.get(6)?.value || "";
    const meta = { family, subfamily, fullName, postscriptName };
    fontMetadataCache.clear();
    fontMetadataCache.set(cacheKey, meta);
    return meta;
  } catch {
    return null;
  }
}

function listFontFiles(root, results, limit = 500) {
  if (!fs.existsSync(root) || results.length >= limit) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (results.length >= limit) break;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) listFontFiles(absolute, results, limit);
    else if (/\.(ttf|otf|ttc)$/i.test(entry.name)) {
      const meta = readFontMetadata(absolute);
      results.push({
        id: absolute,
        family: meta?.family || path.basename(entry.name, path.extname(entry.name)).replace(/[-_]/g, " "),
        fullName: meta?.fullName || "",
        postscriptName: meta?.postscriptName || "",
        subfamily: meta?.subfamily || "",
        path: absolute,
        installed: true,
      });
    }
  }
}

export function localFonts() {
  const fonts = [];
  const seenFamilies = new Set();

  if (process.platform === "win32") {
    try {
      const stdout = execSync(
        `reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      for (const rawLine of stdout.split("\n")) {
        const line = rawLine.trim();
        const parts = line.split(/\s+REG_SZ\s+/i);
        if (parts.length === 2) {
          const rawName = parts[0].trim();
          const fileName = parts[1].trim();
          const cleanName = rawName.replace(/\s*\((?:TrueType|OpenType)\)\s*$/i, "").trim();
          const baseFamily = cleanName.replace(
            /\s*(?:Bold|Italic|Light|Medium|Regular|SemiBold|Black|ExtraBold|ExtraLight|Condensed|Semibold|Heavy|Oblique)\s*$/i,
            "",
          ).trim() || cleanName;
          if (cleanName && !seenFamilies.has(cleanName)) {
            seenFamilies.add(cleanName);
            const absPath = path.isAbsolute(fileName)
              ? fileName
              : path.join(process.env.WINDIR || "C:\\Windows", "Fonts", fileName);
            fonts.push({
              id: absPath,
              family: baseFamily,
              fullName: cleanName,
              postscriptName: cleanName.replace(/\s+/g, "-"),
              subfamily: "Regular",
              path: absPath,
              installed: true,
              source: "system",
            });
          }
        }
      }
    } catch (e) {}
  }

  fontSearchRoots([path.join(supportRoot(), "fonts")]).forEach((root) =>
    listFontFiles(root, fonts, 1500),
  );
  return fonts;
}

export function installLocalFont(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath))
    throw new Error("字体文件已经不存在。");
  const extension = path.extname(sourcePath).toLowerCase();
  if (!/[.](ttf|otf|ttc|woff2)$/.test(extension))
    throw new Error("请选择 TTF、OTF、TTC 或 WOFF2 字体文件。");
  const directory = path.join(supportRoot(), "fonts");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(sourcePath))
    .digest("hex")
    .slice(0, 10);
  const base =
    path
      .basename(sourcePath, extension)
      .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
      .slice(0, 72) || "font";
  const destination = path.join(directory, `${base}-${hash}${extension}`);
  if (!fs.existsSync(destination)) fs.copyFileSync(sourcePath, destination);
  const meta = readFontMetadata(destination);
  return {
    id: destination,
    family: meta?.family || base.replace(/[-_]/g, " "),
    fullName: meta?.fullName || "",
    postscriptName: meta?.postscriptName || "",
    subfamily: meta?.subfamily || "",
    path: destination,
    installed: true,
    source: "local",
  };
}

function captionPresetsPath() {
  return path.join(supportRoot(), "caption-presets.json");
}

export function customCaptionPresets() {
  try {
    const value = JSON.parse(fs.readFileSync(captionPresetsPath(), "utf8"));
    return Array.isArray(value) ? value.slice(0, 100) : [];
  } catch {
    return [];
  }
}

export function saveCaptionPreset(input = {}) {
  const name =
    String(input.name || "我的字幕样式")
      .trim()
      .slice(0, 40) || "我的字幕样式";
  const style =
    input.style && typeof input.style === "object" ? { ...input.style } : {};
  const values = customCaptionPresets();
  const preset = {
    id: crypto.randomUUID(),
    name,
    style,
    createdAt: new Date().toISOString(),
  };
  values.unshift(preset);
  const temporary = `${captionPresetsPath()}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(values.slice(0, 100), null, 2), {
    mode: 0o600,
  });
  fs.renameSync(temporary, captionPresetsPath());
  return preset;
}

export async function fontCatalog(query = "") {
  const response = await fetch("https://api.fontsource.org/v1/fonts");
  if (!response.ok) throw new Error("暂时无法连接开源字体目录。");
  const data = await response.json();
  const text = String(query || "")
    .trim()
    .toLowerCase();
  return data
    .filter(
      (font) =>
        !text ||
        String(font.family || "")
          .toLowerCase()
          .includes(text) ||
        String(font.id || "").includes(text),
    )
    .slice(0, 120);
}

export async function installFont(fontId) {
  const response = await fetch(
    `https://api.fontsource.org/v1/fonts/${encodeURIComponent(fontId)}`,
  );
  if (!response.ok) throw new Error("无法读取字体文件信息。");
  const metadata = await response.json();
  const weight = metadata.weights?.includes(700)
    ? "700"
    : String(
        metadata.weights?.includes(400) ? 400 : metadata.weights?.[0] || 400,
      );
  const style =
    metadata.variants?.[weight]?.normal ||
    Object.values(metadata.variants?.[weight] || {})[0];
  const subset =
    style?.latin ||
    style?.[metadata.defSubset] ||
    Object.values(style || {})[0];
  const url = subset?.url?.ttf || subset?.url?.woff2;
  if (!url) throw new Error("这款字体没有可用的字体文件。");
  const fontResponse = await fetch(url);
  if (!fontResponse.ok) throw new Error("字体下载失败。");
  const directory = path.join(supportRoot(), "fonts");
  fs.mkdirSync(directory, { recursive: true });
  const extension = url.includes(".ttf") ? ".ttf" : ".woff2";
  const destination = path.join(
    directory,
    `${metadata.id}-${weight}${extension}`,
  );
  fs.writeFileSync(destination, Buffer.from(await fontResponse.arrayBuffer()), {
    mode: 0o600,
  });
  return {
    id: metadata.id,
    family: metadata.family,
    path: destination,
    installed: true,
    weight: Number(weight),
    license: metadata.license || metadata.type || "open-source",
  };
}
