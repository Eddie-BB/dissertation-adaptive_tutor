// src/sim/cueExtractor.js
/**
 * CANONICAL: active cue extraction module in the primary simulation path.
 *
 * This file is the teacher-visible cue extractor used by the integrated
 * runner. It should be treated as the main observable-only cue interface.
 *
 * Cue Extractor (Teacher-Observable Only)
 * --------------------------------------
 * Converts observable student outputs into auditable cues the teacher agent can use.
 *
 * Inputs MUST be limited to:
 *  - studentText (string)
 *  - history (array of prior observable turns, optional)
 *  - nowMs (number timestamp, optional; used only for idle-gap detection)
 *
 * This module MUST NOT receive or infer from latent variables (true Reward/Monotony/Attention).
 *
 * Design goals:
 *  - deterministic (no randomness)
 *  - simple & transparent (good for dissertation auditability)
 *  - safe defaults (will not crash on missing fields)
 *
 * Usage:
 *   import { extractCues } from "./cueExtractor";
 *   const cues = extractCues({ studentText, history, nowMs });
 */

export const DEFAULT_CUE_CONFIG = Object.freeze({
  // Token thresholds
  minimalTokenThreshold: 6,      // <= this is "minimal"

  // Rolling window parameters
  windowK: 6,                    // how many previous turns to consider for trends

  // Idle / gap detection (optional)
  // If you don't pass timestamps, this stays false.
  idleGapMs: 45_000,             // >45s gap counts as "idle gap"

  // Keyword dictionaries (kept small & explicit for interpretability)
  helpSeekingPhrases: [
    "i don't understand", "i dont understand", "not sure", "no idea",
    "i do not really understand", "do not really understand",
    "can you explain", "explain again", "can you show", "show me",
    "example", "another example", "more simply", "simpler",
    "what do i do", "where do i start", "first step", "help"
  ],
  confusionPhrases: [
    "confused", "lost", "i'm lost", "im lost", "doesn't make sense", "doesnt make sense",
    "i can't follow", "i cant follow", "overwhelmed", "do not really understand"
  ],
  offTaskPhrases: [
    "bored", "boring", "this is boring", "this is repetitive", "repetitive",
    "off task", "mind is wandering", "my mind is wandering", "distracted",
    "can we change", "something else", "different activity", "switch"
  ],
  disengagedPhrases: [
    "...", "i can't do this", "i cant do this", "can't", "cant",
    "i'm done", "im done", "done with this", "stop", "i give up",
    "break", "need a break", "not doing this"
  ],
  frustrationPhrases: [
    "this is hard", "too hard", "annoying", "frustrating", "stupid",
    "i hate this"
  ],
  repetitionRequestPhrases: [
    "again", "repeat", "same as before", "one more time", "can you repeat"
  ],

});

/**
 * @typedef {Object} ObservableTurn
 * @property {string} studentText
 * @property {number=} timestampMs
 */

/**
 * @typedef {Object} CueOutput
 * @property {number} tokenCount
 * @property {boolean} hasAnyQuestion
 *
 * @property {boolean} isEmptyOrEllipsis
 * @property {boolean} isMinimal
 *
 * @property {boolean} isHelpSeeking
 * @property {boolean} isConfused
 * @property {boolean} isFrustrated
 * @property {boolean} isOffTask
 * @property {boolean} isDisengaged
 * @property {boolean} requestsRepetition
 *
 * @property {number} tokenTrendSlopeLastK
 * @property {number} minimalRateLastK
 * @property {number} helpSeekingRateLastK
 * @property {number} offTaskRateLastK
 * @property {number} disengagedRateLastK
 *
 * @property {boolean} idleGapDetected
 */

/**
 * Extract cues from observable student output.
 *
 * @param {Object} args
 * @param {string} args.studentText
 * @param {ObservableTurn[]=} args.history
 * @param {number=} args.nowMs
 * @param {Object=} args.config Partial override for DEFAULT_CUE_CONFIG
 * @returns {CueOutput}
 */
