import { classifyClientSection, type ClientLifecycle } from './clientLifecycle';

export interface ProspectDiscardTrace {
  prospect_discarded_at?: string | null;
  prospect_discarded_by?: string | null;
  prospect_discard_reason?: string | null;
}

export function canDiscardUnfulfilledProspect(client: ClientLifecycle & ProspectDiscardTrace) {
  return !client.prospect_discarded_at && classifyClientSection(client) === 'unfulfilled';
}
