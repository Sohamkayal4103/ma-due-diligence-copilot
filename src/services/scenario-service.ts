import { randomUUID } from "node:crypto";
import type { Finding, ScenarioDefinition, ScenarioResult } from "../types.js";

export class ScenarioService {
  runScenarios(
    workspaceId: string,
    findings: Finding[],
    scenarioSet: ScenarioDefinition[]
  ): ScenarioResult[] {
    const baseRisk = findings.reduce(
      (sum, finding) => sum + finding.impact_value * finding.probability,
      0
    );
    const avgConfidence =
      findings.length === 0
        ? 0.6
        : findings.reduce((sum, finding) => sum + finding.confidence, 0) /
          findings.length;

    return scenarioSet.map((scenario) => {
      const downsideMultiplier = scenario.assumptions.downside_multiplier ?? 1;
      const synergyMultiplier = scenario.assumptions.synergy_multiplier ?? 1;
      const integrationCost = scenario.assumptions.integration_cost ?? 0;

      const riskDelta = baseRisk * downsideMultiplier;
      const valuationDelta = round(-riskDelta + synergyMultiplier * 4_500_000);
      const integrationDelta = round(-integrationCost - riskDelta * 0.15);

      const confidenceBand = buildConfidenceBand(avgConfidence);

      return {
        scenario_id: randomUUID(),
        workspace_id: workspaceId,
        assumptions: scenario.assumptions,
        valuation_delta: valuationDelta,
        integration_delta: integrationDelta,
        risk_delta: round(riskDelta),
        confidence_band: confidenceBand,
      };
    });
  }
}

function buildConfidenceBand(avgConfidence: number): [number, number] {
  const center = Math.min(0.99, Math.max(0.05, avgConfidence));
  const spread = 0.14;
  return [round(Math.max(0, center - spread)), round(Math.min(1, center + spread))];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
