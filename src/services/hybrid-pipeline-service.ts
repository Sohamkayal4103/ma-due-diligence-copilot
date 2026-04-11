import { randomUUID } from "node:crypto";
import type {
  DiligenceTower,
  HybridFinding,
  Phase1Result,
  Phase2Result,
  Phase3Result,
  PipelineStatus,
  RAGQueryResult,
  RiskSeverity,
} from "../types.js";
import { ChunkingService, estimateTokens } from "./chunking-service.js";
import { QuoteVerificationService } from "./quote-verification-service.js";

const PHASE1_MODEL = "gpt-4.1-mini";
const PHASE2_MODEL = "gpt-4.1";
const EMBEDDING_MODEL = "text-embedding-3-small";
const PHASE1_TOKEN_LIMIT = 30_000;
const MAP_REDUCE_SEGMENT_SIZE = 25_000;

interface DocumentInput {
  document_id: string;
  document_name: string;
  document_type: string;
  tower?: DiligenceTower;
  source: DocumentSource;
}

type DocumentSource =
  | { type: "file_bytes"; file_name: string; mime_type: string; base64: string; size_bytes: number }
  | { type: "raw_text"; text: string };

interface DeterministicFinding {
  title: string;
  summary: string;
  management_points: string[];
  severity: RiskSeverity;
  tower: DiligenceTower;
  probability: number;
  impact_value: number;
  confidence: number;
}

export class HybridPipelineService {
  private chunking = new ChunkingService();
  private quoteVerifier = new QuoteVerificationService();
  private pipelineStatuses = new Map<string, PipelineStatus>();

  getChunkingService(): ChunkingService {
    return this.chunking;
  }

  getQuoteVerifier(): QuoteVerificationService {
    return this.quoteVerifier;
  }