export function extractCues({ studentText, history = [], nowMs, config = {} }) {
  const cfg = { ...DEFAULT_CUE_CONFIG, ...config };
  const text = normalizeText(studentText);
  const rawText = studentText ?? "";

  const tokenCount = countTokens(text);
  const hasAnyQuestion = rawText.includes("?");

  const isEmptyOrEllipsis =
    text.length === 0 ||
    text === "..." ||
    rawText.trim() === "..." ||
    rawText.trim() === "...";

  const isMinimal = tokenCount <= cfg.minimalTokenThreshold;

  // Phrase-based cues (purely observable from text)
  const isHelpSeeking = containsAny(text, cfg.helpSeekingPhrases) || (hasAnyQuestion && containsAny(text, ["how", "why", "what", "where", "when", "can you"]));
  const isConfused = containsAny(text, cfg.confusionPhrases);
  const isFrustrated = containsAny(text, cfg.frustrationPhrases);
  const isOffTask = containsAny(text, cfg.offTaskPhrases);
  const isDisengaged = isEmptyOrEllipsis || containsAny(rawText.toLowerCase(), cfg.disengagedPhrases);
  const requestsRepetition = containsAny(text, cfg.repetitionRequestPhrases);

  // Rolling window stats for trend-based adaptation (conditions 3 & 4 benefit)
  const windowTurns = lastK(history, cfg.windowK);
  const tokenSeries = windowTurns.map(t => countTokens(normalizeText(t.studentText || "")));

  // Include current turn in the series for trends
  const tokenSeriesWithCurrent = [...tokenSeries, tokenCount];

  const tokenTrendSlopeLastK = slope(tokenSeriesWithCurrent); // + = increasing verbosity; - = shortening replies

  // Rates in the window (history + current)
  const flagsSeries = [...windowTurns, { studentText: rawText }].map(t => {
    const tt = normalizeText(t.studentText || "");
    const tc = countTokens(tt);
    return {
      minimal: tc <= cfg.minimalTokenThreshold,
      help: containsAny(tt, cfg.helpSeekingPhrases),
      offTask: containsAny(tt, cfg.offTaskPhrases),
      disengaged: (tt.length === 0 || tt === "..." || t.studentText?.trim() === "...")
    };
  });

  const minimalRateLastK = rate(flagsSeries, f => f.minimal);
  const helpSeekingRateLastK = rate(flagsSeries, f => f.help);
  const offTaskRateLastK = rate(flagsSeries, f => f.offTask);
  const disengagedRateLastK = rate(flagsSeries, f => f.disengaged);

  // Optional: idle gap detection if timestamps exist
  const { idleGapDetected } = detectIdleGap(windowTurns, nowMs, cfg.idleGapMs);

  return {
    tokenCount,
    hasAnyQuestion,

    isEmptyOrEllipsis,
    isMinimal,

    isHelpSeeking,
    isConfused,
    isFrustrated,
    isOffTask,
    isDisengaged,
    requestsRepetition,

    tokenTrendSlopeLastK,
    minimalRateLastK,
    helpSeekingRateLastK,
    offTaskRateLastK,
    disengagedRateLastK,

    idleGapDetected
  };
}

/* ----------------------------- helpers ----------------------------- */

function normalizeText(input) {
  if (input == null) return "";
  return String(input)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function countTokens(text) {
  const t = (text || "").trim();
  if (!t) return 0;
  // Simple whitespace tokenization (deterministic and sufficient for trends)
  return t.split(/\s+/).filter(Boolean).length;
}

/**
 * containsAny supports both phrase lists (array) and a single phrase.
 * Uses substring matching, intentionally simple and auditable.
 */
function containsAny(text, phrases) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (Array.isArray(phrases)) {
    for (const p of phrases) {
      if (!p) continue;
      if (t.includes(String(p).toLowerCase())) return true;
    }
    return false;
  }
  return t.includes(String(phrases).toLowerCase());
}

function lastK(arr, k) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const kk = Math.max(0, Math.floor(k));
  if (kk === 0) return [];
  return arr.slice(Math.max(0, arr.length - kk));
}

/**
 * Simple least-squares slope over index (0..n-1).
 * Returns 0 for n<2.
 */
function slope(series) {
  const n = series.length;
  if (n < 2) return 0;

  // x = 0..n-1
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = Number(series[i]) || 0;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function rate(items, predicate) {
  if (!items || items.length === 0) return 0;
  let count = 0;
  for (const it of items) if (predicate(it)) count++;
  return count / items.length;
}

function detectIdleGap(windowTurns, nowMs, idleGapMsThreshold) {
  // Only meaningful if we have timestamps
  if (!nowMs || !Array.isArray(windowTurns) || windowTurns.length === 0) {
    return { idleGapDetected: false, idleGapMs: null };
  }
  // Find last turn with a timestamp
  for (let i = windowTurns.length - 1; i >= 0; i--) {
    const ts = windowTurns[i]?.timestampMs;
    if (typeof ts === "number" && Number.isFinite(ts)) {
      const gap = nowMs - ts;
      return {
        idleGapDetected: gap > idleGapMsThreshold,
        idleGapMs: gap
      };
    }
  }
  return { idleGapDetected: false, idleGapMs: null };
}
