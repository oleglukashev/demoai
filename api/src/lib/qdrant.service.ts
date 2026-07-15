import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { EMBEDDING_DIMENSIONS, embeddingsEnabled } from './embeddings';

const COLLECTION = process.env.QDRANT_COLLECTION ?? 'demoai_chunks';

export interface ChunkPoint {
  /** Chunk id (a UUID) — Qdrant only accepts UUIDs or unsigned ints as point ids. */
  id: string;
  vector: number[];
  documentId: string;
}

export interface VectorHit {
  chunkId: string;
  score: number;
}

/**
 * Vector storage for chunk embeddings. Postgres remains the source of truth for
 * chunk text; Qdrant holds only vectors keyed by chunk id, plus enough payload
 * (documentId) to delete a document's vectors without touching Postgres.
 */
@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private readonly client = new QdrantClient({
    url: process.env.QDRANT_URL ?? 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility: false,
  });
  private ensured: Promise<void> | null = null;

  async onModuleInit(): Promise<void> {
    if (!embeddingsEnabled()) {
      this.logger.warn(
        'OPENAI_API_KEY is not set — skipping Qdrant setup; retrieval will use the keyword fallback.',
      );
      return;
    }
    // Warm up at boot so misconfiguration surfaces here rather than on first upload.
    try {
      await this.ensureCollection();
      this.logger.log(`Qdrant collection "${COLLECTION}" is ready.`);
    } catch (err) {
      this.ensured = null; // let a later call retry once Qdrant is reachable
      this.logger.error(
        `Qdrant is unreachable — uploads will fail until it is up: ${String(err)}`,
      );
    }
  }

  private ensureCollection(): Promise<void> {
    // Memoized so concurrent uploads don't race on collection creation.
    if (!this.ensured) {
      this.ensured = this.createIfMissing().catch((err) => {
        this.ensured = null;
        throw err;
      });
    }
    return this.ensured;
  }

  private async createIfMissing(): Promise<void> {
    const { exists } = await this.client.collectionExists(COLLECTION);
    if (exists) return;

    await this.client.createCollection(COLLECTION, {
      vectors: { size: EMBEDDING_DIMENSIONS, distance: 'Cosine' },
    });
    // Needed for filtered deletes by document.
    await this.client.createPayloadIndex(COLLECTION, {
      field_name: 'documentId',
      field_schema: 'keyword',
      wait: true,
    });
  }

  async upsertChunks(points: ChunkPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.ensureCollection();
    await this.client.upsert(COLLECTION, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: { documentId: p.documentId },
      })),
    });
  }

  async search(vector: number[], limit: number): Promise<VectorHit[]> {
    await this.ensureCollection();
    const res = await this.client.query(COLLECTION, {
      query: vector,
      limit,
      with_payload: false,
    });
    return res.points.map((p) => ({ chunkId: String(p.id), score: p.score ?? 0 }));
  }

  async deleteByDocument(documentId: string): Promise<void> {
    await this.ensureCollection();
    await this.client.delete(COLLECTION, {
      wait: true,
      filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
    });
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ensureCollection();
    await this.client.delete(COLLECTION, { wait: true, points: ids });
  }
}
