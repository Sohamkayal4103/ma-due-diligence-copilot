import type { DiligenceTower } from "../types.js";

export interface SourceDefinition {
  source_id: string;
  display_name: string;
  tower: DiligenceTower;
  required_scope: string;
}

export const FEDERATED_SOURCES: Record<string, SourceDefinition> = {
  dataroom_vdr: {
    source_id: "dataroom_vdr",
    display_name: "Virtual Data Room",
    tower: "legal_regulatory",
    required_scope: "source:dataroom:read",
  },
  finance_erp: {
    source_id: "finance_erp",
    display_name: "Finance ERP",
    tower: "financial",
    required_scope: "source:finance:read",
  },
  legal_contracts: {
    source_id: "legal_contracts",
    display_name: "Legal Contracts",
    tower: "legal_regulatory",
    required_scope: "source:legal:read",
  },
  hr_org: {
    source_id: "hr_org",
    display_name: "HR Org Data",
    tower: "people_hr",
    required_scope: "source:hr:read",
  },
  market_intel: {
    source_id: "market_intel",
    display_name: "Market Intelligence",
    tower: "commercial_market",
    required_scope: "source:market:read",
  },
  operations_supply: {
    source_id: "operations_supply",
    display_name: "Operations & Supply",
    tower: "operations_supply_chain",
    required_scope: "source:operations:read",
  },
  tax_records: {
    source_id: "tax_records",
    display_name: "Tax & Jurisdiction",
    tower: "tax_jurisdiction",
    required_scope: "source:tax:read",
  },
  security_it: {
    source_id: "security_it",
    display_name: "Security & IT",
    tower: "technical_cyber",
    required_scope: "source:security:read",
  },
};

export function getSourceOrThrow(sourceId: string): SourceDefinition {
  const source = FEDERATED_SOURCES[sourceId];
  if (!source) {
    throw new Error(
      `Unknown source_id '${sourceId}'. Valid sources: ${Object.keys(FEDERATED_SOURCES).join(", ")}`
    );
  }
  return source;
}
