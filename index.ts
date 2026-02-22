import { MCPServer, object, widget } from "mcp-use/server";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
const LANDING_WIDGET_PATH = "/mcp-use/widgets/landing-home/index.html";

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

const dealTypeSchema = z.enum(["merger", "acquisition"]);
const diligenceTowerSchema = z.enum([
  "financial",
  "legal_regulatory",
  "commercial_market",
  "operations_supply_chain",
  "people_hr",
  "tax_jurisdiction",
  "technical_cyber",
]);
const riskSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const intakeFileUploadSchema = z.object({
  file_name: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  base64: z.string().min(1),
});

const intakeDocumentSchema = z
  .object({
    document_name: z.string().min(2),
    document_type: z.string().min(2),
    source_uri: z.string().optional(),
    mime_type: z.string().optional(),
    notes: z.string().optional(),
    raw_text: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    file_upload: intakeFileUploadSchema.optional(),
  })
  .superRefine((doc, ctx) => {
    if (!doc.source_uri && !doc.file_upload) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_uri"],
        message: "Provide either source_uri or file_upload for each document.",
      });
    }
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
server.app.get("/", (c) => c.redirect(LANDING_WIDGET_PATH));

server.tool(
  {
    name: "show_landing_home",
    description:
      "Render the product landing widget that explains what the app does and the standard M&A workflow.",
    schema: z.object({
      focus: z
        .enum(["overview", "workflow", "agent_role"])
        .default("overview"),
    }),
    widget: {
      name: "landing-home",
      invoking: "Loading product landing...",
      invoked: "Landing loaded",
    },
    annotations: { readOnlyHint: true },
  },
  async ({ focus }) => {
    return widget({
      props: { focus },
      message:
        "Loaded landing page widget with overview + workflow + AI agent role.",
    });
  }
);

