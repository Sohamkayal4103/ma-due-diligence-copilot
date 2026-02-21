import { MCPServer, object, widget } from "mcp-use/server";
import { z } from "zod";
import {
  buildDefaultScenarioSet,
  buildDemoBatchForSource,
  DEMO_ACTOR,
  DueDiligenceOrchestrator,
  REVIEWER_ACTOR,
} from "./src/orchestrator.js";
import type { Finding, ScenarioDefinition, ScenarioResult } from "./src/types.js";

const server = new MCPServer({
  name: "ma-due-diligence-orchestrator",
  version: "1.0.0",
  description:
    "Full-spectrum federated M&A due-diligence orchestration server with provenance-first risk intelligence.",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
});

const orchestrator = new DueDiligenceOrchestrator();
const demoWorkspace = orchestrator.seedDemoWorkspace();

const actorSchema = z.object({
  user_id: z.string(),
  tenant_id: z.string(),
  role: z.enum(["admin", "reviewer", "analyst", "viewer"]),
  scopes: z.array(z.string()),
});

const evidenceClaimSchema = z.object({
  subject: z.string(),
  field: z.string(),
  value: z.string(),
});

const scenarioSchema = z.object({
  name: z.string(),
  assumptions: z.record(z.string(), z.number()),
});

orchestrator.events.subscribeAll(async (event) => {
  try {
    await server.sendNotification("notifications/ma/event", event as any);
  } catch {
    // Ignore when no active sessions are listening.
  }
});

server.app.get("/health", (c) => c.json({ status: "ok", service: "ma-dd" }));
server.app.get("/workspace/demo", (c) => c.json(demoWorkspace));

