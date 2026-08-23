import crypto from "node:crypto";
import {
  captionSafeBoxWidth,
  captionWrapLineLimit,
  packWordsIntoLines,
  normalizeLanguagePunctuation,
  formatPanguSpacing,
  stripTrailingCaptionPunctuation,
} from "../text-layout.mjs";
import { normalizeWord, displayWords, formatDisplayWords } from "./engine.mjs";

export function endsCaptionSentence(display) {
  const text = String(display || "").trim();
  if (!/[.!?…\u3002\uff01\uff1f]/.test(text)) return false;
  return /[.!?…\u3002\uff01\uff1f]["”’」』》〉）】〕〗)\]}'\u201d\u2019]*$/u.test(text);
}

export function captionLineCharLimit(mode, lineChars = 34) {
  const chars = Math.max(12, Number(lineChars) || 34);
  const limit = captionWrapLineLimit(mode);
  return chars * limit;
}

export function flattenCaptionWords(captions = []) {
  const words = [];
  for (const caption of captions || []) {
    if (Array.isArray(caption.words) && caption.words.length) {
      for (const word of caption.words) {
        const display = String(word?.display || "").trim();
        if (!display) continue;
        words.push({
          display,
          start: Number(word.start ?? caption.start ?? 0),
          end: Math.max(
            Number(word.start ?? caption.start ?? 0) + 0.04,
            Number(word.end ?? caption.end ?? 0),
          ),
          matchType: word.matchType || "",
          issueType: word.issueType || "",
          expectedDisplay: word.expectedDisplay || "",
          issueId: word.issueId || "",
          action: word.action || "",
          keepWithPrevious: !!word.keepWithPrevious,
        });
      }
      continue;
    }
    const tokens = String(caption?.text || "").split(/\s+/).filter(Boolean);
    const start = Number(caption?.start || 0);
    const end = Math.max(start + 0.04, Number(caption?.end || start));
    tokens.forEach((display, index) => {
      words.push({
        display,
        start: start + ((end - start) * index) / Math.max(1, tokens.length),
        end: start + ((end - start) * (index + 1)) / Math.max(1, tokens.length),
      });
    });
  }
  return words;
}

function captionWordRecord(word) {
  return {
    display: word.display,
    start: word.start,
    end: word.end,
    matchType: word.matchType || "match",
    issueType: word.issueType || "",
    expectedDisplay: word.expectedDisplay || "",
    issueId: word.issueId || "",
    action: word.action || "",
    keepWithPrevious: !!word.keepWithPrevious,
  };
}

function captionFromGroup(group, style, maxWidth, scale) {
  const packed = packWordsIntoLines(group, style, maxWidth, scale);
  return {
    id: crypto.randomUUID(),
    start: group[0].start,
    end: Math.max(Number(group.at(-1).end), Number(group[0].start) + 0.04),
    text: formatDisplayWords(group),
    words: group.map(captionWordRecord),
    lineBreaks: packed.slice(1).map((line) => line.startIndex),
    lineCount: packed.length,
  };
}

const SAFE_CAPTION_BRIDGE_SECONDS = 0.62;

function bridgeSafeCaptionGaps(captions = []) {
  for (let index = 0; index < captions.length - 1; index += 1) {
    const current = captions[index];
    const next = captions[index + 1];
    const currentWord = current.words?.at(-1);
    const nextWord = next.words?.[0];
    const gap = Number(next.start || 0) - Number(current.end || 0);
    const safeBoundary = [currentWord, nextWord].every(
      (word) =>
        word &&
        word.action !== "cut" &&
        word.matchType !== "error" &&
        !["repeat", "extra", "mismatch"].includes(String(word.issueType || "")),
    );
    if (
      gap > 0.002 &&
      gap <= SAFE_CAPTION_BRIDGE_SECONDS &&
      safeBoundary &&
      !endsCaptionSentence(currentWord?.display || "")
    ) {
      // Word timestamps from cloud ASR can finish a few frames before the next
      // reliable word, especially after manuscript-first recovery. Keep the
      // earlier card visible across that short in-sentence interval. This is
      // deliberately a caption-span repair: karaoke word timing stays intact.
      current.end = Number(next.start);
    }
  }
  return captions;
}

export function regroupCaptions(words, options = {}) {
  const style = options.style || {};
  const scale = Math.max(0.2, Number(options.scale || 1));
  const maxLines = captionWrapLineLimit(options.captionLines ?? options.maxLines ?? 2);
  const requestedWidth = Number(options.maxWidth || options.boxWidth);
  const useWidth = Number.isFinite(requestedWidth) && requestedWidth > 0;
  const maxWidth = useWidth ? captionSafeBoxWidth(options) : 860;
  const fallbackChars = Math.max(
    12,
    Number(options.maxChars || captionLineCharLimit(options.captionLines ?? options.maxLines, options.lineChars)),
  );
  const linesNeeded = (group) => {
    if (!group.length) return 0;
    if (useWidth) return packWordsIntoLines(group, style, maxWidth, scale).length;
    const text = formatDisplayWords(group);
    return Math.max(1, Math.ceil(text.length / Math.max(12, fallbackChars / maxLines)));
  };
  const captions = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    captions.push(captionFromGroup(group, style, maxWidth, scale));
    group = [];
  };
  for (const word of words || []) {
    const display = String(word?.display || "").trim();
    if (!display) continue;
    const start = Number(word.start || 0);
    const end = Math.max(start + 0.04, Number(word.end || start));
    const item = { ...word, display, start, end };
    const prior = group.at(-1);
    if (group.length && !item.keepWithPrevious && endsCaptionSentence(prior?.display)) {
      flush();
    } else if (group.length && !item.keepWithPrevious && linesNeeded([...group, item]) > maxLines) {
      flush();
    }
    group.push(item);
  }
  flush();
  for (let index = 0; index < captions.length; index += 1) {
    const caption = captions[index];
    if (caption.words.length >= 2) continue;
    const previous = captions[index - 1];
    if (!previous || endsCaptionSentence(previous.words.at(-1)?.display)) continue;
    const mergedWords = [...previous.words, ...caption.words];
    if (linesNeeded(mergedWords) > maxLines) continue;
    captions.splice(index - 1, 2, captionFromGroup(mergedWords, style, maxWidth, scale));
    index -= 1;
  }
  for (let index = 0; index < captions.length - 1; index += 1) {
    const nextStart = Number(captions[index + 1].start);
    if (Number(captions[index].end) > nextStart) {
      captions[index].end = nextStart;
    }
  }
  return bridgeSafeCaptionGaps(captions);
}

