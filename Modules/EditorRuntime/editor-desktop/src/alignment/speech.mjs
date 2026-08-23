import crypto from "node:crypto";
import { normalizeWord, displayWords } from "./engine.mjs";

export function manuscriptCaptionWords(aligned = {}) {
  const words = [];
  const ops = aligned.operations || [];
  const firstExpectedIndex = ops.findIndex((op) => op.expected);
  const lastExpectedIndex = ops.findLastIndex((op) => op.expected);
  for (let index = 0; index < ops.length; index += 1) {
    const operation = ops[index];
    if (operation?.expected) {
      const start = Number(operation.expected.start ?? operation.spoken?.start ?? 0);
      const end = Number(operation.expected.end ?? operation.spoken?.end ?? start);
      words.push({
        display: operation.expected.display,
        start,
        end,
        matchType:
          operation.expected.matchType ||
          (["match", "near"].includes(operation.type) ? operation.type : "error"),
        issueType: operation.issueType || "",
        expectedDisplay: operation.expected.display,
        issueId: operation.issueId || "",
        action: operation.action || "",
        keepWithPrevious: !!operation.expected.keepWithPrevious,
        scriptureReference: !!operation.expected.scriptureReference,
      });
    } else if (
      operation?.spoken &&
      operation.action === "insert" &&
      ["addition", "extra"].includes(operation.issueType) &&
      (index < firstExpectedIndex || index > lastExpectedIndex) &&
      Number(operation.spoken.end) > Number(operation.spoken.start)
    ) {
      words.push({
        display: operation.spoken.display,
        start: Number(operation.spoken.start),
        end: Number(operation.spoken.end),
        matchType: "spoken_addition",
        issueType: "addition",
        expectedDisplay: "",
        issueId: operation.issueId || "",
        action: "insert",
        keepWithPrevious: !!operation.spoken.keepWithPrevious,
        scriptureReference: false,
      });
    }
  }
  interpolateManuscriptTimes(words);
  return words.filter((word) => Number(word.end) > Number(word.start) + 0.001);
}

function interpolateManuscriptTimes(words = []) {
  const anchored = (word) =>
    ["match", "near", "spoken_addition"].includes(word.matchType) &&
    Number(word.end) > Number(word.start) + 0.02;
  let index = 0;
  while (index < words.length) {
    if (anchored(words[index])) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < words.length && !anchored(words[index])) index += 1;
    const previous = start > 0 ? words[start - 1] : null;
    const next = index < words.length ? words[index] : null;
    const count = index - start;
    const previousEnded = /[.!?…]["'”’)]*$/.test(String(previous?.display || "").trim());
    const nextStart = next
      ? Number(next.start)
      : Number(previous?.end || 0) + Math.max(0.24, count * 0.22);
    // After a finished sentence, park unanchored words on the later take.
    // Filling the hole would stretch the complete sentence over a false start.
    let from = previous
      ? Number(previous.end)
      : next
        ? Math.max(0, Number(next.start) - Math.max(0.24, count * 0.22))
        : 0;
    if (previousEnded && next && nextStart - Number(previous.end) > 0.62)
      from = Math.max(from, nextStart - Math.max(0.24, count * 0.22));
    const to = next
      ? Number(next.start)
      : from + Math.max(0.24, count * 0.22);
    const span = Math.max(0.08 * count, to - from);
    const base = to >= from ? from : Math.max(0, from);
    for (let offset = 0; offset < count; offset += 1) {
      words[start + offset].start = base + (span * offset) / count;
      words[start + offset].end = base + (span * (offset + 1)) / count;
    }
  }
}

export function spokenCaptionWords(operations = []) {
  return operations
    .filter(
      (operation) =>
        operation.spoken &&
        operation.expected &&
        ["match", "near"].includes(operation.type),
    )
    .map((operation) => {
      const spoken = operation.spoken;
      const expected = operation.expected;
      return {
        display: expected.display,
        norm: expected.norm,
        start: spoken.start,
        end: spoken.end,
        matchType: "match",
        issueType: "",
        expectedDisplay: expected.display,
        issueId: "",
        action: "",
        keepWithPrevious:
          !!spoken.keepWithPrevious || !!expected.keepWithPrevious,
        scriptureReference:
          !!spoken.scriptureReference || !!expected.scriptureReference,
      };
    });
}
