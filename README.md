# Full-Spectrum M&A Due-Diligence Copilot (MCP Server + Widgets)

Federated, provenance-first due-diligence orchestration server built with `mcp-use` for M&A workflows.

This project models a full deal workflow across financial, legal, commercial, operations, HR, tax, and technical/cyber towers with governance gates, scenario modeling, and IC package generation.

## What This Project Includes

- Central orchestrator MCP server (`index.ts`, `src/orchestrator.ts`)
- Federated source ingestion and checksum dedupe
- Canonical entity linking from claims/document text
- Risk signal detection and contradiction detection
- Policy-gated approval workflow for high-impact findings
- Provenance chains for every finding
- Scenario simulation (downside/base/upside/custom)
- Management-ready report generation (IC packages)
- Hash-chained audit ledger
- MCP widget UI (`resources/risk-map/widget.tsx`) for cockpit-style interaction in MCP clients/Inspector

## Architecture Mapping

- `src/orchestrator.ts`: workflow orchestration, tool-facing application layer
- `src/core/event-bus.ts`: in-memory event stream
- `src/core/tower-registry.ts`: federated source definitions + required scopes
- `src/services/workspace-service.ts`: workspace lifecycle + participant access boundaries
- `src/services/evidence-ingestion-service.ts`: artifact ingest + dedupe
- `src/services/canonical-model-service.ts`: claim/doc normalization + entity linking
- `src/services/contradiction-detector-service.ts`: cross-source inconsistency detection
- `src/services/finding-service.ts`: finding lifecycle + dedupe merge behavior
- `src/services/risk-scoring-service.ts`: rule-based signal detection + risk graph computation
- `src/services/scenario-service.ts`: valuation/integration/risk deltas
- `src/services/provenance-service.ts`: finding-to-evidence lineage
- `src/services/approval-service.ts`: approval request + decision model
- `src/services/audit-ledger-service.ts`: immutable-style hash chain
- `src/services/gap-request-service.ts`: missing-evidence elicitation tickets
- `src/services/reporting-service.ts`: IC package compilation
- `resources/risk-map/widget.tsx`: risk cockpit widget

## MCP Tools

Core diligence tools:
- `show_landing_home`
- `create_workspace`
- `submit_deal_intake`
- `ingest_evidence_batch`
- `list_findings`
- `recompute_risk_graph`
- `run_scenarios`
- `analyze_documents_with_openai`
- `request_missing_evidence`
- `approve_finding`
- `generate_ic_package`
- `get_provenance_chain`
- `list_workspace_events`
- `list_audit_ledger`

Demo/workflow helper tools:
- `ingest_demo_source`
- `bootstrap_demo_flow`

Scenario authoring tools:
- `generate_finding_scenarios_plain_english`
- `convert_plain_english_to_scenario_params`
- `run_finding_scenario_story`

## Security and Governance Behaviors

- Tenant-aware access checks and workspace isolation
- Scope-based authorization per source and operation
- Role gating for reviewer-only approval actions
- Automatic approval gate for `high`/`critical` or material findings
- Provenance requirement before non-red-flag IC package generation
- Policy block when unresolved required approvals exist
- Hash-linked audit ledger entries for workflow traceability

## Quick Start

```bash
cd ma-due-diligence-copilot
pnpm install
pnpm dev
```

By default, opening `http://localhost:3000` redirects to the landing widget page.

After server starts, open MCP Inspector and run:
1. `show_landing_home`
2. Use landing widget buttons (`Create New Merger` / `Create New Acquisition`) and submit the intake form
3. `bootstrap_demo_flow`
4. `list_findings` (set `as_widget: true` to render risk-map)
5. `approve_finding` for findings in `requires_approval`
6. `run_scenarios` or `run_finding_scenario_story`
7. `analyze_documents_with_openai` (renders AI findings widget with finding IDs + document names)
8. `generate_ic_package`
9. `list_audit_ledger`

## Demo Actors

Defined in `src/orchestrator.ts`:
- `DEMO_ACTOR`: analyst permissions for ingestion/analysis/reporting
- `REVIEWER_ACTOR`: reviewer permissions including `finding:approve`

## Current Scope and Production Notes

- Current storage is in-memory (process-local)
- Current risk extraction is rule-based (keywords + claim contradiction rules)
- Optional OpenAI document analysis is available via `analyze_documents_with_openai` (requires `OPENAI_API_KEY`)
- Supabase persistence is available via `submit_deal_intake` when configured
- See `SUPABASE_SETUP.md` for table schema and portal setup steps

## Suggested GitHub Repo Description

`Full-spectrum M&A due-diligence copilot using MCP: federated evidence ingestion, risk/contradiction detection, approval governance, scenario modeling, provenance, and IC package generation.`
