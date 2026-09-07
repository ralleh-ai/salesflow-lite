/**
 * Email provider integration — DRAFTS ONLY, regardless of provider.
 *
 * HARD SAFETY RULE: no implementation behind this interface (AgentMail,
 * Gmail API, Microsoft Graph, or any other provider — see docs/SPEC.md §6.4
 * for the alternatives comparison) may implement, call, or expose a send
 * endpoint. Only draft/compose creation and inbound-message reading are in
 * scope. See docs/SPEC.md §6.3/§6.4 and docs/RECIPE.md §0/§2.3.
 *
 * This interface is intentionally provider-agnostic so swapping AgentMail
 * for Gmail/Graph/etc. never ripples into src/pipeline logic — implement
 * one concrete client per provider, all satisfying EmailDraftClient.
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
  /** Optional Drive-hosted collateral links to include in the draft body (see docs/SPEC.md §3.7). */
  collateralLinks?: string[];
}

export interface DraftResult {
  draftId: string;
  threadId?: string;
}

export interface EmailDraftClient {
  /** Creates a draft in the configured inbox/mailbox. NEVER sends. */
  createDraft(request: DraftRequest): Promise<DraftResult>;
  /** Fetches inbound replies for reply-matching against leads (SPEC §6.3, logged to Comms_Threads per §3.6). */
  listInboundMessages(sinceIso: string): Promise<unknown[]>;
}

/** @deprecated Provider-specific alias kept for backward compatibility with early stubs; use EmailDraftClient. */
export type AgentMailClient = EmailDraftClient;

export function createAgentMailClient(_apiKey: string, _inboxId?: string): EmailDraftClient {
  throw new Error(
    "createAgentMailClient is not yet implemented. See docs/SPEC.md §6.3/§6.4 — draft/compose endpoint only, never send."
  );
}
