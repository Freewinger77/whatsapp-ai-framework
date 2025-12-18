/**
 * Confidence Assessment Utility
 * Determines if the bot should respond or escalate to human
 */

import type { AutoRAGSearchResult } from '../types';

export interface ConfidenceResult {
  score: number;       // 0-1 confidence score
  isConfident: boolean; // Whether to respond or escalate
  reason: string;      // Explanation for the score
}

// Thresholds
const MIN_SCORE = 0.5;
const CONFIDENCE_THRESHOLD = 0.6;

/**
 * Assess confidence based on AutoRAG search results
 */
export function assessConfidence(
  searchResults: AutoRAGSearchResult
): ConfidenceResult {
  const matches = searchResults.matches;

  // No matches at all
  if (matches.length === 0) {
    return {
      score: 0,
      isConfident: false,
      reason: 'No relevant content found in knowledge base',
    };
  }

  // Calculate average relevance score
  const avgScore = matches.reduce((sum, m) => sum + m.score, 0) / matches.length;

  // Check if top match has good relevance
  const topMatch = matches[0];
  const topScore = topMatch?.score || 0;

  // Low relevance scores
  if (topScore < MIN_SCORE) {
    return {
      score: topScore * 0.5,
      isConfident: false,
      reason: `Low relevance score (${(topScore * 100).toFixed(0)}%)`,
    };
  }

  // Calculate final confidence
  let confidence = topScore;

  // Boost if multiple good matches
  if (matches.length >= 2 && avgScore > MIN_SCORE) {
    confidence = Math.min(1, confidence * 1.1);
  }

  // Check content quality
  const totalContentLength = matches.reduce(
    (sum, m) => sum + m.content.length,
    0
  );

  // Very short content might not be helpful
  if (totalContentLength < 100) {
    confidence *= 0.8;
  }

  const isConfident = confidence >= CONFIDENCE_THRESHOLD;

  return {
    score: confidence,
    isConfident,
    reason: isConfident
      ? `High relevance match (${(confidence * 100).toFixed(0)}%)`
      : `Below confidence threshold (${(confidence * 100).toFixed(0)}%)`,
  };
}

/**
 * Keywords that suggest the user might need human help
 */
const ESCALATION_KEYWORDS = [
  'speak to human',
  'talk to someone',
  'real person',
  'agent',
  'customer service',
  'complaint',
  'refund',
  'urgent',
  'emergency',
  'manager',
];

/**
 * Check if user explicitly wants human assistance
 */
export function wantsHumanHelp(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(keyword =>
    lowerMessage.includes(keyword)
  );
}
