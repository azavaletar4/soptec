export interface WifiTrialOperation {
  requestId: string;
  kind: 'change' | 'restore';
  actorId: string;
  before: string;
  after: string;
  sentAt: string;
  state: 'sending' | 'queued' | 'uncertain' | 'failed' | 'verified';
  taskId?: string;
  readTaskId?: string;
  readSentAt?: string;
  verifiedAt?: string;
}
export interface WifiTrialRecord {
  version: 1;
  serial: string;
  deviceId: string;
  contractNumber: string;
  path: string;
  originalSsid: string;
  originalTimestamp: string;
  operations: WifiTrialOperation[];
}
export interface WifiTrialStatus {
  enabled: boolean;
  record: WifiTrialRecord | null;
  message: string;
}
