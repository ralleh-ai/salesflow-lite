/**
 * Email provider integration — DRAFTS ONLY, regardless of provider.
 *
 * HARD SAFETY RULE: no implementation behind this interface (AgentMail is
 * the only implemented provider today) may implement, call, or expose a send
 * endpoint. Only draft/compose creation and inbound-message reading are in
 * scope. See docs/SPEC.md §6.3/§6.4 and docs/RECIPE.md §0/§2.3.
 *
 * This interface is intentionally provider-agnostic so a hypothetical
 * future provider swap never ripples into src/pipeline logic — implement
 * one concrete client per provider, all satisfying EmailDraftClient.
 *
 * If a future requirement genuinely needs automated sending, that requires
 * an explicit spec change and operator sign-off — it must not be added here
 * quietly as a "convenience" method. This client's HTTP layer therefore
 * only ever calls AgentMail's documented draft-creation and message-listing
 * endpoints; it does not implement or import anything resembling a send call.
 */

const AGENTMAIL_API_BASE = "https://api.agentmail.to/v0";

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

/** One inbound message fetched for reply-matching against a lead's outreach thread (SPEC §6.3, logged to Comms_Threads per §3.6). Intentionally minimal/provider-agnostic — concrete clients map their provider's richer payload down to this shape. */
export interface InboundMessage {
  externalMessageId: string;
  externalThreadId?: string;
  fromEmail: string;
  subject?: string;
  bodyText: string;
  receivedAtIso: string;
}

export interface EmailDraftClient {
  /** Creates a draft in the configured inbox/mailbox. NEVER sends. */
  createDraft(request: DraftRequest): Promise<DraftResult>;
  /** Fetches inbound replies for reply-matching against leads (SPEC §6.3, logged to Comms_Threads per §3.6). */
  listInboundMessages(sinceIso: string): Promise<InboundMessage[]>;
}

/** @deprecated Provider-specific alias kept for backward compatibility with early stubs; use EmailDraftClient. */
export type AgentMailClient = EmailDraftClient;

/** Raw shape of an AgentMail draft-creation response we actually read. Narrower than AgentMail's full response — we only type what this client consumes. */
interface AgentMailDraftResponse {
  draft_id: string;
  thread_id?: string;
}

/** Raw shape of one AgentMail inbound message list item we actually read. */
interface AgentMailInboundMessageResponse {
  message_id: string;
  thread_id?: string;
  from: string;
  subject?: string;
  text?: string;
  received_at: string;
}

interface AgentMailInboundListResponse {
  messages: AgentMailInboundMessageResponse[];
}

async function agentMailFetch(
  apiKey: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<Response> {
  const fetchInit: RequestInit = {
    method: init.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  };
  if (init.body !== undefined) fetchInit.body = JSON.stringify(init.body);
  const res = await fetch(`${AGENTMAIL_API_BASE}${path}`, fetchInit);
  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable body>");
    throw new Error(`AgentMail API error ${res.status} on ${path}: ${body}`);
  }
  return res;
}

function buildDraftBody(request: DraftRequest): string {
  if (!request.collateralLinks || request.collateralLinks.length === 0) {
    return request.bodyText;
  }
  const links = request.collateralLinks.map((link) => `- ${link}`).join("\n");
  return `${request.bodyText}\n\n---\nAttached collateral:\n${links}`;
}

class AgentMailDraftClient implements EmailDraftClient {
  constructor(
    private readonly apiKey: string,
    private readonly inboxId: string | undefined
  ) {}

  async createDraft(request: DraftRequest): Promise<DraftResult> {
    const path = this.inboxId ? `/inboxes/${this.inboxId}/drafts` : "/drafts";
    const res = await agentMailFetch(this.apiKey, path, {
      method: "POST",
      body: {
        to: [request.toEmail],
        subject: request.subject,
        text: buildDraftBody(request),
        // AgentMail's draft-creation endpoint (POST .../drafts) only ever
        // composes a draft in the mailbox's Drafts folder — there is no
        // "send: true" or equivalent flag on this call, and this client
        // never calls AgentMail's separate send endpoint. See module
        // docstring / docs/SPEC.md §6.3 for why that split matters.
        metadata: { lead_id: request.leadId }
      }
    });
    const body = (await res.json()) as AgentMailDraftResponse;
    const result: DraftResult = { draftId: body.draft_id };
    if (body.thread_id !== undefined) result.threadId = body.thread_id;
    return result;
  }

  async listInboundMessages(sinceIso: string): Promise<InboundMessage[]> {
    const path = this.inboxId
      ? `/inboxes/${this.inboxId}/messages?direction=inbound&since=${encodeURIComponent(sinceIso)}`
      : `/messages?direction=inbound&since=${encodeURIComponent(sinceIso)}`;
    const res = await agentMailFetch(this.apiKey, path, { method: "GET" });
    const body = (await res.json()) as AgentMailInboundListResponse;
    return body.messages.map((m) => {
      const message: InboundMessage = {
        externalMessageId: m.message_id,
        fromEmail: m.from,
        bodyText: m.text ?? "",
        receivedAtIso: m.received_at
      };
      if (m.thread_id !== undefined) message.externalThreadId = m.thread_id;
      if (m.subject !== undefined) message.subject = m.subject;
      return message;
    });
  }
}

export function createAgentMailClient(apiKey: string, inboxId?: string): EmailDraftClient {
  if (!apiKey) {
    throw new Error(
      "createAgentMailClient requires a non-empty API key. See AGENTMAIL_API_KEY in .env / docs/GOOGLE_CLOUD_SETUP.md."
    );
  }
  return new AgentMailDraftClient(apiKey, inboxId);
}
