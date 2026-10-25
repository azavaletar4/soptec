export interface RetirementContract {
  id: string;
  number: string | null;
  code: string | null;
  status: 'active' | 'suspended' | 'cancelled';
  updatedAt: string;
  serviceType: string;
  pppoeLinked: boolean;
  iptvLinked: boolean;
  ontLinked: boolean;
}
export interface RetirementPreview {
  clientId: string;
  name: string;
  status: string;
  token: string;
  contracts: RetirementContract[];
  openInstallations: { id: string; status: string; contractId: string | null }[];
  networkReviewRequired: boolean;
  linkedEquipmentCount: number;
}
export interface RetirementConfirmation {
  previewToken: string;
  affectedContractIds: string[];
  confirmAllContracts: boolean;
}
export interface RetirementResult {
  clientId: string;
  status: 'retired';
  cancelledContractIds: string[];
  cancelledCount: number;
  networkReviewRequired: boolean;
  operationalNetworkActionsExecuted: false;
}
