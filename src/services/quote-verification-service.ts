import type { QuoteVerificationResult } from "../types.js";

const DEFAULT_THRESHOLD = 0.85;
const CONFIDENCE_PENALTY = 0.4;

export class QuoteVerificationService {
  private threshold: number;

  constructor(threshold = DEFAULT_THRESHOLD) {
    this.threshold = threshold;
  }

  verifyQuotes(
    quotes: string[],
    sourceText: string
  ): QuoteVerificationResult[] {
    if (!sourceText || sourceText.length === 0) {
      return quotes.map((quote) => ({
        quote,
        verified: false,
        best_match_score: 0,
        matched_span: "",
      }));
    }

    const normalizedSource = normalizeText(sourceText);

    return quotes.map((quote) => {
      if (!quote || quote.trim().length < 8) {
        return {
          quote,
          verified: false,
          best_match_score: 0,
          matched_span: "",
        };
      }

      const normalizedQuote = normalizeText(quote);
      const result = slidingWindowMatch(
        normalizedQuote,
        normalizedSource,
        this.threshold
      );

      return {
        quote,
        verified: result.score >= this.threshold,
        best_match_score: Math.round(result.score * 1000) / 1000,
        matched_span: result.matched_span,
      };
    });
  }

  computeConfidencePenalty(
    results: QuoteVerificationResult[]
  ): number {
    if (results.length === 0) return 0;

    const unverifiedCount = results.filter((r) => !r.verified).length;
    if (unverifiedCount === 0) return 0;

    const unverifiedRatio = unverifiedCount / results.length;
    return Math.round(unverifiedRatio * CONFIDENCE_PENALTY * 100) / 100;
  }

  applyPenalty(
    originalConfidence: number,
    penalty: number
  ): number {
    const penalized = originalConfidence - penalty;
    return Math.max(0.05, Math.round(penalized * 100) / 100);
  }
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slidingWindowMatch(
  needle: string,
  haystack: string,
  threshold: number
): { score: number; matched_span: string } {
  if (haystack.includes(needle)) {
    const idx = haystack.indexOf(needle);
    return {
      score: 1.0,
      matched_span: haystack.slice(idx, idx + needle.length),
    };
  }

  const windowSize = needle.length;
  if (windowSize === 0 || haystack.length === 0) {
    return { score: 0, matched_span: "" };
  }

  let bestScore = 0;
  let bestSpan = "";

  const step = Math.max(1, Math.floor(windowSize / 4));
  const maxStart = haystack.length - Math.floor(windowSize * 0.5);

  for (let i = 0; i < maxStart; i += step) {
    const end = Math.min(i + windowSize + Math.floor(windowSize * 0.3), haystack.length);
    const window = haystack.slice(i, end);
    const score = similarity(needle, window);

    if (score > bestScore) {
      bestScore = score;
      bestSpan = window;
      if (score >= threshold) break;
    }
  }

  if (bestScore >= threshold * 0.9 && step > 1) {
    const refineStart = Math.max(
      0,
      haystack.indexOf(bestSpan) - step
    );
    const refineEnd = Math.min(
      haystack.length,
      haystack.indexOf(bestSpan) + bestSpan.length + step
    );
    for (let i = refineStart; i < refineEnd; i++) {
      const end = Math.min(i + windowSize + Math.floor(windowSize * 0.3), haystack.length);
      const window = haystack.slice(i, end);
      const score = similarity(needle, window);
      if (score > bestScore) {
        bestScore = score;
        bestSpan = window;
      }
    }
  }

  return { score: bestScore, matched_span: bestSpan };
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const bigramsA = buildBigrams(a);
  const bigramsB = buildBigrams(b);

  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let intersection = 0;
  for (const [bigram, countA] of bigramsA) {
    const countB = bigramsB.get(bigram) ?? 0;
    intersection += Math.min(countA, countB);
  }

  let totalA = 0;
  for (const count of bigramsA.values()) totalA += count;
  let totalB = 0;
  for (const count of bigramsB.values()) totalB += count;

  return (2 * intersection) / (totalA + totalB);
}

function buildBigrams(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const bigram = text.slice(i, i + 2);
    map.set(bigram, (map.get(bigram) ?? 0) + 1);
  }
  return map;
}