  async runFullPipeline(params: {
    workspace_id: string;
    documents: DocumentInput[];
    api_key: string;
    max_findings_per_document: number;
    deriveDeterministicFindings: (doc: DocumentInput) => DeterministicFinding[];
  }): Promise<{
    phase1_results: Phase1Result[];
    phase2_results: Phase2Result[];
    phase3_result: Phase3Result;
    all_findings: HybridFinding[];
    pipeline_status: PipelineStatus;
  }> {
    const startTime = Date.now();
    const status: PipelineStatus = {
      workspace_id: params.workspace_id,
      phase1_completed: 0,
      phase1_total: params.documents.length,
      phase2_completed: 0,
      phase2_total: 0,
      phase3_completed: false,
      chunks_indexed: 0,
      total_findings: 0,
      escalated_documents: 0,
      pipeline_duration_ms: 0,
    };
    this.pipelineStatuses.set(params.workspace_id, status);

    // ── Phase 1: Universal Sweep (GPT-4.1-mini) + Heuristics ──
    const phase1Results: Phase1Result[] = [];
    const allFindings: HybridFinding[] = [];

    for (const doc of params.documents) {
      const sourceText = extractSourceText(doc.source);
      const tokenEst = sourceText ? estimateTokens(sourceText) : 0;

      let aiFindings: HybridFinding[];
      let summary: string;

      if (sourceText && tokenEst > PHASE1_TOKEN_LIMIT) {
        const mapReduceResult = await this.mapReduceAnalysis({
          workspace_id: params.workspace_id,
          document: doc,
          source_text: sourceText,
          api_key: params.api_key,
          max_findings: params.max_findings_per_document,
        });
        aiFindings = mapReduceResult.findings;
        summary = mapReduceResult.summary;
      } else {
        const result = await this.callOpenAiAnalysis({
          workspace_id: params.workspace_id,
          document: doc,
          api_key: params.api_key,
          model: PHASE1_MODEL,
          max_findings: params.max_findings_per_document,
          phase: "phase1_sweep",
          cross_doc_context: null,
        });
        aiFindings = result.findings;
        summary = result.summary;
      }

      // Run deterministic heuristics in parallel
      const heuristicFindings = params
        .deriveDeterministicFindings(doc)
        .map((f): HybridFinding => ({
          ...f,
          evidence_quotes: [],
          phase_source: "heuristic",
          quote_verified: true,
          confidence_penalty: 0,
        }));

      // Quote verification for AI findings
      if (sourceText) {
        for (const finding of aiFindings) {
          if (finding.evidence_quotes.length > 0) {
            const results = this.quoteVerifier.verifyQuotes(
              finding.evidence_quotes,
              sourceText
            );
            const penalty = this.quoteVerifier.computeConfidencePenalty(results);
            finding.quote_verified = results.every((r) => r.verified);
            finding.confidence_penalty = penalty;
            if (penalty > 0) {
              finding.confidence = this.quoteVerifier.applyPenalty(
                finding.confidence,
                penalty
              );
            }
          }
        }
      }

      const merged = dedupeFindings([...aiFindings, ...heuristicFindings]);
      const hasHighSeverity = merged.some(
        (f) => f.severity === "high" || f.severity === "critical"
      );

      const phase1Result: Phase1Result = {
        document_id: doc.document_id,
        document_name: doc.document_name,
        model_used: PHASE1_MODEL,
        summary,
        findings: merged,
        escalated: hasHighSeverity,
        token_estimate: tokenEst,
      };
      phase1Results.push(phase1Result);
      allFindings.push(...merged);

      // ── Phase 1.5: Chunk and embed for RAG index ──
      if (sourceText && sourceText.length > 0) {
        const chunks = this.chunking.chunkDocument({
          workspace_id: params.workspace_id,
          document_id: doc.document_id,
          document_name: doc.document_name,
          text: sourceText,
          tower: doc.tower,
        });

        const embeddings = await this.batchEmbed({
          texts: chunks.map((c) => c.text),
          api_key: params.api_key,
        });
        for (let i = 0; i < chunks.length; i++) {
          if (embeddings[i]) {
            this.chunking.setEmbedding(
              params.workspace_id,
              chunks[i]!.chunk_id,
              embeddings[i]!
            );
          }
        }
        status.chunks_indexed += chunks.length;
      }

      status.phase1_completed++;
    }

    // ── Phase 2: Deep Dive (GPT-4.1) on escalated docs ──
    const escalatedDocs = phase1Results.filter((r) => r.escalated);
    status.phase2_total = escalatedDocs.length;
    status.escalated_documents = escalatedDocs.length;

    const crossDocContext = phase1Results
      .map(
        (r) =>
          `[${r.document_name}]: ${r.summary} | Key findings: ${r.findings
            .slice(0, 3)
            .map((f) => f.title)
            .join(", ")}`
      )
      .join("\n");

    const phase2Results: Phase2Result[] = [];
    for (const escalated of escalatedDocs) {
      const doc = params.documents.find(
        (d) => d.document_id === escalated.document_id
      );
      if (!doc) continue;

      const result = await this.callOpenAiAnalysis({
        workspace_id: params.workspace_id,
        document: doc,
        api_key: params.api_key,
        model: PHASE2_MODEL,
        max_findings: params.max_findings_per_document + 2,
        phase: "phase2_deep",
        cross_doc_context: crossDocContext,
      });

      const sourceText = extractSourceText(doc.source);
      if (sourceText) {
        for (const finding of result.findings) {
          if (finding.evidence_quotes.length > 0) {
            const verResults = this.quoteVerifier.verifyQuotes(
              finding.evidence_quotes,
              sourceText
            );
            const penalty =
              this.quoteVerifier.computeConfidencePenalty(verResults);
            finding.quote_verified = verResults.every((r) => r.verified);
            finding.confidence_penalty = penalty;
            if (penalty > 0) {
              finding.confidence = this.quoteVerifier.applyPenalty(
                finding.confidence,
                penalty
              );
            }
          }
        }
      }

      const phase2Result: Phase2Result = {
        document_id: escalated.document_id,
        document_name: escalated.document_name,
        model_used: PHASE2_MODEL,
        summary: result.summary,
        findings: result.findings,
        cross_doc_context_used: true,
      };
      phase2Results.push(phase2Result);

      const newPhase2Findings = result.findings.filter(
        (f) =>
          !allFindings.some(
            (existing) =>
              existing.title.toLowerCase().trim() ===
              f.title.toLowerCase().trim()
          )
      );
      allFindings.push(...newPhase2Findings);

      status.phase2_completed++;
    }

    // ── Phase 3: Cross-Document Synthesis ──
    const phase3Result = await this.runCrossDocumentSynthesis({
      workspace_id: params.workspace_id,
      phase1_results: phase1Results,
      phase2_results: phase2Results,
      api_key: params.api_key,
    });
    allFindings.push(...phase3Result.cross_document_findings);
    status.phase3_completed = true;

    status.total_findings = allFindings.length;
    status.pipeline_duration_ms = Date.now() - startTime;

    return {
      phase1_results: phase1Results,
      phase2_results: phase2Results,
      phase3_result: phase3Result,
      all_findings: allFindings,
      pipeline_status: status,
    };
  }

