/**
 * AutoRAG Service
 * Integrates with Cloudflare AI Search (AutoRAG) for content retrieval
 */

import type { Env, AutoRAGSearchResult } from '../types';

/**
 * Search for relevant content using AutoRAG
 * Uses the search endpoint (retrieval only, no LLM generation)
 */
export async function searchContent(
  env: Env,
  query: string,
  options: { rewrite?: boolean } = {}
): Promise<AutoRAGSearchResult> {
  try {
    const autorag = env.AI.autorag(env.AUTORAG_NAME);

    // Use search (not aiSearch) to get just the relevant content
    // This allows us to use our own LLM for generation
    const result = await autorag.search({
      query,
      rewrite: options.rewrite ?? true, // Enable query rewriting for better results
    });

    console.log(`[AutoRAG] Found ${result.matches.length} matches for query: "${query.substring(0, 50)}..."`);

    return result;
  } catch (error) {
    console.error('[AutoRAG] Search error:', error);

    // Return empty result on error (graceful degradation)
    return {
      matches: [],
    };
  }
}

/**
 * Search with AI-generated response (uses Workers AI)
 * Use this if you want to use Cloudflare's built-in LLM instead of OpenAI/Gemini
 */
export async function searchWithAI(
  env: Env,
  query: string
): Promise<{ response: string; matches: AutoRAGSearchResult['matches'] }> {
  try {
    const autorag = env.AI.autorag(env.AUTORAG_NAME);

    const result = await autorag.aiSearch({
      query,
      rewrite: true,
    });

    return {
      response: result.response,
      matches: result.matches,
    };
  } catch (error) {
    console.error('[AutoRAG] AI Search error:', error);

    return {
      response: 'I apologize, but I encountered an error searching for information. Please try again.',
      matches: [],
    };
  }
}

/**
 * Format search results for inclusion in LLM prompt
 */
export function formatSearchResults(results: AutoRAGSearchResult): string {
  if (results.matches.length === 0) {
    return 'No relevant information found in the knowledge base.';
  }

  return results.matches
    .map((match, index) => {
      const source = match.metadata.filename || match.metadata.source || 'Unknown source';
      return `[Source ${index + 1}: ${source}]\n${match.content}`;
    })
    .join('\n\n---\n\n');
}
