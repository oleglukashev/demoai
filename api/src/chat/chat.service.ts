import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { extractKeywords } from '../lib/chunking';
import { embedText, keywordScore } from '../lib/embeddings';
import { QdrantService } from '../lib/qdrant.service';

const TOP_K = 5;
const MIN_SIMILARITY = 0.2; // relaxed vs HorecaGPT's 0.35 for the small demo corpus

interface RankedChunk {
  content: string;
  documentName: string;
  score: number;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private prisma: PrismaService,
    private qdrant: QdrantService,
  ) {}

  async ask(message: string): Promise<{ reply: string; sources: string[] }> {
    const chunks = await this.retrieve(message);
    const reply = await this.answer(message, chunks);
    const sources = Array.from(new Set(chunks.map((c) => c.documentName)));
    return { reply, sources };
  }

  /**
   * Retrieve top chunks: cosine search in Qdrant, with the chunk text read back
   * from Postgres. Falls back to keyword overlap when embeddings are unavailable.
   */
  private async retrieve(query: string): Promise<RankedChunk[]> {
    try {
      const queryEmbedding = await embedText(query);
      if (queryEmbedding) return await this.vectorSearch(queryEmbedding);
    } catch (err) {
      // A flaky OpenAI/Qdrant call shouldn't take the chat down — degrade to keywords.
      this.logger.warn(`Vector retrieval failed, using keyword fallback: ${String(err)}`);
    }

    return this.keywordSearch(query);
  }

  private async vectorSearch(queryEmbedding: number[]): Promise<RankedChunk[]> {
    // Qdrant Cosine scores are similarities already — higher is closer.
    const hits = (await this.qdrant.search(queryEmbedding, TOP_K)).filter(
      (h) => h.score >= MIN_SIMILARITY,
    );
    if (hits.length === 0) return [];

    const chunks = await this.prisma.chunk.findMany({
      where: { id: { in: hits.map((h) => h.chunkId) } },
      select: { id: true, content: true, document: { select: { name: true } } },
    });
    const byId = new Map(chunks.map((c) => [c.id, c]));

    // Keep Qdrant's ranking; skip vectors whose chunk is gone from Postgres.
    return hits.flatMap((hit) => {
      const chunk = byId.get(hit.chunkId);
      if (!chunk) return [];
      return [{ content: chunk.content, documentName: chunk.document.name, score: hit.score }];
    });
  }

  private async keywordSearch(query: string): Promise<RankedChunk[]> {
    const all = await this.prisma.chunk.findMany({
      include: { document: { select: { name: true } } },
    });
    const queryKeywords = extractKeywords(query);
    return all
      .map((chunk) => ({
        content: chunk.content,
        documentName: chunk.document.name,
        score: keywordScore(queryKeywords, chunk.content),
      }))
      .filter((c) => c.score >= MIN_SIMILARITY)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);
  }

  /** Build a context prompt from retrieved chunks and let Claude answer. */
  private async answer(message: string, chunks: RankedChunk[]): Promise<string> {
    const context = chunks
      .map((c, i) => `[${i + 1}] (${c.documentName})\n${c.content}`)
      .join('\n\n');

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const system =
          'Ты — AI-ассистент DemoAI. Отвечай на языке пользователя, опираясь только на приведённый контекст из документов. Если ответа в контексте нет — честно скажи об этом.' +
          (context ? `\n\nКонтекст из документов:\n${context}` : '');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-5',
            max_tokens: 1024,
            system,
            messages: [{ role: 'user', content: message }],
          }),
        });
        const data = await res.json();
        return data?.content?.[0]?.text ?? 'Не удалось получить ответ от модели.';
      } catch {
        return 'Ошибка при обращении к модели. Проверьте ANTHROPIC_API_KEY.';
      }
    }

    // Demo fallback (no Anthropic key): show what retrieval found.
    if (chunks.length === 0) {
      return `Вы спросили: «${message}»\n\nВ загруженных документах не нашлось релевантных фрагментов. Демо-режим (ANTHROPIC_API_KEY не задан).`;
    }
    return (
      `Вы спросили: «${message}»\n\n` +
      `Демо-режим (ANTHROPIC_API_KEY не задан). Наиболее релевантные фрагменты из документов:\n\n` +
      chunks
        .map((c, i) => `[${i + 1}] ${c.documentName} (score ${c.score.toFixed(2)}):\n${c.content.slice(0, 300)}${c.content.length > 300 ? '…' : ''}`)
        .join('\n\n')
    );
  }
}
