/**
 * Chunking via LlamaIndex's SentenceSplitter.
 * Sizes are counted in cl100k_base tokens — the same tokenizer text-embedding-3-small
 * uses — so chunk sizes are exact rather than estimated from character counts.
 */

import { SentenceSplitter } from '@llamaindex/core/node-parser';
import { Document } from '@llamaindex/core/schema';

const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 64;

/** Bumped when the chunking config changes; stored on Document to spot stale chunks. */
export const CHUNKER_VERSION = `llamaindex-sentence-${CHUNK_SIZE}-${CHUNK_OVERLAP}`;

export interface ChunkNode {
  /** LlamaIndex node id_ (UUID) — also the Chunk primary key and Qdrant point id. */
  id: string;
  content: string;
  /** Stable hash of the node's text; identical text always yields the same hash. */
  hash: string;
  startChar?: number;
  endChar?: number;
  tokenCount: number;
}

const splitter = new SentenceSplitter({
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
});

function clean(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function createChunks(content: string): ChunkNode[] {
  const text = clean(content);
  if (!text) return [];

  const nodes = splitter.getNodesFromDocuments([new Document({ text })]);

  return nodes
    .filter((node) => node.text.trim().length > 0)
    .map((node) => ({
      id: node.id_,
      content: node.text,
      hash: node.hash,
      startChar: node.startCharIdx,
      endChar: node.endCharIdx,
      tokenCount: splitter.tokenSize(node.text),
    }));
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'with', 'that', 'this', 'you', 'not', 'но',
  'де', 'het', 'een', 'van', 'is', 'что', 'это', 'как', 'для', 'при', 'или',
]);

/** Lightweight keyword extraction (used for the no-embedding retrieval fallback). */
export function extractKeywords(content: string): string[] {
  const words = (content.toLowerCase().match(/[\p{L}]{3,}/gu) || []).filter(
    (w) => !STOP_WORDS.has(w),
  );
  return Array.from(new Set(words)).slice(0, 20);
}
