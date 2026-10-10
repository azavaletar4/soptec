export interface OntPlanDisplaySource {
  plans?: { name?: string | null } | null;
  tcont_profile: string | null;
  traffic_profile: string | null;
}

export interface ContractPlanDisplaySource {
  name?: string | null;
  olt_tcont_profile?: string | null;
  olt_traffic_profile?: string | null;
}

/**
 * Prefer the plan linked directly to the ONT. If that link is empty, show the
 * contract plan only when its configured OLT profiles match the ONT record.
 */
export function resolveOntPlanName(
  ont: OntPlanDisplaySource,
  contractPlan?: ContractPlanDisplaySource | null,
): string | null {
  if (ont.plans?.name) return ont.plans.name;

  if (
    contractPlan?.name &&
    contractPlan.olt_tcont_profile &&
    contractPlan.olt_traffic_profile &&
    ont.tcont_profile === contractPlan.olt_tcont_profile &&
    ont.traffic_profile === contractPlan.olt_traffic_profile
  ) {
    return contractPlan.name;
  }

  return null;
}
