/**
 * AgentMail integration — DRAFTS ONLY.
 *
 * HARD SAFETY RULE: this module must never implement, call, or expose any
 * AgentMail send endpoint. Only draft/compose creation and inbound-message
 * reading are in scope. See docs/SPEC.md §6.3 and docs/RECIPE.md §0/§2.3.
 *
 * If a future requirement genuinely needs automated sending, that requires
 * an explicit spec change and operator sign-off — it must not be added here
 * quietly as a "convenience" method.
 */

export interface DraftRequest {
  toEmail: string;
  subject: string;
  bodyText: string;
  leadId: string;
}

export interface DraftResult {
  draftId: string;
  threadId?: string;
}

export interface AgentMailClient {
  /** Creates a draft in the configured inbox. NEVER sends. */
  createDraft(request: DraftRequest): Promise<DraftResult>;
  /** Fetches inbound replies for reply-matching against leads (SPEC §6.3). */
  listInboundMessages(sinceIso: string): Promise<unknown[]>;
}

export function createAgentMailClient(_apiKey: string, _inboxId?: string): AgentMailClient {
  throw new Error(
    "createAgentMailClient is not yet implemented. See docs/SPEC.md §6.3 — draft/compose endpoint only, never send."
  );
}
