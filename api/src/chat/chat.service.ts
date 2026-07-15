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
  // Read in the instance, not at module load, so `dotenv` has already run.
  private readonly chatModel = process.env.OPENAI_CHAT_MODEL ?? 'gpt-5.4-mini';

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

  /** Build a context prompt from retrieved chunks and let the model answer. */
  private async answer(message: string, chunks: RankedChunk[]): Promise<string> {
    const context = chunks
      .map((c, i) => `[${i + 1}] (${c.documentName})\n${c.content}`)
      .join('\n\n');

    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        const system =
          'Ты — AI-ассистент DemoAI. Отвечай на языке пользователя, опираясь только на приведённый контекст из документов. Если ответа в контексте нет — честно скажи об этом.' +
          (context ? `\n\nКонтекст из документов:\n${context}` : '');
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: this.chatModel,
            // On gpt-5-class models this budget also covers hidden reasoning tokens:
            // set it too low and the answer comes back empty. `max_tokens` is rejected
            // outright by those models, so keep this parameter for every family.
            max_completion_tokens: 1024,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: message },
            ],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
        return (
          data?.choices?.[0]?.message?.content?.trim() ||
          'Не удалось получить ответ от модели.'
        );
      } catch (err) {
        this.logger.error(`OpenAI chat failed: ${String(err)}`);
        return 'Ошибка при обращении к модели. Проверьте OPENAI_API_KEY.';
      }
    }

    // Demo fallback (no key): show what retrieval found.
    if (chunks.length === 0) {
      return `Вы спросили: «${message}»\n\nВ загруженных документах не нашлось релевантных фрагментов. Демо-режим (OPENAI_API_KEY не задан).`;
    }
    return (
      `Вы спросили: «${message}»\n\n` +
      `Демо-режим (OPENAI_API_KEY не задан). Наиболее релевантные фрагменты из документов:\n\n` +
      chunks
        .map((c, i) => `[${i + 1}] ${c.documentName} (score ${c.score.toFixed(2)}):\n${c.content.slice(0, 300)}${c.content.length > 300 ? '…' : ''}`)
        .join('\n\n')
    );
  }
}
