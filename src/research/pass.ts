/**
 * Research loop — lead enrichment (website scrape, email/phone/socials
 * extraction, LLM categorization, completeness scoring).
 * See docs/SPEC.md §5 for the full process specification.
 *
 * Responsibilities (per spec, do not narrow scope without updating SPEC.md):
 *   1. Process leads with research_status in {pending, in_progress}, oldest first.
 *   2. Scrape website (home + contact/about) for email, phone, socials, description.
 *   3. If no website, attempt a web search to find one before giving up on that field.
 *   4. Run LLM categorization against the local categories.md catalog -> product_fit_*.
 *   5. Recompute research_score (see SPEC.md §5.2 weights).
 *   6. On score >= completion threshold: mark research_status=completed.
 *   7. On repeated failure to improve score past maxResearchAttempts: mark
 *      research_status=failed_permanent with a reason — never delete, never
 *      silently drop (see docs/SPEC.md "no drops" principle).
 *   8. Log research_updated events to History with what changed.
 *
 * This loop never mutates dnc, snoozeUntil, or dupOfLeadId — those are
 * discovery/pipeline/operator-owned fields respectively (SPEC §3.1).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Lead } from "../types/domain.js";
import type { SheetsClient } from "../sheets/client.js";
import type { LlmCategorizationClient } from "../models/categorize.js";

/** Research completeness score weights (SPEC §5.2). Exported so tests/doctor tooling can assert they sum to 100. */
export const RESEARCH_SCORE_WEIGHTS = {
  website: 20,
  email: 25,
  phone: 15,
  social: 15,
  description: 15,
  productFit: 10
} as const;

const KNOWN_SOCIAL_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com"
];

/** Recomputes the 0-100 research completeness score per the weights in SPEC.md §5.2. Pure function, no I/O, so it's independently testable. */
export function computeResearchScore(
  lead: Pick<Lead, "website" | "email" | "phone" | "socials" | "productFitConfidence">
): number {
  let score = 0;
  if (lead.website) score += RESEARCH_SCORE_WEIGHTS.website;
  if (lead.email) score += RESEARCH_SCORE_WEIGHTS.email;
  if (lead.phone) score += RESEARCH_SCORE_WEIGHTS.phone;
  if (lead.socials && lead.socials.length > 0) score += RESEARCH_SCORE_WEIGHTS.social;
  // "Business description sufficient for categorization" is proxied by having
  // run categorization at all with *some* confidence recorded — see productFit
  // branch below, which double-counts intentionally per SPEC §5.2's two
  // separate line items (description-sufficient vs. categorization-confident).
  if (lead.productFitConfidence !== undefined) score += RESEARCH_SCORE_WEIGHTS.description;
  if (lead.productFitConfidence !== undefined && lead.productFitConfidence >= 0.6) {
    score += RESEARCH_SCORE_WEIGHTS.productFit;
  }
  return Math.min(score, 100);
}