  async queryDocuments(params: {
    workspace_id: string;
    query: string;
    api_key: string;
    model?: string;
    top_k?: number;
  }): Promise<RAGQueryResult> {
    const topK = params.top_k ?? 8;

    const queryEmbedding = await this.embedSingle(params.query, params.api_key);
    const keywords = extractKeywords(params.query);
    const results = this.chunking.multiPathSearch(
      params.workspace_id,
      queryEmbedding,
      keywords,
      topK
    );

    if (results.length === 0) {
      return {
        answer:
          "No relevant document chunks found for this query. Ensure documents have been analyzed first.",
        source_chunks: [],
        confidence: 0,
      };
    }

    const contextText = results
      .map(
        (r, i) =>
          `[Source ${i + 1} - ${r.chunk.metadata.document_name}]:\n${r.chunk.text}`
      )
      .join("\n\n");

    const model = params.model ?? PHASE2_MODEL;
    const systemPrompt = [
      "You are an M&A due-diligence assistant answering questions based on source documents.",
      "Use ONLY the provided source excerpts to answer. If the sources do not contain enough information, say so.",
      "Cite which source number(s) support each point in your answer.",
      "Be concise, specific, and factual.",
    ].join(" ");

    const userText = [
      `Question: ${params.query}`,
      "",
      "Source excerpts:",
      contextText,
    ].join("\n");

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userText }],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI RAG query failed (${res.status}): ${body}`);
    }

    const responseJson = await res.json();
    const answer = extractOutputText(responseJson);
    const avgScore =
      results.reduce((sum, r) => sum + r.score, 0) / results.length;

    return {
      answer,
      source_chunks: results.map((r) => ({
        chunk_id: r.chunk.chunk_id,
        document_id: r.chunk.document_id,
        document_name: r.chunk.metadata.document_name,
        text: r.chunk.text.slice(0, 300),
        relevance_score: Math.round(r.score * 1000) / 1000,
      })),
      confidence: Math.round(avgScore * 100) / 100,
    };
  }

  getPipelineStatus(workspaceId: string): PipelineStatus | null {
    return this.pipelineStatuses.get(workspaceId) ?? null;
  }

  // ── Internal: OpenAI analysis call ──

  private async callOpenAiAnalysis(params: {
    workspace_id: string;
    document: DocumentInput;
    api_key: string;
    model: string;
    max_findings: number;
    phase: "phase1_sweep" | "phase2_deep";
    cross_doc_context: string | null;
  }): Promise<{ summary: string; findings: HybridFinding[] }> {
    const schema = buildAnalysisSchema();

    const systemParts = [
      "You are a senior M&A due-diligence analyst preparing output for top management.",
      "Analyze the provided source document for diligence risks and opportunities.",
      "Return findings only from evidence in the provided source.",
      "Write concise, specific, plain-English output.",
      "Each finding summary must be one short paragraph (max 2 sentences).",
      "Each finding must include management_points as short bullet-style statements suitable for executives.",
      "Each finding MUST include evidence_quotes: exact verbatim quotes from the source document that support the finding.",
      "Avoid jargon, avoid hedging, avoid long legal prose.",
      "Pay special attention to governance/board-rights changes post-acquisition, employee contract/retention risk, and declining sector trends in sales CSV data where present.",
      "If there are no material findings, return an empty findings array.",
    ];

    if (params.phase === "phase2_deep" && params.cross_doc_context) {
      systemParts.push(
        "IMPORTANT: You have cross-document context from Phase 1 analysis of ALL workspace documents.",
        "Use this context to identify inter-document contradictions, dependencies, and cross-references.",
        "Flag any findings that depend on or conflict with information from other documents."
      );
    }

    const focusDirectives = buildDocumentFocusDirectives(params.document);

    const userTextParts = [
      `Workspace: ${params.workspace_id}`,
      `Document ID: ${params.document.document_id}`,
      `Document Name: ${params.document.document_name}`,
      `Document Type: ${params.document.document_type}`,
      `Analysis Phase: ${params.phase === "phase1_sweep" ? "Phase 1 — Universal Sweep" : "Phase 2 — Deep Dive"}`,
      `Instruction: Analyze the entire source exactly as supplied.`,
      "Focus directives:",
      ...focusDirectives.map((d, i) => `${i + 1}. ${d}`),
      `Maximum findings: ${params.max_findings}`,
    ];

    if (params.cross_doc_context) {
      userTextParts.push(
        "",
        "Cross-document context from Phase 1 analysis:",
        params.cross_doc_context
      );
    }

    const userContent: Array<Record<string, unknown>> = [
      { type: "input_text", text: userTextParts.join("\n") },
    ];

    if (params.document.source.type === "file_bytes") {
      userContent.push({
        type: "input_file",
        filename: params.document.source.file_name,
        file_data: `data:${params.document.source.mime_type};base64,${params.document.source.base64}`,
      });
    } else {
      userContent.push({
        type: "input_text",
        text: params.document.source.text,
      });
    }

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        temperature: 0.1,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemParts.join(" ") }],
          },
          { role: "user", content: userContent },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "ma_hybrid_analysis",
            schema,
            strict: true,
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `OpenAI ${params.phase} analysis failed (${res.status}) for '${params.document.document_name}': ${body}`
      );
    }

    const responseJson = await res.json();
    const responseText = extractOutputText(responseJson);
    const parsed = parseJsonSafe(responseText);
    const docSummary =
      typeof parsed.document_summary === "string"
        ? parsed.document_summary
        : "";
    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];

    const findings: HybridFinding[] = rawFindings
      .slice(0, params.max_findings)
      .map((f: Record<string, unknown>): HybridFinding => ({
        title: String(f.title ?? ""),
        summary: String(f.summary ?? ""),
        management_points: Array.isArray(f.management_points)
          ? f.management_points.map(String).slice(0, 5)
          : [],
        severity: parseSeverity(f.severity),
        tower: parseTower(f.tower),
        probability: clamp01(Number(f.probability ?? 0.5)),
        impact_value: Math.max(0, Math.round(Number(f.impact_value ?? 0))),
        confidence: clamp01(Number(f.confidence ?? 0.5)),
        evidence_quotes: Array.isArray(f.evidence_quotes)
          ? f.evidence_quotes.map(String).filter((q: string) => q.length > 5)
          : [],
        phase_source: params.phase,
        quote_verified: false,
        confidence_penalty: 0,
      }));

    return { summary: docSummary, findings };
  }

  private async mapReduceAnalysis(params: {
    workspace_id: string;
    document: DocumentInput;
    source_text: string;
    api_key: string;
    max_findings: number;
  }): Promise<{ summary: string; findings: HybridFinding[] }> {
    const charSegmentSize = MAP_REDUCE_SEGMENT_SIZE * 4;
    const segments: string[] = [];
    let start = 0;
    while (start < params.source_text.length) {
      segments.push(
        params.source_text.slice(start, start + charSegmentSize)
      );
      start += charSegmentSize;
    }

    const segmentResults: Array<{
      summary: string;
      findings: HybridFinding[];
    }> = [];

    for (const segment of segments) {
      const segDoc: DocumentInput = {
        ...params.document,
        source: { type: "raw_text", text: segment },
      };
      const result = await this.callOpenAiAnalysis({
        workspace_id: params.workspace_id,
        document: segDoc,
        api_key: params.api_key,
        model: PHASE1_MODEL,
        max_findings: params.max_findings,
        phase: "phase1_sweep",
        cross_doc_context: null,
      });
      segmentResults.push(result);
    }

    const allFindings = dedupeFindings(
      segmentResults.flatMap((r) => r.findings)
    );
    const combinedSummary = segmentResults
      .map((r) => r.summary)
      .filter(Boolean)
      .join(" ");

    return {
      summary: combinedSummary,
      findings: allFindings.slice(0, params.max_findings),
    };
  }

  private async runCrossDocumentSynthesis(params: {
    workspace_id: string;
    phase1_results: Phase1Result[];
    phase2_results: Phase2Result[];
    api_key: string;
  }): Promise<Phase3Result> {
    if (params.phase1_results.length === 0) {
      return {
        synthesis_summary: "No documents analyzed.",
        cross_document_findings: [],
        coverage_gaps: [],
      };
    }

    const allSummaries = [
      ...params.phase1_results.map(
        (r) =>
          `[${r.document_name} (Phase 1)]: ${r.summary}\nFindings: ${r.findings.map((f) => `${f.title} (${f.severity})`).join("; ")}`
      ),
      ...params.phase2_results.map(
        (r) =>
          `[${r.document_name} (Phase 2 Deep Dive)]: ${r.summary}\nFindings: ${r.findings.map((f) => `${f.title} (${f.severity})`).join("; ")}`
      ),
    ].join("\n\n");

    const schema = {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        synthesis_summary: { type: "string" as const },
        cross_document_findings: {
          type: "array" as const,
          items: {
            type: "object" as const,
            additionalProperties: false,
            properties: {
              title: { type: "string" as const },
              summary: { type: "string" as const },
              management_points: {
                type: "array" as const,
                items: { type: "string" as const },
              },
              severity: {
                type: "string" as const,
                enum: ["low", "medium", "high", "critical"],
              },
              tower: {
                type: "string" as const,
                enum: [
                  "financial",
                  "legal_regulatory",
                  "commercial_market",
                  "operations_supply_chain",
                  "people_hr",
                  "tax_jurisdiction",
                  "technical_cyber",
                ],
              },
              probability: { type: "number" as const },
              impact_value: { type: "number" as const },
              confidence: { type: "number" as const },
            },
            required: [
              "title",
              "summary",
              "management_points",
              "severity",
              "tower",
              "probability",
              "impact_value",
              "confidence",
            ],
          },
        },
        coverage_gaps: {
          type: "array" as const,
          items: { type: "string" as const },
        },
      },
      required: [
        "synthesis_summary",
        "cross_document_findings",
        "coverage_gaps",
      ],
    };

    const systemPrompt = [
      "You are a senior M&A due-diligence analyst performing cross-document synthesis.",
      "Review ALL document summaries and findings from Phase 1 and Phase 2.",
      "Identify: (1) contradictions between documents, (2) portfolio-level risks that span multiple documents,",
      "(3) coverage gaps where expected diligence areas have no findings.",
      "Return ONLY findings that require cross-document reasoning — do not repeat single-document findings.",
      "Be specific about which documents are involved in each cross-document finding.",
    ].join(" ");

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PHASE2_MODEL,
        temperature: 0.1,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Workspace: ${params.workspace_id}\n\nDocument summaries and findings:\n${allSummaries}`,
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "ma_cross_document_synthesis",
            schema,
            strict: true,
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `OpenAI Phase 3 synthesis failed (${res.status}): ${body}`
      );
    }

    const responseJson = await res.json();
    const responseText = extractOutputText(responseJson);
    const parsed = parseJsonSafe(responseText);

    const crossFindings: HybridFinding[] = (
      Array.isArray(parsed.cross_document_findings)
        ? parsed.cross_document_findings
        : []
    ).map(
      (f: Record<string, unknown>): HybridFinding => ({
        title: String(f.title ?? ""),
        summary: String(f.summary ?? ""),
        management_points: Array.isArray(f.management_points)
          ? f.management_points.map(String).slice(0, 5)
          : [],
        severity: parseSeverity(f.severity),
        tower: parseTower(f.tower),
        probability: clamp01(Number(f.probability ?? 0.5)),
        impact_value: Math.max(0, Math.round(Number(f.impact_value ?? 0))),
        confidence: clamp01(Number(f.confidence ?? 0.5)),
        evidence_quotes: [],
        phase_source: "phase3_synthesis",
        quote_verified: true,
        confidence_penalty: 0,
      })
    );

    return {
      synthesis_summary: String(parsed.synthesis_summary ?? ""),
      cross_document_findings: crossFindings,
      coverage_gaps: Array.isArray(parsed.coverage_gaps)
        ? parsed.coverage_gaps.map(String)
        : [],
    };
  }

  // ── Embedding helpers ──

  private async embedSingle(text: string, apiKey: string): Promise<number[]> {
    const result = await this.batchEmbed({ texts: [text], api_key: apiKey });
    return result[0] ?? [];
  }

  private async batchEmbed(params: {
    texts: string[];
    api_key: string;
  }): Promise<number[][]> {
    if (params.texts.length === 0) return [];

    const batchSize = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < params.texts.length; i += batchSize) {
      const batch = params.texts.slice(i, i + batchSize);

      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: batch.map((t) => t.slice(0, 8000)),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `OpenAI embedding failed (${res.status}): ${body}`
        );
      }

      const json = (await res.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      for (const item of json.data) {
        allEmbeddings.push(item.embedding);
      }
    }

    return allEmbeddings;
  }
}