server.tool(
  {
    name: "submit_deal_intake",
    description:
      "Create a merger/acquisition workspace and persist deal + document intake records into Supabase.",
    schema: z.object({
      tenant_id: z.string().default("tenant-demo"),
      deal_type: dealTypeSchema,
      deal_name: z.string().min(3),
      acquirer_name: z.string().min(2),
      target_name: z.string().min(2),
      thesis: z.string().min(8),
      deal_value: z.number().nonnegative().optional(),
      currency: z.string().default("USD"),
      expected_close_date: z.string().optional(),
      jurisdiction: z.string().optional(),
      industry: z.string().optional(),
      owner_email: z.string().email().optional(),
      materiality_threshold: z.number().positive().default(4_500_000),
      policy_profile: z.string().default("strict-default"),
      documents: z.array(intakeDocumentSchema).default([]),
      actor: actorSchema.optional(),
    }),
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({
    tenant_id,
    deal_type,
    deal_name,
    acquirer_name,
    target_name,
    thesis,
    deal_value,
    currency,
    expected_close_date,
    jurisdiction,
    industry,
    owner_email,
    materiality_threshold,
    policy_profile,
    documents,
    actor,
  }) => {
    const resolvedActor = actor ?? DEMO_ACTOR;
    const workspace = orchestrator.createWorkspace(
      {
        tenant_id,
        deal_name,
        thesis,
        materiality_threshold,
        policy_profile,
      },
      resolvedActor
    );

    const persistence = await persistDealIntakeToSupabase({
      workspace_id: workspace.workspace_id,
      tenant_id,
      deal_type,
      deal_name,
      acquirer_name,
      target_name,
      thesis,
      deal_value,
      currency,
      expected_close_date,
      jurisdiction,
      industry,
      owner_email,
      materiality_threshold,
      policy_profile,
      documents,
    });

    return object({
      workspace,
      persistence,
    });
  }
);

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
    name: "analyze_documents_with_openai",
    description:
      "Analyze full workspace documents using OpenAI and return AI findings with finding IDs and source document names.",
    schema: z.object({
      workspace_id: z.string(),
      as_widget: z.boolean().default(true),
      model: z.string().default("gpt-4.1"),
      max_findings_per_document: z.number().int().min(1).max(12).default(5),
      actor: actorSchema.optional(),
    }),
    widget: {
      name: "ai-findings",
      invoking: "Running OpenAI document analysis...",
      invoked: "AI findings ready",
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    workspace_id,
    as_widget,
    model,
    max_findings_per_document,
    actor,
  }) => {
    const resolvedActor = actor ?? DEMO_ACTOR;

    // Access check against workspace RBAC before contacting external APIs.
    orchestrator.listFindings({
      workspace_id,
      filters: {},
      actor: resolvedActor,
    });

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey || openaiApiKey.trim().length === 0) {
      throw new Error(
        "OPENAI_API_KEY is not configured. Add it to .env/.env.local and restart."
      );
    }

    const documents = await loadWorkspaceDocumentsFromSupabase(workspace_id);
    if (documents.length === 0) {
      throw new Error(
        `No documents found in Supabase for workspace '${workspace_id}'. Submit intake documents first.`
      );
    }

    const findings: OpenAiWidgetFinding[] = [];
    const analyzedDocuments: OpenAiWidgetDocument[] = [];
    for (const doc of documents) {
      const source = await resolveDocumentContentForOpenAi(doc);
      const aiResult = await analyzeDocumentWithOpenAi({
        workspace_id,
        document: doc,
        source,
        api_key: openaiApiKey,
        model,
        max_findings_per_document,
      });

      analyzedDocuments.push({
        document_id: doc.document_id,
        document_name: doc.document_name,
        source_type: source.type,
        source_label: source.source_label,
        bytes_sent: source.type === "file_bytes" ? source.size_bytes : undefined,
        chars_sent: source.type === "raw_text" ? source.text.length : undefined,
        summary: aiResult.document_summary,
      });

      for (const item of aiResult.findings) {
        findings.push({
          finding_id: randomUUID(),
          document_id: doc.document_id,
          document_name: doc.document_name,
          title: item.title,
          summary: item.summary,
          tower: item.tower,
          severity: item.severity,
          probability: clamp01(item.probability),
          confidence: clamp01(item.confidence),
          impact_value: Math.max(0, Math.round(item.impact_value)),
        });
      }
    }

    const payload = {
      workspace_id,
      model,
      analyzed_documents: analyzedDocuments,
      findings_total: findings.length,
      findings,
    };

    if (as_widget) {
      return widget({
        props: payload,
        message: `Analyzed ${analyzedDocuments.length} document(s) and generated ${findings.length} finding(s).`,
      });
    }

    return object(payload);
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

interface DealIntakeDocumentInput {
  document_name: string;
  document_type: string;
  source_uri?: string;
  mime_type?: string;
  notes?: string;
  raw_text?: string;
  metadata?: Record<string, unknown>;
  file_upload?: {
    file_name: string;
    mime_type: string;
    size_bytes: number;
    base64: string;
  };
}

interface DealIntakePersistenceInput {
  workspace_id: string;
  tenant_id: string;
  deal_type: "merger" | "acquisition";
  deal_name: string;
  acquirer_name: string;
  target_name: string;
  thesis: string;
  deal_value?: number;
  currency: string;
  expected_close_date?: string;
  jurisdiction?: string;
  industry?: string;
  owner_email?: string;
  materiality_threshold: number;
  policy_profile: string;
  documents: DealIntakeDocumentInput[];
}