/** Extracts an email address from scraped page text (mailto: links + plain-text patterns). */
function extractEmail(html: string): string | undefined {
  const mailto = html.match(/mailto:([^"'?\s>]+)/i);
  if (mailto) return mailto[1];
  const plain = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return plain ? plain[0] : undefined;
}

/** Extracts a US phone number from scraped page text. */
function extractPhone(html: string): string | undefined {
  const match = html.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  return match ? match[1] : undefined;
}

/** Extracts known social profile links from scraped page HTML. */
function extractSocials(html: string): string | undefined {
  const found: string[] = [];
  for (const domain of KNOWN_SOCIAL_DOMAINS) {
    const re = new RegExp(`https?://(?:www\\.)?${domain.replace(".", "\\.")}[^"'\\s<>]*`, "i");
    const match = html.match(re);
    if (match) found.push(match[0]);
  }
  return found.length > 0 ? found.join("; ") : undefined;
}

/** Strips HTML tags to plain text and collapses whitespace, for a rough business-description input to categorization. Not a full HTML parser — this is a best-effort scrape, not a rendering engine. */
function extractPlainText(html: string, maxChars = 2000): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxChars);
}

interface ScrapeResult {
  email?: string;
  phone?: string;
  socials?: string;
  descriptionText?: string;
  reachable: boolean;
}

/** Fetches a website's home page and a best-effort /contact page, extracting contact fields (SPEC §5.1 step 1). Best-effort: a failed fetch is not thrown, it's reflected in `reachable: false` so the caller can log it without aborting the whole research pass. */
async function scrapeWebsite(website: string): Promise<ScrapeResult> {
  try {
    const homeRes = await fetch(website, { redirect: "follow" });
    const homeHtml = await homeRes.text();

    let contactHtml = "";
    try {
      const contactUrl = new URL("/contact", website).toString();
      const contactRes = await fetch(contactUrl, { redirect: "follow" });
      if (contactRes.ok) contactHtml = await contactRes.text();
    } catch {
      // /contact not present or unreachable — home page extraction still stands.
    }

    const combined = `${homeHtml}\n${contactHtml}`;
    const result: ScrapeResult = {
      descriptionText: extractPlainText(homeHtml),
      reachable: true
    };
    const email = extractEmail(combined);
    if (email !== undefined) result.email = email;
    const phone = extractPhone(combined);
    if (phone !== undefined) result.phone = phone;
    const socials = extractSocials(combined);
    if (socials !== undefined) result.socials = socials;
    return result;
  } catch {
    return { reachable: false };
  }
}

/** Reads the local categories.md catalog once per research-cron run (SPEC §3.4). Returns its raw markdown content for direct injection into the LLM categorization prompt — no parsing beyond what the LLM itself does, so the file's format can evolve without a corresponding parser to keep in sync. */
export function readCategoriesFile(repoRoot: string): string {
  const path = join(repoRoot, "categories.md");
  return readFileSync(path, "utf8");
}

export interface ResearchPassDeps {
  sheets: SheetsClient;
  categorizer: LlmCategorizationClient;
  repoRoot: string;
  nowIso?: () => string;
}

/**
 * Runs one research pass over all leads with research_status in
 * {pending, in_progress}, oldest-discovered first, up to the configured
 * per-run/per-day budget (SPEC §5, §9.1 maxResearchLlmCallsPerDay /
 * maxScrapeFetchesPerDay).
 */
export async function runResearchPass(deps: ResearchPassDeps): Promise<void> {
  const { sheets, categorizer, repoRoot } = deps;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const config = await sheets.getConfig();
  const allLeads = await sheets.getLeads();

  const pending = allLeads
    .filter((l) => l.researchStatus === "pending" || l.researchStatus === "in_progress")
    .sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt));

  if (pending.length === 0) return;

  const categoriesMarkdown = readCategoriesFile(repoRoot);
  let scrapesUsed = 0;
  let llmCallsUsed = 0;
  const maxScrapes = config.guardrails.maxScrapeFetchesPerDay;
  const maxLlmCalls = config.guardrails.maxResearchLlmCallsPerDay;

  for (const lead of pending) {
    if (scrapesUsed >= maxScrapes && llmCallsUsed >= maxLlmCalls) break;

    const before = { ...lead };
    let scrape: ScrapeResult | undefined;

    if (lead.website && scrapesUsed < maxScrapes) {
      scrape = await scrapeWebsite(lead.website);
      scrapesUsed += 1;
      if (!scrape.reachable) {
        await sheets.appendError({
          timestamp: nowIso(),
          component: "research_cron",
          leadId: lead.leadId,
          errorType: "scrape_unreachable",
          message: `Website ${lead.website} was unreachable during research scrape.`,
          retryCount: 0
        });
      } else {
        if (scrape.email) lead.email = lead.email ?? scrape.email;
        if (scrape.phone) lead.phone = scrape.phone;
        if (scrape.socials) lead.socials = lead.socials ?? scrape.socials;
      }
    }

    if (llmCallsUsed < maxLlmCalls) {
      try {
        const categorization = await categorizer.categorize({
          businessName: lead.businessName,
          placesCategory: lead.categoryRaw,
          ...(scrape?.descriptionText ? { scrapedDescription: scrape.descriptionText } : {}),
          categoriesMarkdown
        });
        lead.productFitCategory = categorization.category;
        lead.productFitConfidence = categorization.confidence;
        lead.productFitRationale = categorization.rationale;
        llmCallsUsed += 1;
      } catch (err) {
        await sheets.appendError({
          timestamp: nowIso(),
          component: "research_cron",
          leadId: lead.leadId,
          errorType: "categorization_failed",
          message: err instanceof Error ? err.message : String(err),
          retryCount: 0
        });
      }
    }

    lead.researchScore = computeResearchScore(lead);
    lead.lastTouchedAt = nowIso();

    const priorStatus = before.researchStatus;
    if (lead.researchScore >= config.researchCompletionThreshold) {
      lead.researchStatus = "completed";
    } else {
      // Track attempts via researchStatus transition pending->in_progress
      // then rely on notes as a lightweight attempt counter, since the
      // domain schema doesn't carry a dedicated attempts field — appending
      // a short marker to notes keeps this auditable without a schema
      // change (SPEC §5.1 step 8 requires *some* record of repeated failure,
      // not a specific storage mechanism).
      const attemptMarker = "[research_attempt]";
      const attemptCount =
        (lead.notes?.split(attemptMarker).length ?? 1) - 1 + (before.notes ? 0 : 1);
      if (attemptCount >= config.maxResearchAttempts) {
        lead.researchStatus = "failed_permanent";
        lead.notes =
          `${lead.notes ?? ""}\n[research_failed_permanent] Exhausted ${config.maxResearchAttempts} research attempts without reaching the completion threshold (score=${lead.researchScore}).`.trim();
      } else {
        lead.researchStatus = "in_progress";
        lead.notes =
          `${lead.notes ?? ""}\n${attemptMarker} score=${lead.researchScore} at ${nowIso()}`.trim();
      }
    }

    await sheets.upsertLead(lead);

    const changedFields: string[] = [];
    if (lead.email !== before.email) changedFields.push("email");
    if (lead.phone !== before.phone) changedFields.push("phone");
    if (lead.socials !== before.socials) changedFields.push("socials");
    if (lead.productFitCategory !== before.productFitCategory) changedFields.push("product_fit");
    if (lead.researchScore !== before.researchScore) changedFields.push("research_score");

    await sheets.appendHistoryEvent({
      eventId: randomUUID(),
      leadId: lead.leadId,
      timestamp: nowIso(),
      actor: "research_cron",
      eventType: "research_updated",
      fromValue: priorStatus,
      toValue: lead.researchStatus,
      detail: `score ${before.researchScore}->${lead.researchScore}; changed: ${changedFields.join(", ") || "none"}`
    });
  }
}