// ── Helper functions ──

function buildAnalysisSchema() {
  return {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      document_summary: { type: "string" as const },
      findings: {
        type: "array" as const,
        items: {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            title: { type: "string" as const, minLength: 6, maxLength: 90 },
            summary: { type: "string" as const, minLength: 20, maxLength: 240 },
            management_points: {
              type: "array" as const,
              minItems: 2,
              maxItems: 5,
              items: { type: "string" as const, minLength: 6, maxLength: 180 },
            },
            severity: {
              type: "string" as const,
              enum: ["low", "medium", "high", "critical"],
            },
            tower: {
              type: "string" as const,
              enum: [
                "financial",
                "legal_regulatory",
                "commercial_market",
                "operations_supply_chain",
                "people_hr",
                "tax_jurisdiction",
                "technical_cyber",
              ],
            },
            probability: { type: "number" as const },
            impact_value: { type: "number" as const },
            confidence: { type: "number" as const },
            evidence_quotes: {
              type: "array" as const,
              items: { type: "string" as const },
            },
          },
          required: [
            "title",
            "summary",
            "management_points",
            "severity",
            "tower",
            "probability",
            "impact_value",
            "confidence",
            "evidence_quotes",
          ],
        },
      },
    },
    required: ["document_summary", "findings"],
  };
}