async function persistDealIntakeToSupabase(
  input: DealIntakePersistenceInput
): Promise<{
  provider: "supabase";
  deal_table: string;
  document_table: string;
  document_bucket: string;
  inserted_deal_id: string;
  inserted_documents: number;
  uploaded_files: number;
}> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
  }

  const dealTable = process.env.SUPABASE_DEAL_TABLE ?? "ma_deals";
  const documentTable = process.env.SUPABASE_DOCUMENT_TABLE ?? "ma_deal_documents";
  const documentBucket = process.env.SUPABASE_DOCUMENT_BUCKET ?? "ma-diligence-docs";
  const baseUrl = supabaseUrl.replace(/\/+$/, "");

  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const dealPayload = {
    workspace_id: input.workspace_id,
    tenant_id: input.tenant_id,
    deal_type: input.deal_type,
    deal_name: input.deal_name,
    acquirer_name: input.acquirer_name,
    target_name: input.target_name,
    thesis: input.thesis,
    deal_value: input.deal_value ?? null,
    currency: input.currency,
    expected_close_date: input.expected_close_date ?? null,
    jurisdiction: input.jurisdiction ?? null,
    industry: input.industry ?? null,
    owner_email: input.owner_email ?? null,
    materiality_threshold: input.materiality_threshold,
    policy_profile: input.policy_profile,
    metadata: {
      source: "submit_deal_intake",
      submitted_at: new Date().toISOString(),
    },
  };

  const dealRes = await fetch(`${baseUrl}/rest/v1/${dealTable}`, {
    method: "POST",
    headers,
    body: JSON.stringify([dealPayload]),
  });

  if (!dealRes.ok) {
    const body = await dealRes.text();
    throw new Error(`Supabase deal insert failed (${dealRes.status}): ${body}`);
  }

  const insertedDeal = toArray(await dealRes.json())[0];
  const insertedDealId =
    typeof insertedDeal?.deal_id === "string"
      ? insertedDeal.deal_id
      : typeof insertedDeal?.id === "string"
        ? insertedDeal.id
        : null;

  if (!insertedDealId) {
    throw new Error(
      "Supabase deal insert response did not include deal_id (or id). Check table schema and PostgREST response."
    );
  }

  let insertedDocuments = 0;
  let uploadedFiles = 0;
  if (input.documents.length > 0) {
    const docsPayload: Array<Record<string, unknown>> = [];
    for (const [index, doc] of input.documents.entries()) {
      let sourceUri = doc.source_uri ?? null;
      let mimeType = doc.mime_type ?? null;
      const metadata: Record<string, unknown> = { ...(doc.metadata ?? {}) };

      if (doc.file_upload) {
        const now = new Date().toISOString();
        const storagePath = buildStoragePath({
          tenant_id: input.tenant_id,
          workspace_id: input.workspace_id,
          deal_id: insertedDealId,
          index,
          file_name: doc.file_upload.file_name,
        });

        await uploadFileToSupabaseStorage({
          base_url: baseUrl,
          service_role_key: serviceRoleKey,
          bucket: documentBucket,
          path: storagePath,
          mime_type: doc.file_upload.mime_type || "application/octet-stream",
          base64: doc.file_upload.base64,
        });

        uploadedFiles += 1;
        mimeType = mimeType ?? doc.file_upload.mime_type;
        if (!sourceUri) {
          sourceUri = `supabase://${documentBucket}/${storagePath}`;
        }

        metadata.storage = {
          bucket: documentBucket,
          path: storagePath,
          file_name: doc.file_upload.file_name,
          mime_type: doc.file_upload.mime_type,
          size_bytes: doc.file_upload.size_bytes,
          uploaded_at: now,
        };
      }

      docsPayload.push({
        deal_id: insertedDealId,
        workspace_id: input.workspace_id,
        document_name: doc.document_name,
        document_type: doc.document_type,
        source_uri: sourceUri,
        mime_type: mimeType,
        notes: doc.notes ?? null,
        raw_text: doc.raw_text ?? null,
        metadata,
      });
    }

    const docsRes = await fetch(`${baseUrl}/rest/v1/${documentTable}`, {
      method: "POST",
      headers,
      body: JSON.stringify(docsPayload),
    });

    if (!docsRes.ok) {
      const body = await docsRes.text();
      throw new Error(
        `Supabase document insert failed (${docsRes.status}): ${body}`
      );
    }

    insertedDocuments = docsPayload.length;
  }

  return {
    provider: "supabase",
    deal_table: dealTable,
    document_table: documentTable,
    document_bucket: documentBucket,
    inserted_deal_id: insertedDealId,
    inserted_documents: insertedDocuments,
    uploaded_files: uploadedFiles,
  };
}

function toArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item)
  );
}

function buildStoragePath(args: {
  tenant_id: string;
  workspace_id: string;
  deal_id: string;
  index: number;
  file_name: string;
}): string {
  const sanitizedName = sanitizeFileName(args.file_name);
  const stamp = Date.now();
  return [
    args.tenant_id,
    args.workspace_id,
    args.deal_id,
    `${args.index + 1}-${stamp}-${sanitizedName}`,
  ].join("/");
}

function sanitizeFileName(fileName: string): string {
  return fileName
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

async function uploadFileToSupabaseStorage(args: {
  base_url: string;
  service_role_key: string;
  bucket: string;
  path: string;
  mime_type: string;
  base64: string;
}) {
  const encodedPath = args.path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `${args.base_url}/storage/v1/object/${encodeURIComponent(args.bucket)}/${encodedPath}`;
  const binary = Buffer.from(args.base64, "base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: args.service_role_key,
      Authorization: `Bearer ${args.service_role_key}`,
      "Content-Type": args.mime_type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: binary,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase storage upload failed (${res.status}): ${body}`);
  }
}

interface SupabaseDocumentRow {
  document_id: string;
  deal_id: string;
  workspace_id: string;
  document_name: string;
  document_type: string;
  source_uri: string | null;
  mime_type: string | null;
  notes: string | null;
  raw_text: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

type OpenAiDocumentSource =
  | {
      type: "file_bytes";
      source_label: string;
      file_name: string;
      mime_type: string;
      base64: string;
      size_bytes: number;
    }
  | {
      type: "raw_text";
      source_label: string;
      text: string;
    };

const openAiFindingSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(8),
  severity: riskSeveritySchema,
  tower: diligenceTowerSchema,
  probability: z.number(),
  impact_value: z.number(),
  confidence: z.number(),
});

const openAiDocumentAnalysisSchema = z.object({
  document_summary: z.string().default(""),
  findings: z.array(openAiFindingSchema).default([]),
});

interface OpenAiWidgetFinding {
  finding_id: string;
  document_id: string;
  document_name: string;
  title: string;
  summary: string;
  tower: z.infer<typeof diligenceTowerSchema>;
  severity: z.infer<typeof riskSeveritySchema>;
  probability: number;
  confidence: number;
  impact_value: number;
}

interface OpenAiWidgetDocument {
  document_id: string;
  document_name: string;
  source_type: "file_bytes" | "raw_text";
  source_label: string;
  bytes_sent?: number;
  chars_sent?: number;
  summary: string;
}

async function loadWorkspaceDocumentsFromSupabase(
  workspaceId: string
): Promise<SupabaseDocumentRow[]> {
  const { base_url, service_role_key, document_table } =
    getSupabaseConfigOrThrow();

  const query = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    select:
      "document_id,deal_id,workspace_id,document_name,document_type,source_uri,mime_type,notes,raw_text,metadata,created_at",
    order: "created_at.asc",
  });
  const url = `${base_url}/rest/v1/${document_table}?${query.toString()}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: service_role_key,
      Authorization: `Bearer ${service_role_key}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Supabase document query failed (${res.status}) for workspace '${workspaceId}': ${body}`
    );
  }

  const rows = toArray(await res.json());
  return rows
    .map((row) => ({
      document_id: asRequiredString(row.document_id, "document_id"),
      deal_id: asRequiredString(row.deal_id, "deal_id"),
      workspace_id: asRequiredString(row.workspace_id, "workspace_id"),
      document_name: asRequiredString(row.document_name, "document_name"),
      document_type: asRequiredString(row.document_type, "document_type"),
      source_uri: asOptionalString(row.source_uri),
      mime_type: asOptionalString(row.mime_type),
      notes: asOptionalString(row.notes),
      raw_text: asOptionalString(row.raw_text),
      metadata: toRecord(row.metadata),
      created_at: asOptionalString(row.created_at) ?? new Date().toISOString(),
    }))
    .filter((doc) => doc.workspace_id === workspaceId);
}

