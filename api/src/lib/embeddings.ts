/**
 * Embeddings via OpenAI text-embedding-3-small (1536 dims), stored in Qdrant.
 * When OPENAI_API_KEY is absent, embedding returns null and callers fall back
 * to keyword-overlap scoring over Postgres.
 */

const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

/** OpenAI accepts up to 2048 inputs per request; 96 keeps request bodies modest. */
const BATCH_SIZE = 96;

export function embeddingsEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts.map((t) => t.slice(0, 8000)),
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI embeddings failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const embeddings: number[][] = (data?.data ?? [])
    // The API may return items out of order; `index` maps back to the input.
    .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
    .map((d: { embedding: number[] }) => d.embedding);

  if (embeddings.length !== texts.length) {
    throw new Error(
      `OpenAI returned ${embeddings.length} embeddings for ${texts.length} inputs`,
    );
  }
  return embeddings;
}

/**
 * Embed many texts, batching requests. Returns null when embeddings are disabled,
 * so callers can take the keyword fallback path.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!embeddingsEnabled()) return null;
  if (texts.length === 0) return [];

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    out.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE))));
  }
  return out;
}

export async function embedText(text: string): Promise<number[] | null> {
  const result = await embedTexts([text]);
  return result?.[0] ?? null;
}

/**
 * Fallback scoring when there are no embeddings: fraction of the query's
 * keywords that appear anywhere in the chunk's full text.
 */
export function keywordScore(queryKeywords: string[], chunkText: string): number {
  if (!queryKeywords.length) return 0;
  const haystack = chunkText.toLowerCase();
  const hits = queryKeywords.filter((k) => haystack.includes(k)).length;
  return hits / queryKeywords.length;
}