function buildDocumentFocusDirectives(doc: DocumentInput): string[] {
  const hints =
    `${doc.document_type} ${doc.document_name}`.toLowerCase();
  const directives: string[] = [
    "Cite concrete evidence from this document only.",
    "Quantify impact where possible and avoid generic wording.",
    "For each finding, include exact verbatim quotes from the document as evidence_quotes.",
  ];

  if (
    hints.includes("governance") ||
    hints.includes("board") ||
    hints.includes("structure")
  ) {
    directives.push(
      "Explicitly check for governance changes after acquisition, including board composition, voting rights, and equal-rights clauses for new board members."
    );
  }
  if (
    hints.includes("employee") ||
    hints.includes("employment") ||
    hints.includes("hr") ||
    hints.includes("contract")
  ) {
    directives.push(
      "Check for employee-term changes post-acquisition: compensation/benefit changes, absence of retention mechanisms, and weak anti-poaching protections."
    );
  }
  if (
    hints.includes("csv") ||
    hints.includes("sales") ||
    hints.includes("revenue") ||
    hints.includes("bookings")
  ) {
    directives.push(
      "If this is sales/revenue data, identify sectors with sustained decline, rank top declining sectors, and explain future infeasibility risk."
    );
  }

  return directives;
}

function dedupeFindings(findings: HybridFinding[]): HybridFinding[] {
  const seen = new Set<string>();
  const result: HybridFinding[] = [];
  for (const f of findings) {
    const key = f.title.trim().toLowerCase().replace(/\s+/g, " ");
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(f);
  }
  return result;
}