async function resolveDocumentContentForOpenAi(
  doc: SupabaseDocumentRow
): Promise<OpenAiDocumentSource> {
  // Prefer storage/file-backed sources to preserve full binary document contents.
  const storageMeta = toRecord(toRecord(doc.metadata).storage);
  const storageBucket = asOptionalString(storageMeta.bucket);
  const storagePath = asOptionalString(storageMeta.path);
  if (storageBucket && storagePath) {
    const bytes = await downloadSupabaseStorageObject(storageBucket, storagePath);
    return buildBinarySource({
      source_label: `supabase://${storageBucket}/${storagePath}`,
      file_name:
        asOptionalString(storageMeta.file_name) ?? `${doc.document_name}.bin`,
      mime_type:
        asOptionalString(storageMeta.mime_type) ??
        doc.mime_type ??
        "application/octet-stream",
      bytes,
    });
  }

  if (doc.source_uri?.startsWith("supabase://")) {
    const parsed = parseSupabaseUri(doc.source_uri);
    if (parsed) {
      const bytes = await downloadSupabaseStorageObject(
        parsed.bucket,
        parsed.path
      );
      return buildBinarySource({
        source_label: doc.source_uri,
        file_name: inferFileName(doc, parsed.path),
        mime_type: doc.mime_type ?? "application/octet-stream",
        bytes,
      });
    }
  }

  if (doc.source_uri?.startsWith("file://")) {
    const localPath = decodeURIComponent(doc.source_uri.replace(/^file:\/\//, ""));
    const bytes = await readFile(localPath);
    return buildBinarySource({
      source_label: doc.source_uri,
      file_name: inferFileName(doc, localPath),
      mime_type: doc.mime_type ?? "application/octet-stream",
      bytes,
    });
  }

  if (doc.raw_text && doc.raw_text.trim().length > 0) {
    return {
      type: "raw_text",
      source_label: doc.source_uri ?? "raw_text",
      text: doc.raw_text,
    };
  }

  throw new Error(
    `Document '${doc.document_name}' has no readable source. Provide file upload/storage path or raw_text.`
  );
}

function buildBinarySource(args: {
  source_label: string;
  file_name: string;
  mime_type: string;
  bytes: Buffer | Uint8Array;
}): OpenAiDocumentSource {
  const bytes = Buffer.from(args.bytes);
  const maxBytes = 15 * 1024 * 1024;
  if (bytes.length > maxBytes) {
    throw new Error(
      `Document '${args.file_name}' is ${bytes.length} bytes, above inline analysis limit (${maxBytes} bytes).`
    );
  }

  return {
    type: "file_bytes",
    source_label: args.source_label,
    file_name: args.file_name,
    mime_type: args.mime_type || "application/octet-stream",
    base64: bytes.toString("base64"),
    size_bytes: bytes.length,
  };
}

async function analyzeDocumentWithOpenAi(args: {
  workspace_id: string;
  document: SupabaseDocumentRow;
  source: OpenAiDocumentSource;
  api_key: string;
  model: string;
  max_findings_per_document: number;
}): Promise<z.infer<typeof openAiDocumentAnalysisSchema>> {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      document_summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            severity: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
            },
            tower: {
              type: "string",
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
            probability: { type: "number" },
            impact_value: { type: "number" },
            confidence: { type: "number" },
          },
          required: [
            "title",
            "summary",
            "severity",
            "tower",
            "probability",
            "impact_value",
            "confidence",
          ],
        },
      },
    },
    required: ["document_summary", "findings"],
  } as const;

  const systemPrompt = [
    "You are a senior M&A due-diligence analyst.",
    "Analyze the provided source document for diligence risks and opportunities.",
    "Return findings only from evidence in the provided source.",
    "If there are no material findings, return an empty findings array.",
  ].join(" ");

  const userText = [
    `Workspace: ${args.workspace_id}`,
    `Document ID: ${args.document.document_id}`,
    `Document Name: ${args.document.document_name}`,
    `Document Type: ${args.document.document_type}`,
    `Instruction: Analyze the entire source exactly as supplied.`,
    `Maximum findings: ${args.max_findings_per_document}`,
  ].join("\n");

  const userContent: Array<Record<string, unknown>> = [
    { type: "input_text", text: userText },
  ];
  if (args.source.type === "file_bytes") {
    userContent.push({
      type: "input_file",
      filename: args.source.file_name,
      file_data: `data:${args.source.mime_type};base64,${args.source.base64}`,
    });
  } else {
    userContent.push({
      type: "input_text",
      text: args.source.text,
    });
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      temperature: 0.1,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ma_document_analysis",
          schema,
          strict: true,
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `OpenAI document analysis failed (${res.status}) for '${args.document.document_name}': ${body}`
    );
  }

  const responseJson = await res.json();
  const responseText = extractOpenAiOutputText(responseJson);
  const parsed = parseJsonPayload(responseText);
  const validated = openAiDocumentAnalysisSchema.parse(parsed);
  return {
    document_summary: validated.document_summary,
    findings: validated.findings.slice(0, args.max_findings_per_document),
  };
}

