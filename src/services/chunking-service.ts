import { randomUUID } from "node:crypto";
import type { DiligenceTower, DocumentChunk } from "../types.js";

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 100;
const APPROX_CHARS_PER_TOKEN = 4;

export class ChunkingService {
  private chunkSize: number;
  private overlap: number;

  private chunksByWorkspace = new Map<string, Map<string, DocumentChunk>>();
  private chunksByDocument = new Map<string, string[]>();

  constructor(chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP) {
    this.chunkSize = chunkSize;
    this.overlap = overlap;
  }

  chunkDocument(params: {
    workspace_id: string;
    document_id: string;
    document_name: string;
    text: string;
    tower?: DiligenceTower;
  }): DocumentChunk[] {
    const existing = this.chunksByDocument.get(
      `${params.workspace_id}:${params.document_id}`
    );
    if (existing && existing.length > 0) {
      const workspaceChunks = this.getWorkspaceChunkMap(params.workspace_id);
      return existing
        .map((id) => workspaceChunks.get(id))
        .filter((c): c is DocumentChunk => c !== undefined);
    }

    const charChunkSize = this.chunkSize * APPROX_CHARS_PER_TOKEN;
    const charOverlap = this.overlap * APPROX_CHARS_PER_TOKEN;

    const text = params.text;
    const chunks: DocumentChunk[] = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + charChunkSize, text.length);

      if (end < text.length) {
        const sentenceEnd = findSentenceBoundary(text, end, charChunkSize);
        if (sentenceEnd > start) {
          end = sentenceEnd;
        }
      }

      const chunkText = text.slice(start, end).trim();
      if (chunkText.length > 0) {
        const chunk: DocumentChunk = {
          chunk_id: randomUUID(),
          document_id: params.document_id,
          workspace_id: params.workspace_id,
          text: chunkText,
          start_offset: start,
          end_offset: end,
          token_estimate: Math.ceil(chunkText.length / APPROX_CHARS_PER_TOKEN),
          embedding: [],
          metadata: {
            document_name: params.document_name,
            tower: params.tower,
          },
        };
        chunks.push(chunk);
      }

      const nextStart = end - charOverlap;
      start = nextStart <= start ? end : nextStart;
    }

    const workspaceMap = this.getWorkspaceChunkMap(params.workspace_id);
    const docKey = `${params.workspace_id}:${params.document_id}`;
    const chunkIds: string[] = [];

    for (const chunk of chunks) {
      workspaceMap.set(chunk.chunk_id, chunk);
      chunkIds.push(chunk.chunk_id);
    }
    this.chunksByDocument.set(docKey, chunkIds);

    return chunks;
  }

  setEmbedding(workspaceId: string, chunkId: string, embedding: number[]): void {
    const chunk = this.getWorkspaceChunkMap(workspaceId).get(chunkId);
    if (chunk) {
      chunk.embedding = embedding;
    }
  }

  getWorkspaceChunks(workspaceId: string): DocumentChunk[] {
    return Array.from(this.getWorkspaceChunkMap(workspaceId).values());
  }

  getDocumentChunks(workspaceId: string, documentId: string): DocumentChunk[] {
    const chunkIds =
      this.chunksByDocument.get(`${workspaceId}:${documentId}`) ?? [];
    const workspaceMap = this.getWorkspaceChunkMap(workspaceId);
    return chunkIds
      .map((id) => workspaceMap.get(id))
      .filter((c): c is DocumentChunk => c !== undefined);
  }

  getChunkCount(workspaceId: string): number {
    return this.getWorkspaceChunkMap(workspaceId).size;
  }

  semanticSearch(
    workspaceId: string,
    queryEmbedding: number[],
    topK: number = 8
  ): Array<{ chunk: DocumentChunk; score: number }> {
    const chunks = this.getWorkspaceChunks(workspaceId);
    const scored: Array<{ chunk: DocumentChunk; score: number }> = [];

    for (const chunk of chunks) {
      if (chunk.embedding.length === 0) continue;
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      scored.push({ chunk, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  keywordSearch(
    workspaceId: string,
    keywords: string[],
    topK: number = 8
  ): Array<{ chunk: DocumentChunk; score: number }> {
    const chunks = this.getWorkspaceChunks(workspaceId);
    const normalizedKeywords = keywords.map((k) => k.toLowerCase().trim());
    const scored: Array<{ chunk: DocumentChunk; score: number }> = [];

    for (const chunk of chunks) {
      const lower = chunk.text.toLowerCase();
      let hits = 0;
      for (const kw of normalizedKeywords) {
        if (kw.length > 0 && lower.includes(kw)) {
          hits++;
        }
      }
      if (hits > 0) {
        scored.push({ chunk, score: hits / normalizedKeywords.length });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  multiPathSearch(
    workspaceId: string,
    queryEmbedding: number[],
    keywords: string[],
    topK: number = 10
  ): Array<{ chunk: DocumentChunk; score: number }> {
    const semanticResults = this.semanticSearch(workspaceId, queryEmbedding, topK);
    const keywordResults = this.keywordSearch(workspaceId, keywords, topK);

    const merged = new Map<string, { chunk: DocumentChunk; score: number }>();

    for (const r of semanticResults) {
      merged.set(r.chunk.chunk_id, {
        chunk: r.chunk,
        score: r.score * 0.7,
      });
    }

    for (const r of keywordResults) {
      const existing = merged.get(r.chunk.chunk_id);
      if (existing) {
        existing.score += r.score * 0.3;
      } else {
        merged.set(r.chunk.chunk_id, {
          chunk: r.chunk,
          score: r.score * 0.3,
        });
      }
    }

    const results = Array.from(merged.values());
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private getWorkspaceChunkMap(
    workspaceId: string
  ): Map<string, DocumentChunk> {
    if (!this.chunksByWorkspace.has(workspaceId)) {
      this.chunksByWorkspace.set(workspaceId, new Map());
    }
    return this.chunksByWorkspace.get(workspaceId)!;
  }
}

function findSentenceBoundary(
  text: string,
  around: number,
  chunkSize: number
): number {
  const searchStart = Math.max(0, around - Math.floor(chunkSize * 0.15));
  const region = text.slice(searchStart, around + 1);
  const sentenceEnders = /[.!?]\s/g;
  let lastEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = sentenceEnders.exec(region)) !== null) {
    lastEnd = searchStart + match.index + match[0].length;
  }
  return lastEnd > 0 ? lastEnd : around;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}
