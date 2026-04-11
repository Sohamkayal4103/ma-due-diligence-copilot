# Full-Spectrum Mergers and Acquisitions Due-Diligence Copilot

An AI-native __Mergers and Acquisitions__ diligence operating system built with `mcp-use`, designed for enterprise deal teams, legal counsel, finance, and integration leadership.

This project turns merger and acquisition diligence from a document-heavy, high-billing-hour workflow into a governed, evidence-first, continuously re-scored intelligence loop — powered by a **hybrid tiered analysis pipeline** with built-in anti-hallucination safeguards.

## MCP Server link
[MCP Server Link](https://sweet-sunset-f30mi.run.mcp-use.com/mcp)

## Demo Video
[Watch the demo](https://youtu.be/i_Edcn-bJZs?si=d9REwFWg3nuv2mPZ)


## Why This Is A Big Deal

__Mergers and Acquisitions__ is a high-stakes, multi-billion-dollar process where legal and advisory workstreams can dominate deal cost and timeline. In many markets, lawyer and specialist review time commonly runs in the `$100-$200+ / hour` range (and often much higher for senior counsel).

This copilot is built to:
- Replace large portions of repetitive legal/analyst diligence work.
- Reduce avoidable human review errors across thousands of pages.
- Compress billing-heavy hours spent on triage, contradiction checks, and memo drafting.
- Keep lawyers in control for judgment calls and approvals.
- Provide **interactive Q&A** over the entire document corpus so lawyers can drill into evidence on demand.

The target outcome is not "no lawyers."  
The target outcome is **fewer low-value hours, faster decisions, and better risk visibility**.

## What It Does

- Creates isolated merger/acquisition workspaces
- Ingests documents from federated sources and Supabase
- Runs a **3-phase hybrid tiered AI analysis pipeline** with cost-optimized model selection
- Builds a **vector search index** (RAG) for interactive document Q&A
- Detects contradictions across documents at both claim-level and semantic-level
- Applies a **5-layer anti-hallucination pipeline** with automated quote verification
- Forces human approval gates for sensitive findings
- Converts plain-English legal scenarios into quantified stress tests
- Generates visual risk graphs and executive report PDFs
- Produces provenance-backed IC decision packages

## Hybrid Tiered Analysis Architecture

The core innovation is a three-phase pipeline that balances cost, thoroughness, and cross-document reasoning:

```
┌─────────────────────────────────────────────────────────────────┐
│                    DOCUMENT INGESTION                           │
│  Supabase Storage → Binary/Text Resolution → Dedup by SHA-256  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   PHASE 1    │  │  PHASE 1.5   │  │  HEURISTICS  │
│  Universal   │  │ Search Index │  │ Deterministic│
│   Sweep      │  │    Build     │  │  Detectors   │
│              │  │              │  │              │
│ GPT-4.1-mini │  │  Chunk docs  │  │ Regex-based  │
│ every doc    │  │  500-token   │  │ board rights │
│ structured   │  │  segments +  │  │ retention    │
│ JSON output  │  │  100-token   │  │ CSV decline  │
│ + evidence   │  │  overlap     │  │ analysis     │
│   quotes     │  │  Embed via   │  │              │
│              │  │  text-embed- │  │ Never        │
│ Map-reduce   │  │  ding-3-sm   │  │ hallucinate  │
│ for docs     │  │  Store in    │  │              │
│ >30K tokens  │  │  memory      │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       ▼                 ▼                 │
┌──────────────┐  ┌──────────────┐         │
│ QUOTE VERIFY │  │  RAG INDEX   │         │
│              │  │   READY      │◄────────┘
│ Fuzzy-match  │  │              │
│ each quote   │  │ Semantic +   │
│ against src  │  │ keyword +    │
│ Penalize     │  │ entity       │
│ confidence   │  │ multi-path   │
│ if unverified│  │ retrieval    │
└──────┬───────┘  └──────────────┘
       │
       ▼
┌──────────────────────────────────┐
│           PHASE 2                │
│        Deep Dive                 │
│                                  │
│  GPT-4.1 (full model) on        │
│  ~15-20% escalated documents     │
│  (those with high/critical       │
│   findings from Phase 1)         │
│                                  │
│  Includes cross-document context │
│  from ALL Phase 1 summaries      │
│  → inter-doc contradictions      │
│  → dependency detection          │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│           PHASE 3                │
│   Cross-Document Synthesis       │
│                                  │
│  Single GPT-4.1 call over ALL   │
│  summaries + findings from       │
│  Phase 1 and Phase 2             │
│                                  │
│  Detects:                        │
│  • Portfolio-level contradictions│
│  • Coverage gaps                 │
│  • Systemic risk patterns        │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│     GOVERNANCE + OUTPUT          │
│                                  │
│  Policy gating (high/critical    │
│  → requires_approval)            │
│  Provenance chain enforcement    │
│  Hash-chained audit ledger       │
│  IC package generation           │
│  Executive PDF reports           │
└──────────────────────────────────┘
```

### Why Three Phases?

| Phase | Model | Purpose | Cost Profile |
|-------|-------|---------|-------------|
| Phase 1 | GPT-4.1-mini | Broad risk triage of every document | Low (~$0.40/M input tokens) |
| Phase 2 | GPT-4.1 | Deep analysis of escalated high-risk docs (~15-20%) | Higher (~$2/M input tokens), but only on subset |
| Phase 3 | GPT-4.1 | Cross-document synthesis (single call over summaries) | Minimal (small input) |

For a **mid-size deal** (~100 documents, ~25M tokens total), the hybrid approach costs approximately **$35-50** compared to **$50-65** for sending every document through the full model. For **mega-deals** (1,000+ documents), the savings compound to roughly **40-50%** while maintaining finding completeness.

### 5-Layer Anti-Hallucination Pipeline

Every AI-generated finding passes through five verification layers before reaching reviewers:

1. **Structured Output with Mandatory Evidence Quotes** — OpenAI `strict: true` JSON schema mode requires each finding to include `evidence_quotes`: exact verbatim excerpts from the source document.

2. **Automated Quote Verification** — A post-processing step fuzzy-matches each evidence quote against the source text using bigram similarity with a sliding window. Findings with unverifiable quotes get their confidence penalized by up to 40% and are tagged `quote_unverified`.

3. **Deterministic Cross-Check** — Every document is analyzed by both the LLM and regex-based heuristic detectors in parallel. Heuristics never hallucinate. Cross-verification between LLM and heuristic findings increases trust; LLM-only findings are flagged for closer review.

4. **Cross-Document Synthesis Validation** — Phase 3 examines all findings in aggregate and flags inconsistencies or unsupported claims that span documents.

5. **Human-in-the-Loop Governance** — High and critical severity findings automatically gate to `requires_approval`. Reviewer-role actors must approve each one before it can appear in executive reports or IC packages.

### Interactive RAG Q&A Layer

After the analysis pipeline completes, a **multi-path retrieval** layer enables interactive questions over the entire document corpus:

- **Semantic search**: Query is embedded via `text-embedding-3-small`, matched against chunk embeddings using cosine similarity.
- **Keyword search**: Entity names, contract terms, and domain keywords are matched directly in chunk text.
- **Weighted fusion**: Semantic (70%) and keyword (30%) scores are fused and top-K chunks are sent to GPT-4.1 with instructions to cite sources.

This lets lawyers ask questions like "Does the Northwind contract allow termination on acquisition?" and get evidence-grounded answers with cited document excerpts.

## The 6 Boardroom Scenarios (Core Demo Scoring Criteria)

This demo should be judged on how well the product handles these six scenarios end-to-end:

1. **Governance Control Reset**
- Detects post-acquisition governance changes (board composition, equal rights, voting shifts).
- Flags control-risk before Day 1.

2. **Talent Flight & Contract Shock**
- Detects compensation/term changes in employee agreements post-acquisition.
- Flags missing retention mechanisms and potential poaching exposure.

3. **Declining Sector Revenue Trap**
- Reads sales CSVs and identifies sectors with sustained decline.
- Quantifies potential infeasibility and downside risk.

4. **Contractual Fragility Under Change-of-Control**
- Surfaces clauses that can trigger renegotiation/termination at closing.
- Prioritizes legal red flags by impact and confidence.

5. **Contradiction Detection Across Sources**
- Compares legal/finance/data-room claims and highlights mismatches at both claim-level (deterministic) and semantic-level (Phase 3 synthesis).
- Forces evidence-backed reconciliation before committee sign-off.

6. **Decision Pressure Simulation**
- Converts plain-English scenario inputs into model parameters.
- Runs valuation/risk stress tests and returns executive-ready interpretation.

## Product Highlights

- **Hybrid tiered pipeline:** cost-optimized 3-phase analysis with GPT-4.1-mini sweep → GPT-4.1 deep dive → cross-document synthesis.
- **5-layer anti-hallucination:** evidence quotes, automated quote verification, deterministic cross-check, synthesis validation, human approval.
- **Interactive RAG Q&A:** multi-path retrieval (semantic + keyword) over chunked document index for follow-up questions.
- **Provenance-first by design:** every finding links back to evidence with verified quoted spans.
- **Human-in-the-loop governance:** approve/reject gates for high-impact findings.
- **Executive readability:** concise bullet-point findings and report output.
- **Visual risk intelligence:** graph view + scenario overlays.
- **Approved-only board report:** one-click PDF generation for decision meetings.

## Technical Architecture

### Core System

- `src/orchestrator.ts`: application orchestration layer coordinating 12+ services
- `src/types.ts`: all domain types including hybrid pipeline types (`PipelinePhase`, `HybridFinding`, `DocumentChunk`, `Phase1Result`, `Phase2Result`, `Phase3Result`, `QuoteVerificationResult`, `RAGQueryResult`)
- `index.ts`: MCP server, tool contracts, Supabase persistence, and OpenAI integration

### Hybrid Pipeline Services

- `src/services/hybrid-pipeline-service.ts`: orchestrates the 3-phase pipeline — Phase 1 (mini sweep + map-reduce for large docs), Phase 1.5 (chunk + embed), Phase 2 (full model deep dive with cross-doc context), Phase 3 (cross-document synthesis). Also handles RAG query execution.
- `src/services/chunking-service.ts`: document chunking (500-token segments, 100-token overlap, sentence-boundary aware), in-memory vector index, semantic search (cosine similarity), keyword search, and multi-path fusion retrieval.
- `src/services/quote-verification-service.ts`: fuzzy quote matching using bigram similarity with sliding-window search, confidence penalization for unverified quotes.

### Domain Services

- `src/services/workspace-service.ts`: workspace CRUD, tenant isolation, participant management
- `src/services/policy-service.ts`: RBAC with 4-role hierarchy (viewer → analyst → reviewer → admin), scope enforcement, approval policy
- `src/services/evidence-ingestion-service.ts`: batch ingestion with SHA-256 checksum deduplication
- `src/services/canonical-model-service.ts`: entity normalization from claims and inline content
- `src/services/contradiction-detector-service.ts`: claim-ledger pattern for cross-source contradiction detection
- `src/services/finding-service.ts`: finding CRUD with `createOrMerge` deduplication and severity escalation
- `src/services/risk-scoring-service.ts`: 7 keyword-based signal rules + risk graph computation (weighted risk by tower)
- `src/services/scenario-service.ts`: scenario simulation with assumption multipliers
- `src/services/provenance-service.ts`: finding-to-artifact lineage with quoted spans
- `src/services/approval-service.ts`: approval workflow lifecycle
- `src/services/audit-ledger-service.ts`: SHA-256 hash-chained immutable audit log
- `src/services/gap-request-service.ts`: evidence gap questionnaire generation
- `src/services/reporting-service.ts`: IC package generation (executive summary, red flags, day 1-100 priorities)

### Infrastructure

- `src/core/event-bus.ts`: in-memory pub/sub event system for real-time notifications
- `src/core/tower-registry.ts`: 8 federated source definitions mapped to diligence towers
- `src/utils/hash.ts`: deterministic SHA-256 checksum with recursive key sorting

### UI Widgets

- `resources/landing-home/widget.tsx`: main product UI (deal intake, document upload, findings review, scenario runner, visual graph, PDF report)
- `resources/ai-findings/widget.tsx`: focused findings interaction (approve/reject, plain-English scenarios, graph snapshot)
- `resources/risk-map/widget.tsx`: risk cockpit with tower summaries and severity-coded finding list

## MCP Tools

Core workflow:
- `show_landing_home`
- `create_workspace`
- `submit_deal_intake`
- `ingest_evidence_batch`
- `list_findings`
- `recompute_risk_graph`
- `generate_visual_risk_graph`
- `run_scenarios`
- `analyze_documents_with_openai` — runs the full hybrid tiered pipeline (Phase 1 → 1.5 → 2 → 3)
- `query_documents` — RAG Q&A over analyzed document chunks with multi-path retrieval
- `get_pipeline_status` — check hybrid pipeline progress and metrics
- `set_ai_finding_status`
- `run_ai_finding_plaintext_scenario`
- `request_missing_evidence`
- `approve_finding`
- `generate_approved_findings_report`
- `generate_ic_package`
- `get_provenance_chain`
- `list_workspace_events`
- `list_audit_ledger`

Demo helpers:
- `ingest_demo_source`
- `bootstrap_demo_flow`

Scenario authoring:
- `generate_finding_scenarios_plain_english`
- `convert_plain_english_to_scenario_params`
- `run_finding_scenario_story`

## Security and Governance

- Tenant-aware access checks and workspace isolation
- Role and scope enforcement on sensitive actions (4-role RBAC hierarchy)
- Mandatory approval gating for high-impact findings
- Provenance requirements with verified quote spans for decision-ready outputs
- Hash-linked immutable-style audit trail (SHA-256 chained entries)
- Quote verification audit records tracking which findings passed/failed verification

## Quick Start

```bash
cd ma-due-diligence-copilot
pnpm install
pnpm dev
```

Open:
- `http://localhost:3000` (landing widget)
- `http://localhost:3000/mcp` (MCP endpoint)

## Suggested Demo Run

1. Open landing page and create a new merger/acquisition intake.
2. Upload:
   - governance/company structure PDF
   - employee contract PDF
   - sales CSV
3. Click `Submit Intake + Analyze Documents` — this runs the full hybrid pipeline:
   - Phase 1 sweeps all documents with GPT-4.1-mini + heuristics
   - Phase 1.5 chunks and embeds all documents for RAG search
   - Phase 2 deep-dives escalated documents with GPT-4.1
   - Phase 3 synthesizes cross-document findings
4. Review findings (note `phase_source` tags showing which pipeline phase produced each finding).
5. Use `query_documents` to ask follow-up questions about the evidence.
6. Approve selected risks.
7. Run plain-English scenarios from legal perspective.
8. View visual graph.
9. Generate approved-only executive PDF report.
10. Generate IC package.

## Current Scope and Notes

- Runtime storage is in-memory for orchestration state and the vector index
- Supabase persistence is supported for deal/doc intake
- OpenAI analysis requires `OPENAI_API_KEY` (uses both GPT-4.1-mini and GPT-4.1 models, plus text-embedding-3-small for embeddings)
- See `SUPABASE_SETUP.md` for table and storage setup
- For production: vector index would move to pgvector on Supabase; in-memory Maps would become database-backed with proper indexes

## Suggested GitHub Repo Description

`AI-native M&A due-diligence copilot: hybrid tiered analysis pipeline (GPT-4.1-mini sweep → GPT-4.1 deep dive → cross-document synthesis), multi-path RAG Q&A, 5-layer anti-hallucination with quote verification, federated evidence ingestion, contradiction intelligence, approval governance, scenario simulation, and executive-ready IC reporting.`
