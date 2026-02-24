# Full-Spectrum Mergers and Acquisitions Due-Diligence Copilot

An AI-native __Mergers and Acquisitions__ diligence operating system built with `mcp-use`, designed for enterprise deal teams, legal counsel, finance, and integration leadership.

This project turns merger and acquisition diligence from a document-heavy, high-billing-hour workflow into a governed, evidence-first, continuously re-scored intelligence loop.

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

The target outcome is not "no lawyers."  
The target outcome is **fewer low-value hours, faster decisions, and better risk visibility**.

## What It Does

- Creates isolated merger/acquisition workspaces
- Ingests documents from federated sources and Supabase
- Runs OpenAI-based full-document analysis
- Detects contradictions and high-impact risks
- Forces human approval gates for sensitive findings
- Converts plain-English legal scenarios into quantified stress tests
- Generates visual risk graphs and executive report PDFs
- Produces provenance-backed IC decision packages

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
- Compares legal/finance/data-room claims and highlights mismatches.
- Forces evidence-backed reconciliation before committee sign-off.

6. **Decision Pressure Simulation**
- Converts plain-English scenario inputs into model parameters.
- Runs valuation/risk stress tests and returns executive-ready interpretation.

## Product Highlights

- **Provenance-first by design:** every finding links back to evidence.
- **Human-in-the-loop governance:** approve/reject gates for high-impact findings.
- **Executive readability:** concise bullet-point findings and report output.
- **Visual risk intelligence:** graph view + scenario overlays.
- **Approved-only board report:** one-click PDF generation for decision meetings.

## Technical Architecture (High Level)

- `src/orchestrator.ts`: application orchestration layer
- `src/services/*`: workspace, ingestion, contradictions, risk, scenario, approval, reporting, audit
- `index.ts`: MCP server and tool contracts
- `resources/landing-home/widget.tsx`: main product UI (deal intake, findings review, graph/report actions)
- `resources/ai-findings/widget.tsx`: focused findings interaction widget
- `resources/risk-map/widget.tsx`: risk cockpit widget

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
- `analyze_documents_with_openai`
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
- Role and scope enforcement on sensitive actions
- Mandatory approval gating for high-impact findings
- Provenance requirements for decision-ready outputs
- Hash-linked immutable-style audit trail

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
3. Click `Submit Intake + Analyze Documents`.
4. Review findings and approve selected risks.
5. Run plain-English scenarios from legal perspective.
6. View visual graph.
7. Generate approved-only executive PDF report.
8. Generate IC package.

## Current Scope and Notes

- Runtime storage is in-memory for orchestration state
- Supabase persistence is supported for deal/doc intake
- OpenAI analysis requires `OPENAI_API_KEY`
- See `SUPABASE_SETUP.md` for table and storage setup

## Suggested GitHub Repo Description

`AI-native M&A due-diligence copilot: federated evidence ingestion, legal/financial risk detection, contradiction intelligence, approval governance, scenario simulation, visual risk analytics, and executive-ready IC reporting.`
