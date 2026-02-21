# M&A Due-Diligence Orchestrator (Full-Spectrum)

Reference implementation of a federated M&A due-diligence copilot using `mcp-use`.

This example implements:
- Full-spectrum diligence towers: financial, legal/regulatory, commercial, operations, people/HR, tax, technical/cyber
- A central orchestrator MCP server
- Event-driven ingestion and incremental rescoring
- Contradiction detection across source artifacts
- Policy gating + approvals for high-impact findings
- Provenance chains for explainability
- Scenario modeling and IC package generation
- Widget-based risk cockpit (`risk-map`)

## Architecture Mapping

- `src/orchestrator.ts`: orchestration layer (workflow, approvals, notifications, risk recompute)
- `src/core/event-bus.ts`: event bus (`evidence.ingested`, `finding.detected`, `risk.updated`, ...)
- `src/core/tower-registry.ts`: federated source registry + required scopes
- `src/services/workspace-service.ts`: workspace lifecycle and tenant boundaries
- `src/services/evidence-ingestion-service.ts`: ingestion + checksum dedupe
- `src/services/canonical-model-service.ts`: normalization + entity linking
- `src/services/contradiction-detector-service.ts`: cross-source claim contradictions
- `src/services/finding-service.ts`: finding lifecycle + dedupe merge
- `src/services/risk-scoring-service.ts`: signal findings + risk graph
- `src/services/scenario-service.ts`: counterfactual valuation/integration/risk deltas
- `src/services/provenance-service.ts`: evidence lineage per finding
- `src/services/approval-service.ts`: approval workflow
- `src/services/audit-ledger-service.ts`: hash-chained immutable audit entries
- `src/services/gap-request-service.ts`: missing-evidence elicitation requests
- `src/services/reporting-service.ts`: IC packages
- `resources/risk-map/widget.tsx`: cockpit widget

## Tool Contracts Implemented

Required orchestrator tools:
- `ingest_evidence_batch(workspace_id, source_id, batch_manifest)`
- `list_findings(workspace_id, filters)`
- `recompute_risk_graph(workspace_id, scope)`
- `run_scenarios(workspace_id, scenario_set)`
- `request_missing_evidence(workspace_id, finding_id, questionnaire)`
- `approve_finding(workspace_id, finding_id, decision_payload)`
- `generate_ic_package(workspace_id, package_type)`
- `get_provenance_chain(workspace_id, finding_id)`
- `list_audit_ledger(workspace_id)`

Additional workflow helpers:
- `create_workspace`
- `ingest_demo_source`
- `list_workspace_events`
- `bootstrap_demo_flow`
- `generate_finding_scenarios_plain_english`
- `convert_plain_english_to_scenario_params`
- `run_finding_scenario_story`

## Security/Governance Behaviors

- Tenant-aware workspace access checks (deal isolation)
- Scope-based authorization by source and operation
- Role checks for approval operations
- Immutable hash-chained audit ledger for read/write decision traces
- High-impact/high-severity findings auto-gated to `requires_approval`
- IC package generation blocked if unresolved high-impact approvals exist (except red-flag package)
- IC package generation blocked when open findings lack provenance references (except red-flag package)

## Quick Start

```bash
# from this project directory
cd ma-due-diligence-copilot
pnpm install
pnpm dev
```

Alternative (fresh scaffold with official initializer, then copy this code into it):

```bash
npx create-mcp-use-app ma-due-diligence-copilot --template blank --install --no-skills
cd ma-due-diligence-copilot
pnpm dev
```

Then in MCP Inspector:
1. Call `bootstrap_demo_flow`
2. Call `list_findings` (renders `risk-map` widget)
3. Call `approve_finding` for findings in `requires_approval`
4. Call `run_scenarios`
5. Call `generate_ic_package`

## Demo Actors

Defined in `src/orchestrator.ts`:
- `DEMO_ACTOR`: analyst permissions
- `REVIEWER_ACTOR`: includes `finding:approve`

## Notes

- Storage is in-memory for demo purposes.
- Replace services with Postgres/Graph/Kafka implementations for production.
- Domain servers are represented by the federated source registry and demo manifests in this example.