server.tool(
  {
    name: "create_workspace",
    description: "Create a new deal workspace with tenant isolation and policy profile.",
    schema: z.object({
      tenant_id: z.string(),
      deal_name: z.string(),
      thesis: z.string(),
      policy_profile: z.string().optional(),
      materiality_threshold: z.number().positive().optional(),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ tenant_id, deal_name, thesis, policy_profile, materiality_threshold, actor }) => {
    const workspace = orchestrator.createWorkspace(
      {
        tenant_id,
        deal_name,
        thesis,
        policy_profile,
        materiality_threshold,
      },
      actor
    );

    return object({ workspace });
  }
);

server.tool(
  {
    name: "ingest_evidence_batch",
    description:
      "Ingest source artifacts, dedupe by checksum, normalize entities, detect contradictions/signals, and rescore risk.",
    schema: z.object({
      workspace_id: z.string(),
      source_id: z.string(),
      batch_manifest: z.object({
        source_server: z.string().optional(),
        artifacts: z.array(
          z.object({
            source_uri: z.string(),
            classification: z.string(),
            content: z.string(),
            tower: z
              .enum([
                "financial",
                "legal_regulatory",
                "commercial_market",
                "operations_supply_chain",
                "people_hr",
                "tax_jurisdiction",
                "technical_cyber",
              ])
              .optional(),
            captured_at: z.string().optional(),
            claims: z.array(evidenceClaimSchema).optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          })
        ),
      }),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ workspace_id, source_id, batch_manifest, actor }) => {
    const result = await orchestrator.ingestEvidenceBatch({
      workspace_id,
      source_id,
      batch_manifest,
      actor,
    });

    return object(result);
  }
);

server.tool(
  {
    name: "ingest_demo_source",
    description:
      "Convenience tool for loading demo evidence from one federated source into the demo workflow.",
    schema: z.object({
      workspace_id: z.string().default("demo-deal-001"),
      source_id: z.enum([
        "dataroom_vdr",
        "finance_erp",
        "legal_contracts",
        "hr_org",
        "market_intel",
        "operations_supply",
        "tax_records",
        "security_it",
      ]),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: false },
  },
  async ({ workspace_id, source_id, actor }) => {
    const batch_manifest = buildDemoBatchForSource(source_id);
    const result = await orchestrator.ingestEvidenceBatch({
      workspace_id,
      source_id,
      batch_manifest,
      actor: actor ?? DEMO_ACTOR,
    });
    return object(result);
  }
);

server.tool(
  {
    name: "list_findings",
    description:
      "List findings by tower/severity/status; can render the risk-map widget for cockpit-style consumption.",
    schema: z.object({
      workspace_id: z.string(),
      filters: z
        .object({
          tower: z
            .enum([
              "financial",
              "legal_regulatory",
              "commercial_market",
              "operations_supply_chain",
              "people_hr",
              "tax_jurisdiction",
              "technical_cyber",
            ])
            .optional(),
          severity: z.enum(["low", "medium", "high", "critical"]).optional(),
          status: z
            .enum([
              "open",
              "requires_approval",
              "approved",
              "rejected",
              "resolved",
            ])
            .optional(),
          min_impact: z.number().optional(),
          tag: z.string().optional(),
        })
        .optional(),
      as_widget: z.boolean().default(true),
      actor: actorSchema.optional(),
    }),
    widget: {
      name: "risk-map",
      invoking: "Loading risk map...",
      invoked: "Risk map ready",
    },
    annotations: { readOnlyHint: true },
  },
  async ({ workspace_id, filters, as_widget, actor }) => {
    const findings = orchestrator.listFindings({ workspace_id, filters, actor });
    const graph = orchestrator.recomputeRiskGraph({ workspace_id, actor });

    if (as_widget) {
      return widget({
        props: {
          workspace_id,
          findings: findings.slice(0, 50),
          graph,
        },
        message: `Loaded ${findings.length} findings for workspace '${workspace_id}'.`,
      });
    }

    return object({ workspace_id, findings, risk_graph: graph });
  }
);

server.tool(
  {
    name: "recompute_risk_graph",
    description: "Recompute weighted risk graph and tower-level summaries from current findings.",
    schema: z.object({
      workspace_id: z.string(),
      scope: z
        .object({
          towers: z.array(z.string()).optional(),
        })
        .optional(),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ workspace_id, scope, actor }) => {
    const graph = orchestrator.recomputeRiskGraph({ workspace_id, scope, actor });
    return object({ ...graph });
  }
);

server.tool(
  {
    name: "run_scenarios",
    description:
      "Run downside/base/upside or custom scenario assumptions and return valuation/integration/risk deltas.",
    schema: z.object({
      workspace_id: z.string(),
      scenario_set: z.array(scenarioSchema).optional(),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: false },
  },
  async ({ workspace_id, scenario_set, actor }) => {
    const results = orchestrator.runScenarios({
      workspace_id,
      scenario_set:
        scenario_set && scenario_set.length > 0
          ? scenario_set
          : buildDefaultScenarioSet(),
      actor,
    });

    return object({
      workspace_id,
      scenario_count: results.length,
      scenarios: results,
    });
  }
);

server.tool(
  {
    name: "generate_finding_scenarios_plain_english",
    description:
      "Generate plain-English scenario narratives and suggested parameters anchored to a specific finding.",
    schema: z.object({
      workspace_id: z.string(),
      finding_id: z.string(),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ workspace_id, finding_id, actor }) => {
    const finding = orchestrator.getFinding({
      workspace_id,
      finding_id,
      actor,
    });
    const proposals = generateScenarioProposalsFromFinding(finding);

    return object({
      workspace_id,
      finding: summarizeFindingForScenario(finding),
      proposals: proposals.map((proposal) => ({
        name: proposal.name,
        plain_english: proposal.plain_english,
        rationale: proposal.rationale,
        assumptions: scenarioAssumptionsToRecord(proposal.assumptions),
      })),
      note:
        "These assumptions are approximations. Calibrate them with finance/legal/integration owners before final decisions.",
    });
  }
);

server.tool(
  {
    name: "convert_plain_english_to_scenario_params",
    description:
      "Convert plain-English scenario wording into downside/synergy/integration parameters used by run_scenarios.",
    schema: z.object({
      plain_english: z.string().min(12),
      workspace_id: z.string().optional(),
      finding_id: z.string().optional(),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ plain_english, workspace_id, finding_id, actor }) => {
    let finding: Finding | undefined;

    if (finding_id) {
      if (!workspace_id) {
        throw new Error("workspace_id is required when finding_id is provided");
      }
      finding = orchestrator.getFinding({
        workspace_id,
        finding_id,
        actor,
      });
    }

    const parsed = convertPlainEnglishToScenarioParameters(plain_english, finding);

    return object({
      input: plain_english,
      anchored_finding: finding ? summarizeFindingForScenario(finding) : null,
      parameters: scenarioAssumptionsToRecord(parsed.assumptions),
      explanation: {
        signals: parsed.signals,
        caveats: parsed.caveats,
        summary_for_business: plainEnglishAssumptionSummary(parsed.assumptions),
      },
    });
  }
);

server.tool(
  {
    name: "run_finding_scenario_story",
    description:
      "One-click flow: generate scenario text from a finding, optionally parse custom plain English assumptions, run scenarios, and explain outputs for management.",
    schema: z.object({
      workspace_id: z.string(),
      finding_id: z.string(),
      plain_english: z.string().optional(),
      include_generated_set: z.boolean().default(true),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: false },
  },
  async ({ workspace_id, finding_id, plain_english, include_generated_set, actor }) => {
    const finding = orchestrator.getFinding({
      workspace_id,
      finding_id,
      actor,
    });
    const generatedProposals = generateScenarioProposalsFromFinding(finding);

    const scenarioSet: ScenarioDefinition[] = [];
    if (include_generated_set) {
      for (const proposal of generatedProposals) {
        scenarioSet.push({
          name: proposal.name,
          assumptions: scenarioAssumptionsToRecord(proposal.assumptions),
        });
      }
    }

    let customConversion:
      | {
          assumptions: Record<string, number>;
          signals: string[];
          caveats: string[];
        }
      | null = null;

    if (plain_english && plain_english.trim().length > 0) {
      const parsed = convertPlainEnglishToScenarioParameters(plain_english, finding);
      customConversion = {
        assumptions: scenarioAssumptionsToRecord(parsed.assumptions),
        signals: parsed.signals,
        caveats: parsed.caveats,
      };

      scenarioSet.push({
        name: "custom_plain_english_case",
        assumptions: customConversion.assumptions,
      });
    }

    if (scenarioSet.length === 0) {
      const base = baselineAssumptionsFromFinding(finding);
      scenarioSet.push({
        name: "finding_base_case",
        assumptions: scenarioAssumptionsToRecord(base),
      });
    }

    const scenarioResults = orchestrator.runScenarios({
      workspace_id,
      scenario_set: scenarioSet,
      actor,
    });
    const riskGraph = orchestrator.recomputeRiskGraph({
      workspace_id,
      actor,
    });

    return object({
      workspace_id,
      finding: summarizeFindingForScenario(finding),
      portfolio_note:
        "run_scenarios evaluates all findings in this workspace. finding_id is used to anchor assumptions and story framing.",
      scenario_set_used: scenarioSet,
      generated_scenarios_plain_english: include_generated_set
        ? generatedProposals
        : [],
      custom_plain_english_conversion: customConversion,
      run_scenarios_output: {
        scenario_count: scenarioResults.length,
        scenarios: scenarioResults,
      },
      risk_graph_snapshot: riskGraph,
      management_brief: buildManagementBrief({
        finding,
        scenarioSet,
        results: scenarioResults,
      }),
    });
  }
);

server.tool(
  {
    name: "request_missing_evidence",
    description:
      "Open adaptive diligence elicitation requests for unresolved high-impact evidence gaps.",
    schema: z.object({
      workspace_id: z.string(),
      finding_id: z.string(),
      questionnaire: z.array(
        z.object({
          prompt: z.string(),
          required: z.boolean().optional(),
        })
      ),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: false },
  },
  async ({ workspace_id, finding_id, questionnaire, actor }) => {
    const request = orchestrator.requestMissingEvidence({
      workspace_id,
      finding_id,
      questionnaire,
      actor,
    });

    return object({ request });
  }
);

server.tool(
  {
    name: "approve_finding",
    description: "Reviewer decision gate for high-impact findings before IC package generation.",
    schema: z.object({
      workspace_id: z.string(),
      finding_id: z.string(),
      decision_payload: z.object({
        decision: z.enum(["approved", "rejected"]),
        reason: z.string().min(8),
      }),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: false },
  },
  async ({ workspace_id, finding_id, decision_payload, actor }) => {
    const result = orchestrator.approveFinding({
      workspace_id,
      finding_id,
      decision_payload,
      actor: actor ?? REVIEWER_ACTOR,
    });
    return object(result);
  }
);

server.tool(
  {
    name: "generate_ic_package",
    description:
      "Generate decision-ready investment committee packages with red flags, assumptions, scenarios, and negotiation levers.",
    schema: z.object({
      workspace_id: z.string(),
      package_type: z.enum([
        "executive_summary",
        "full_ic",
        "red_flag_register",
        "day1_day100",
      ]),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: false },
  },
  async ({ workspace_id, package_type, actor }) => {
    const pkg = orchestrator.generateIcPackage({
      workspace_id,
      package_type,
      actor,
    });

    return object({ package: pkg });
  }
);

server.tool(
  {
    name: "get_provenance_chain",
    description: "Return evidence-to-conclusion lineage for a finding.",
    schema: z.object({
      workspace_id: z.string(),
      finding_id: z.string(),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ workspace_id, finding_id, actor }) => {
    const chain = orchestrator.getProvenanceChain({
      workspace_id,
      finding_id,
      actor,
    });

    return object({ workspace_id, finding_id, provenance_chain: chain });
  }
);

server.tool(
  {
    name: "list_workspace_events",
    description: "List event stream records for debugging orchestration and notifications.",
    schema: z.object({
      workspace_id: z.string(),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ workspace_id, actor }) => {
    const events = orchestrator.listEvents(workspace_id, actor);
    return object({ workspace_id, total: events.length, events });
  }
);

server.tool(
  {
    name: "list_audit_ledger",
    description: "Return immutable audit-ledger entries for governance and review workflows.",
    schema: z.object({
      workspace_id: z.string(),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ workspace_id, actor }) => {
    const entries = orchestrator.listAuditLedger(workspace_id, actor);
    return object({ workspace_id, total: entries.length, entries });
  }
);

server.tool(
  {
    name: "bootstrap_demo_flow",
    description:
      "Run a complete demo ingestion/simulation flow (dataroom + finance + legal) and return next actions.",
    schema: z.object({
      workspace_id: z.string().default("demo-deal-001"),
    }),
    annotations: { readOnlyHint: false },
  },
  async ({ workspace_id }) => {
    for (const sourceId of ["dataroom_vdr", "finance_erp", "legal_contracts"]) {
      await orchestrator.ingestEvidenceBatch({
        workspace_id,
        source_id: sourceId,
        batch_manifest: buildDemoBatchForSource(sourceId),
        actor: DEMO_ACTOR,
      });
    }

    const findings = orchestrator.listFindings({
      workspace_id,
      actor: DEMO_ACTOR,
    });

    const requiresApproval = findings.filter(
      (finding) => finding.status === "requires_approval"
    );

    const scenarios = orchestrator.runScenarios({
      workspace_id,
      scenario_set: buildDefaultScenarioSet(),
      actor: DEMO_ACTOR,
    });

    return object({
      workspace_id,
      findings_total: findings.length,
      requires_approval: requiresApproval.length,
      scenarios,
      next_actions: [
        "Review high-impact findings and submit approve_finding decisions.",
        "Re-run run_scenarios with custom assumptions.",
        "Generate generate_ic_package after approval gates are cleared.",
      ],
    });
  }
);

await server.listen();

console.log(textBanner());

function textBanner(): string {
  return [
    "",
    "M&A Due-Diligence Orchestrator started.",
    `Demo workspace: ${demoWorkspace.workspace_id}`,
    "",
    "Suggested quick flow:",
    "1) bootstrap_demo_flow",
    "2) list_findings",
    "3) approve_finding (for requires_approval findings)",
    "4) run_scenarios",
    "5) generate_ic_package",
    "",
  ].join("\n");
}

interface ScenarioAssumptions {
  downside_multiplier: number;
  synergy_multiplier: number;
  integration_cost: number;
}

interface ScenarioProposal {
  name: string;
  assumptions: ScenarioAssumptions;
  plain_english: string;
  rationale: string[];
}

interface PlainEnglishConversion {
  assumptions: ScenarioAssumptions;
  signals: string[];
  caveats: string[];
}

function summarizeFindingForScenario(finding: Finding) {
  return {
    finding_id: finding.finding_id,
    title: finding.title,
    tower: finding.tower,
    severity: finding.severity,
    probability: finding.probability,
    impact_value: finding.impact_value,
    confidence: finding.confidence,
    status: finding.status,
  };
}

function generateScenarioProposalsFromFinding(finding: Finding): ScenarioProposal[] {
  const base = baselineAssumptionsFromFinding(finding);
  const containment: ScenarioAssumptions = {
    downside_multiplier: round2(clampNumber(base.downside_multiplier - 0.22, 0.6, 2.5)),
    synergy_multiplier: round2(clampNumber(base.synergy_multiplier + 0.18, 0.3, 1.9)),
    integration_cost: Math.round(clampNumber(base.integration_cost * 0.82, 250_000, 60_000_000)),
  };
  const escalation: ScenarioAssumptions = {
    downside_multiplier: round2(clampNumber(base.downside_multiplier + 0.35, 0.6, 2.5)),
    synergy_multiplier: round2(clampNumber(base.synergy_multiplier - 0.24, 0.3, 1.9)),
    integration_cost: Math.round(clampNumber(base.integration_cost * 1.55, 250_000, 60_000_000)),
  };

  return [
    {
      name: "finding_containment_case",
      assumptions: containment,
      plain_english:
        `Containment case for "${finding.title}": issue is addressed early, downside pressure softens, ` +
        "synergy delivery is mostly preserved, and integration rework stays limited.",
      rationale: [
        "Assumes rapid mitigation plan with executive ownership.",
        "Assumes limited second-order impact on revenue and integration teams.",
      ],
    },
    {
      name: "finding_base_case",
      assumptions: base,
      plain_english:
        `Base case for "${finding.title}": current evidence remains directionally accurate, ` +
        "some friction appears during integration, but no extreme deterioration.",
      rationale: [
        "Anchored on finding severity, probability, confidence, and estimated impact.",
        "Represents planning-case assumptions for committee review.",
      ],
    },
    {
      name: "finding_escalation_case",
      assumptions: escalation,
      plain_english:
        `Escalation case for "${finding.title}": the issue worsens or broadens, downside intensifies, ` +
        "synergy realization slips, and integration needs material incremental spend.",
      rationale: [
        "Assumes delayed remediation and cross-functional knock-on effects.",
        "Useful as a negotiation and contingency-planning stress case.",
      ],
    },
  ];
}

function baselineAssumptionsFromFinding(finding: Finding): ScenarioAssumptions {
  const severityDownsideBump =
    finding.severity === "critical"
      ? 0.5
      : finding.severity === "high"
        ? 0.32
        : finding.severity === "medium"
          ? 0.18
          : 0.08;
  const probabilityDownsideBump = (finding.probability - 0.5) * 0.5;

  const severitySynergyPenalty =
    finding.severity === "critical"
      ? 0.26
      : finding.severity === "high"
        ? 0.17
        : finding.severity === "medium"
          ? 0.09
          : 0.03;
  const probabilitySynergyPenalty = (finding.probability - 0.5) * 0.2;
  const confidenceSynergyOffset = (finding.confidence - 0.7) * 0.1;

  const severityIntegrationBump =
    finding.severity === "critical"
      ? 1_400_000
      : finding.severity === "high"
        ? 850_000
        : finding.severity === "medium"
          ? 420_000
          : 200_000;
  const integration = Math.round(
    clampNumber(700_000 + finding.impact_value * 0.08 + severityIntegrationBump, 300_000, 25_000_000)
  );

  return {
    downside_multiplier: round2(
      clampNumber(1 + severityDownsideBump + probabilityDownsideBump, 0.7, 2.4)
    ),
    synergy_multiplier: round2(
      clampNumber(
        1 - severitySynergyPenalty - probabilitySynergyPenalty + confidenceSynergyOffset,
        0.4,
        1.5
      )
    ),
    integration_cost: integration,
  };
}

function convertPlainEnglishToScenarioParameters(
  plainEnglish: string,
  finding?: Finding
): PlainEnglishConversion {
  const baseline: ScenarioAssumptions = finding
    ? baselineAssumptionsFromFinding(finding)
    : {
        downside_multiplier: 1,
        synergy_multiplier: 1,
        integration_cost: 1_500_000,
      };

  let downside = baseline.downside_multiplier;
  let synergy = baseline.synergy_multiplier;
  let integrationCost = baseline.integration_cost;

  const signals: string[] = [];
  const caveats: string[] = [];
  const text = plainEnglish.toLowerCase();

  const explicitDownsidePercent = extractPercent(
    text,
    /(?:downside|risk|impact|loss)[^0-9]{0,25}(\d{1,3}(?:\.\d+)?)\s*%/i
  );
  if (explicitDownsidePercent !== null) {
    downside = 1 + explicitDownsidePercent / 100;
    signals.push(`Applied explicit downside cue: ${explicitDownsidePercent}%`);
  }

  const explicitSynergyPercent = extractPercent(
    text,
    /(?:synergy|upside|cross[- ]sell|reali[sz]e)[^0-9]{0,25}(\d{1,3}(?:\.\d+)?)\s*%/i
  );
  if (explicitSynergyPercent !== null) {
    synergy = explicitSynergyPercent / 100;
    signals.push(`Applied explicit synergy cue: ${explicitSynergyPercent}% realization`);
  }

  const explicitIntegrationCost = extractCurrencyAmount(text);
  if (explicitIntegrationCost !== null) {
    integrationCost = explicitIntegrationCost;
    signals.push(
      `Applied explicit integration cost cue: ${formatCurrencyCompact(explicitIntegrationCost)}`
    );
  }

  if (explicitDownsidePercent === null) {
    const downsideAdjustments: Array<{ re: RegExp; delta: number; note: string }> = [
      {
        re: /\b(catastrophic|critical|severe|existential|termination|breach|litigation|blocker)\b/i,
        delta: 0.3,
        note: "Detected strong downside language",
      },
      {
        re: /\b(uncertain|delay|headwind|volatility|exposure|pressure)\b/i,
        delta: 0.14,
        note: "Detected moderate downside language",
      },
      {
        re: /\b(mitigated|contained|resolved|stabilized|low risk)\b/i,
        delta: -0.18,
        note: "Detected mitigation language lowering downside pressure",
      },
    ];

    for (const adjustment of downsideAdjustments) {
      if (adjustment.re.test(text)) {
        downside += adjustment.delta;
        signals.push(adjustment.note);
      }
    }
  }

  if (explicitSynergyPercent === null) {
    const synergyAdjustments: Array<{ re: RegExp; delta: number; note: string }> = [
      {
        re: /\b(strong synergy|cross[- ]sell upside|cost-out|acceleration)\b/i,
        delta: 0.2,
        note: "Detected strong synergy language",
      },
      {
        re: /\b(limited synergy|synergy delay|dis-synergy|integration drag|overlap pain)\b/i,
        delta: -0.25,
        note: "Detected weak synergy language",
      },
    ];

    for (const adjustment of synergyAdjustments) {
      if (adjustment.re.test(text)) {
        synergy += adjustment.delta;
        signals.push(adjustment.note);
      }
    }
  }

  if (explicitIntegrationCost === null) {
    const integrationAdjustments: Array<{ re: RegExp; delta: number; note: string }> = [
      {
        re: /\b(carve[- ]?out|tsa|erp migration|data migration|platform consolidation|multi-system)\b/i,
        delta: 1_250_000,
        note: "Detected complex integration language",
      },
      {
        re: /\b(minimal integration|lightweight integration|plug and play|already integrated)\b/i,
        delta: -600_000,
        note: "Detected lower integration effort language",
      },
    ];

    for (const adjustment of integrationAdjustments) {
      if (adjustment.re.test(text)) {
        integrationCost += adjustment.delta;
        signals.push(adjustment.note);
      }
    }
  }

  if (signals.length === 0) {
    caveats.push("No strong language cues detected; returned baseline planning assumptions.");
  }
  if (!/\b(downside|risk|impact|loss)\b/i.test(text)) {
    caveats.push(
      "No explicit downside wording found; downside multiplier is approximate."
    );
  }
  if (!/\b(synergy|upside|cross[- ]sell|cost[- ]out)\b/i.test(text)) {
    caveats.push(
      "No explicit synergy wording found; synergy multiplier is approximate."
    );
  }
  if (!/\b(integration|cost|migration|tsa|carve[- ]?out)\b/i.test(text)) {
    caveats.push(
      "No explicit integration-cost wording found; integration cost is approximate."
    );
  }
  if (finding) {
    caveats.push(
      "Baseline was anchored to the selected finding; portfolio effects can still dominate final outputs."
    );
  }

  const assumptions: ScenarioAssumptions = {
    downside_multiplier: round2(clampNumber(downside, 0.6, 2.6)),
    synergy_multiplier: round2(clampNumber(synergy, 0.3, 1.9)),
    integration_cost: Math.round(clampNumber(integrationCost, 250_000, 60_000_000)),
  };

  return {
    assumptions,
    signals,
    caveats,
  };
}

function scenarioAssumptionsToRecord(
  assumptions: ScenarioAssumptions
): Record<string, number> {
  return {
    downside_multiplier: assumptions.downside_multiplier,
    synergy_multiplier: assumptions.synergy_multiplier,
    integration_cost: assumptions.integration_cost,
  };
}

function plainEnglishAssumptionSummary(assumptions: ScenarioAssumptions): string {
  return (
    `Converted assumptions -> downside ${assumptions.downside_multiplier}x, ` +
    `synergy ${assumptions.synergy_multiplier}x, integration cost ${formatCurrencyCompact(
      assumptions.integration_cost
    )}.`
  );
}

function buildManagementBrief(params: {
  finding: Finding;
  scenarioSet: ScenarioDefinition[];
  results: ScenarioResult[];
}) {
  const paired = params.results.map((result, index) => {
    const scenario = params.scenarioSet[index];
    const assumptions = normalizeScenarioAssumptions(
      scenario?.assumptions ?? {}
    );
    return {
      name: scenario?.name ?? `scenario_${index + 1}`,
      assumptions,
      result,
    };
  });

  const orderedByValuation = [...paired].sort(
    (a, b) => a.result.valuation_delta - b.result.valuation_delta
  );
  const worst = orderedByValuation[0];
  const best = orderedByValuation[orderedByValuation.length - 1];

  const keyMessages: string[] = [];
  if (worst) {
    keyMessages.push(
      `Worst valuation case is '${worst.name}' at ${formatSignedCurrencyCompact(
        worst.result.valuation_delta
      )}.`
    );
  }
  if (best) {
    keyMessages.push(
      `Best valuation case is '${best.name}' at ${formatSignedCurrencyCompact(
        best.result.valuation_delta
      )}.`
    );
  }
  if (paired.length > 1) {
    const spread =
      Math.max(...paired.map((item) => item.result.valuation_delta)) -
      Math.min(...paired.map((item) => item.result.valuation_delta));
    keyMessages.push(
      `Valuation spread across tested cases is ${formatCurrencyCompact(Math.abs(spread))}.`
    );
  }

  return {
    executive_summary:
      `This run is anchored to finding '${params.finding.title}'. ` +
      "It translates assumptions into business outcomes for management review.",
    scenario_explanations: paired.map((item) => ({
      scenario: item.name,
      plain_english_assumptions: plainEnglishAssumptionSummary(item.assumptions),
      risk_impact: formatCurrencyCompact(item.result.risk_delta),
      valuation_effect: formatSignedCurrencyCompact(item.result.valuation_delta),
      integration_effect: formatSignedCurrencyCompact(item.result.integration_delta),
      confidence_band: `${Math.round(item.result.confidence_band[0] * 100)}%-${Math.round(item.result.confidence_band[1] * 100)}%`,
      management_translation:
        `If '${item.name}' happens, expected deal-value movement is ${formatSignedCurrencyCompact(
          item.result.valuation_delta
        )} with integration pressure around ${formatSignedCurrencyCompact(
          item.result.integration_delta
        )}.`,
    })),
    key_messages: keyMessages,
    recommended_questions: [
      "Which mitigations can reduce downside multiplier before signing?",
      "Which synergy line-items are most likely to slip and who owns recovery?",
      "How much of integration cost is mandatory vs deferrable?",
      "What evidence should be requested next to narrow scenario uncertainty?",
    ],
  };
}

function normalizeScenarioAssumptions(
  assumptions: Record<string, number>
): ScenarioAssumptions {
  return {
    downside_multiplier: round2(
      clampNumber(Number(assumptions.downside_multiplier ?? 1), 0.6, 2.6)
    ),
    synergy_multiplier: round2(
      clampNumber(Number(assumptions.synergy_multiplier ?? 1), 0.3, 1.9)
    ),
    integration_cost: Math.round(
      clampNumber(Number(assumptions.integration_cost ?? 1_500_000), 250_000, 60_000_000)
    ),
  };
}

function extractPercent(input: string, pattern: RegExp): number | null {
  const match = input.match(pattern);
  if (!match || match[1] === undefined) {
    return null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 300) {
    return null;
  }
  return value;
}

function extractCurrencyAmount(input: string): number | null {
  const match = input.match(
    /(?:integration(?:\s+cost)?|one[- ]?off(?:\s+cost)?|cost)[^\d$]{0,25}\$?\s*([0-9][0-9,]*(?:\.\d+)?)(?:\s*(k|m|b|thousand|million|billion))?/i
  );
  if (!match || match[1] === undefined) {
    return null;
  }

  const numeric = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const unit = (match[2] ?? "").toLowerCase();
  const multiplier =
    unit === "k" || unit === "thousand"
      ? 1_000
      : unit === "m" || unit === "million"
        ? 1_000_000
        : unit === "b" || unit === "billion"
          ? 1_000_000_000
          : 1;

  return Math.round(numeric * multiplier);
}

function formatCurrencyCompact(value: number): string {
  const abs = Math.abs(value);
  const prefix = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000) {
    return `${prefix}$${round2(abs / 1_000_000_000)}B`;
  }
  if (abs >= 1_000_000) {
    return `${prefix}$${round2(abs / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    return `${prefix}$${round2(abs / 1_000)}K`;
  }
  return `${prefix}$${Math.round(abs)}`;
}

function formatSignedCurrencyCompact(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatCurrencyCompact(Math.abs(value))}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
