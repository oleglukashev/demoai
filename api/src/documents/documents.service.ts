import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CHUNKER_VERSION, ChunkNode, createChunks, extractKeywords } from '../lib/chunking';
import { embedTexts, embeddingsEnabled } from '../lib/embeddings';
import { QdrantService } from '../lib/qdrant.service';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private qdrant: QdrantService,
  ) {}

  /**
   * Store the document and its chunks in Postgres, and the chunk vectors in Qdrant.
   * Embeddings are computed before any write, so an OpenAI failure leaves nothing behind.
   */
  async create(name: string, content: string) {
    const nodes = createChunks(content);
    const embeddings = await embedTexts(nodes.map((n) => n.content));

    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: { name, content, chunkerVersion: CHUNKER_VERSION },
      });
      if (nodes.length > 0) {
        await tx.chunk.createMany({
          data: nodes.map((node, i) => this.chunkRow(node, created.id, i)),
        });
      }
      return created;
    });

    if (embeddings) {
      try {
        await this.qdrant.upsertChunks(
          nodes.map((node, i) => ({
            id: node.id,
            vector: embeddings[i],
            documentId: doc.id,
          })),
        );
      } catch (err) {
        // Don't leave a document whose chunks can never be retrieved.
        await this.prisma.document.delete({ where: { id: doc.id } });
        throw err;
      }
    }

    return this.findOne(doc.id);
  }

  /**
   * Re-chunk a document from its stored text — needed after the chunker config
   * changes. Chunks whose text is unchanged keep their row and their vector
   * (matched by LlamaIndex's content hash), so only genuinely new text is embedded.
   */
  async reindex(id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: { chunks: { select: { id: true, hash: true } } },
    });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);

    const nodes = createChunks(doc.content);

    // Same text can legitimately appear twice, so pool the ids per hash and take one each.
    const available = new Map<string, string[]>();
    for (const chunk of doc.chunks) {
      const pool = available.get(chunk.hash);
      if (pool) pool.push(chunk.id);
      else available.set(chunk.hash, [chunk.id]);
    }

    const reused: { id: string; index: number }[] = [];
    const fresh: { node: ChunkNode; index: number }[] = [];
    nodes.forEach((node, index) => {
      const match = available.get(node.hash)?.shift();
      if (match) reused.push({ id: match, index });
      else fresh.push({ node, index });
    });

    const reusedIds = new Set(reused.map((r) => r.id));
    const staleIds = doc.chunks.map((c) => c.id).filter((cid) => !reusedIds.has(cid));

    const embeddings = await embedTexts(fresh.map((f) => f.node.content));

    await this.prisma.$transaction([
      ...reused.map((r) =>
        this.prisma.chunk.update({ where: { id: r.id }, data: { index: r.index } }),
      ),
      this.prisma.chunk.deleteMany({ where: { id: { in: staleIds } } }),
      this.prisma.chunk.createMany({
        data: fresh.map((f) => this.chunkRow(f.node, doc.id, f.index)),
      }),
      this.prisma.document.update({
        where: { id: doc.id },
        data: { chunkerVersion: CHUNKER_VERSION },
      }),
    ]);

    if (embeddings) {
      try {
        await this.qdrant.deleteByIds(staleIds);
        await this.qdrant.upsertChunks(
          fresh.map((f, i) => ({
            id: f.node.id,
            vector: embeddings[i],
            documentId: doc.id,
          })),
        );
      } catch (err) {
        // Drop the rows we just added: reuse matches on hash, so a chunk row that
        // outlived its failed upsert would be treated as already-embedded forever.
        // Removing them lets a repeat reindex rebuild the missing vectors.
        await this.prisma.chunk.deleteMany({
          where: { id: { in: fresh.map((f) => f.node.id) } },
        });
        throw err;
      }
    }

    return {
      id: doc.id,
      chunks: nodes.length,
      reused: reused.length,
      embedded: fresh.length,
      deleted: staleIds.length,
    };
  }

  async findAll() {
    return this.prisma.document.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        chunkerVersion: true,
        _count: { select: { chunks: true } },
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        createdAt: true,
        chunkerVersion: true,
        _count: { select: { chunks: true } },
      },
    });
  }

  async remove(id: string) {
    // Vectors first: an orphaned vector would surface in search with no text behind it.
    if (embeddingsEnabled()) await this.qdrant.deleteByDocument(id);
    await this.prisma.document.delete({ where: { id } });
    return { ok: true };
  }

  private chunkRow(node: ChunkNode, documentId: string, index: number) {
    return {
      id: node.id, // LlamaIndex node id — also the Qdrant point id
      documentId,
      index,
      content: node.content,
      hash: node.hash,
      startChar: node.startChar,
      endChar: node.endChar,
      tokenCount: node.tokenCount,
      keywords: JSON.stringify(extractKeywords(node.content)),
    };
  }
}
