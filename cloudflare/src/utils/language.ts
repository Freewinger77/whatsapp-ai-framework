/**
 * Language Detection Utility
 * Detects language from text to respond in the same language
 * Supports: English (en), Bahasa Malaysia (ms), Mandarin Chinese (zh)
 */

export type SupportedLanguage = 'en' | 'ms' | 'zh';

// Common words/patterns for language detection
const LANGUAGE_PATTERNS: Record<SupportedLanguage, RegExp[]> = {
  zh: [
    /[\u4e00-\u9fff]/, // Chinese characters
    /[\u3400-\u4dbf]/, // CJK Extension A
  ],
  ms: [
    /\b(saya|anda|kami|mereka|ini|itu|dan|atau|yang|dengan|untuk|pada|dari|ke|di)\b/i,
    /\b(apa|bila|bagaimana|kenapa|mengapa|siapa|mana|berapa)\b/i,
    /\b(boleh|tidak|ada|tiada|sudah|belum|akan|telah)\b/i,
    /\b(terima kasih|selamat|tolong|maaf)\b/i,
  ],
  en: [
    /\b(the|and|or|is|are|was|were|have|has|will|would|can|could)\b/i,
    /\b(what|when|where|why|how|who|which)\b/i,
    /\b(please|thank|thanks|sorry|hello|hi|hey)\b/i,
  ],
};

// Language names for display
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  ms: 'Bahasa Malaysia',
  zh: '中文 (Mandarin)',
};

/**
 * Detect the language of a text message
 * Returns the detected language code
 */
export function detectLanguage(text: string): SupportedLanguage {
  // Check for Chinese characters first (highest priority)
  const chinesePatterns = LANGUAGE_PATTERNS.zh;
  for (const pattern of chinesePatterns) {
    if (pattern.test(text)) {
      return 'zh';
    }
  }

  // Count matches for each language
  const scores: Record<SupportedLanguage, number> = {
    en: 0,
    ms: 0,
    zh: 0,
  };

  // Score Malay patterns
  for (const pattern of LANGUAGE_PATTERNS.ms) {
    const matches = text.match(pattern);
    if (matches) {
      scores.ms += matches.length;
    }
  }

  // Score English patterns
  for (const pattern of LANGUAGE_PATTERNS.en) {
    const matches = text.match(pattern);
    if (matches) {
      scores.en += matches.length;
    }
  }

  // Return language with highest score, default to English
  if (scores.ms > scores.en && scores.ms > 0) {
    return 'ms';
  }

  return 'en'; // Default to English
}

/**
 * Get language instruction for system prompt
 */
export function getLanguageInstruction(language: SupportedLanguage): string {
  switch (language) {
    case 'zh':
      return 'Respond in Mandarin Chinese (简体中文). Use natural, conversational Chinese.';
    case 'ms':
      return 'Respond in Bahasa Malaysia. Use natural, conversational Malay.';
    case 'en':
    default:
      return 'Respond in English. Use natural, conversational English.';
  }
}