export function regroupProjectCaptions(captions = [], options = {}) {
  const words = flattenCaptionWords(captions);
  if (!words.length) return Array.isArray(captions) ? captions : [];
  return regroupCaptions(words, options);
}

export function buildCaptions(expectedWords, options = {}) {
  const maxWords = Math.max(2, Math.min(14, Number(options.maxWords || 7)));
  const lineChars = Math.max(12, Number(options.maxChars || 28));
  const lineCount = Math.max(1, Number(options.maxLines || 2));
  const maxChars = lineChars * lineCount;
  const captions = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    captions.push({
      id: crypto.randomUUID(),
      start: group[0].start,
      end: Math.max(group.at(-1).end, group[0].start + 0.25),
      text: formatDisplayWords(group),
      words: group.map((word) => ({
        display: word.display,
        start: word.start,
        end: word.end,
        matchType: word.matchType || "match",
        issueType: word.issueType || "",
        expectedDisplay: word.expectedDisplay || "",
        issueId: word.issueId || "",
        action: word.action || "",
      })),
    });
    group = [];
  };
  for (const word of expectedWords) {
    if (!word.end || word.end <= word.start) continue;
    const candidate = [...group, word].map((item) => item.display).join(" ");
    const priorWord = group.at(-1);
    const timingGap = priorWord
      ? Number(word.start || 0) - Number(priorWord.end || 0)
      : 0;
    const priorEnds = endsCaptionSentence(priorWord?.display || "");
    const priorClauseEnds = /[,;:—–-，、；：]["'\u201d\u2019」』》〉）】〕〗)]*$/u.test(
      priorWord?.display || "",
    );
    const keepReferenceTogether = !!word.keepWithPrevious;
    const splitGap = priorEnds ? 0.62 : priorClauseEnds ? 0.75 : 1.85;
    if (
      group.length &&
      !keepReferenceTogether &&
      (timingGap > splitGap ||
        timingGap < -0.02 ||
        group.length >= maxWords ||
        candidate.length > maxChars ||
        priorEnds ||
        (priorClauseEnds && group.length >= 3 && timingGap >= 0.45) ||
        (priorWord &&
          (word.matchType === "spoken_addition") !==
            (priorWord.matchType === "spoken_addition")))
    )
      flush();
    group.push(word);
  }
  flush();
  for (let index = 0; index < captions.length; index += 1) {
    const caption = captions[index];
    if (caption.words.length >= 2) continue;
    const next = captions[index + 1];
    const previous = captions[index - 1];
    const gapToNext = next ? Number(next.start) - Number(caption.end) : Infinity;
    const gapFromPrevious = previous
      ? Number(caption.start) - Number(previous.end)
      : Infinity;
    const singleton = caption.words[0]?.display || "";
    const closesSentence = endsCaptionSentence(singleton);
    const previousClosesSentence = endsCaptionSentence(
      previous?.words?.at(-1)?.display || "",
    );
    const joinsNext = /^(?:and|but|or|so|because|for|yet|then|when|while|if|that|which|who)$/i.test(
      singleton.replace(/[^\p{L}]/gu, ""),
    );
    const shortCloser = /^(?:me|you|it|us|him|her|them)[.!?]["'\u201d\u2019)]*$/i.test(
      singleton.replace(/^["“]+/, ""),
    );
    const canMergePrevious =
      previous &&
      (gapFromPrevious <= 0.62 || (shortCloser && !previousClosesSentence && gapFromPrevious <= 1.8)) &&
      previous.words.length + caption.words.length <= maxWords + 1 &&
      !previousClosesSentence;
    const canMergeNext =
      next &&
      (gapToNext <= 0.62 || (!closesSentence && gapToNext <= 1.85)) &&
      caption.words.length + next.words.length <= maxWords + 1 &&
      !closesSentence;
    const target = closesSentence
      ? canMergePrevious
        ? previous
        : null
      : joinsNext
        ? canMergeNext
          ? next
          : canMergePrevious
            ? previous
            : null
        : canMergePrevious
          ? previous
          : canMergeNext
            ? next
            : null;
    if (!target) continue;
    const mergedWords =
      target === next
        ? [...caption.words, ...next.words]
        : [...previous.words, ...caption.words];
    const merged = {
      id: target === next ? caption.id : previous.id,
      start: mergedWords[0].start,
      end: mergedWords.at(-1).end,
      words: mergedWords,
      text: formatDisplayWords(mergedWords),
    };
    if (target === next) captions.splice(index, 2, merged);
    else {
      captions.splice(index - 1, 2, merged);
      index -= 1;
    }
  }
  return bridgeSafeCaptionGaps(captions);
}

export function buildReviewCaptions(
  issues = [],
  expectedWords = [],
  outputDuration = Infinity,
) {
  void expectedWords;
  return issues
    .filter((issue) => issue.start < outputDuration && !issue.suppressReview && issue.action !== "keep")
    .map((issue) => {
      const explicit = String(issue.expectedText || "")
        .replace(/^\s*[—-]\s*$/, "")
        .trim();
      const cuttable = ["extra", "repeat", "mismatch"].includes(issue.type);
      const acceptable = issue.type === "addition" || issue.action === "insert";
      if (!explicit && !cuttable && !acceptable) return null;
      const spoken = String(issue.spokenText || "")
        .replace(/^\s*[—-]\s*$/, "")
        .trim();
      return {
        id: issue.id,
        issueId: issue.id,
        type: issue.type,
        scripture: !!issue.scripture,
        start: issue.start,
        end: Math.min(outputDuration, Math.max(issue.start + 0.12, issue.end)),
        text: cuttable || acceptable
          ? spoken || explicit || "未识别出文字"
          : explicit || "需补录",
        expectedText: explicit,
        spokenText: issue.spokenText,
        action: cuttable ? "cut" : acceptable ? "insert" : "missing",
      };
    })
    .filter(Boolean);
}