function extractOpenAiOutputText(payload: unknown): string {
  const root = toRecord(payload);
  const outputText = asOptionalString(root.output_text);
  if (outputText && outputText.trim().length > 0) {
    return outputText;
  }

  const output = root.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = toRecord(item).content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const blockObj = toRecord(block);
        const text = asOptionalString(blockObj.text);
        if (text && text.trim().length > 0) {
          return text;
        }
      }
    }
  }

  throw new Error(
    "OpenAI response did not include readable text output for JSON parsing."
  );
}

function parseJsonPayload(value: string): unknown {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }
    throw new Error("Could not parse JSON output from OpenAI response.");
  }
}

function inferFileName(doc: SupabaseDocumentRow, pathLike: string): string {
  const fromPath = pathLike.split("/").filter(Boolean).at(-1);
  if (fromPath && fromPath.trim().length > 0) {
    return fromPath;
  }
  return `${doc.document_name.replace(/\s+/g, "_")}.bin`;
}

function parseSupabaseUri(
  sourceUri: string
): { bucket: string; path: string } | null {
  const withoutScheme = sourceUri.replace(/^supabase:\/\//, "");
  const parts = withoutScheme.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  return {
    bucket: parts[0]!,
    path: parts.slice(1).join("/"),
  };
}

async function downloadSupabaseStorageObject(
  bucket: string,
  path: string
): Promise<Buffer> {
  const { base_url, service_role_key } = getSupabaseConfigOrThrow();
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `${base_url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: service_role_key,
      Authorization: `Bearer ${service_role_key}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to download storage object '${bucket}/${path}' (${res.status}): ${body}`
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function getSupabaseConfigOrThrow(): {
  base_url: string;
  service_role_key: string;
  document_table: string;
} {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env/.env.local."
    );
  }

  return {
    base_url: supabaseUrl.replace(/\/+$/, ""),
    service_role_key: serviceRoleKey,
    document_table: process.env.SUPABASE_DOCUMENT_TABLE ?? "ma_deal_documents",
  };
}

function asRequiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Supabase row is missing required field '${field}'.`);
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
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