function extractSourceText(source: DocumentSource): string | null {
  if (source.type === "raw_text") return source.text;
  try {
    return Buffer.from(source.base64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function extractOutputText(payload: unknown): string {
  const root = payload as Record<string, unknown>;
  if (typeof root.output_text === "string" && root.output_text.length > 0) {
    return root.output_text;
  }
  const output = root.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === "string" && text.trim().length > 0) return text;
      }
    }
  }
  throw new Error("OpenAI response did not include readable text output.");
}

function parseJsonSafe(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1)) as Record<
        string,
        unknown
      >;
    }
    throw new Error("Could not parse JSON from OpenAI response.");
  }
}

function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "can", "shall",
    "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above",
    "below", "between", "out", "off", "over", "under", "again",
    "further", "then", "once", "here", "there", "when", "where",
    "why", "how", "all", "both", "each", "few", "more", "most",
    "other", "some", "such", "no", "nor", "not", "only", "own",
    "same", "so", "than", "too", "very", "just", "because", "but",
    "and", "or", "if", "while", "about", "what", "which", "who",
    "this", "that", "these", "those", "it", "its",
  ]);
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

const VALID_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
function parseSeverity(val: unknown): RiskSeverity {
  const s = String(val ?? "medium").toLowerCase();
  return VALID_SEVERITIES.has(s) ? (s as RiskSeverity) : "medium";
}

const VALID_TOWERS = new Set([
  "financial",
  "legal_regulatory",
  "commercial_market",
  "operations_supply_chain",
  "people_hr",
  "tax_jurisdiction",
  "technical_cyber",
]);
function parseTower(val: unknown): DiligenceTower {
  const t = String(val ?? "legal_regulatory").toLowerCase();
  return VALID_TOWERS.has(t) ? (t as DiligenceTower) : "legal_regulatory";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}
