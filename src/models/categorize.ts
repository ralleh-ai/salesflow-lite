/**
 * LLM categorization client for the research loop (SPEC §5.1 step 3 / §3.4).
 * Separate from src/models/router.ts (which only resolves *which* model/tier
 * to use, no I/O) — this module is the thin I/O boundary that actually
 * calls a model with a lead's scraped data + the categories.md catalog and
 * parses the result. Kept provider-agnostic on purpose: an OpenClaw install
 * may expose model access differently than a bare API key, so the concrete
 * implementation is injected by the caller (see createOpenClawCategorizer)
 * rather than this module importing a specific SDK.
 */
import type { ResolvedModelForTask } from "./router.js";

export interface CategorizationInput {
  businessName: string;
  placesCategory: string;
  /** Scraped homepage text, if a website was reachable this run. */
  scrapedDescription?: string;
  /** Full contents of categories.md, injected verbatim into the prompt (SPEC §3.4). */
  categoriesMarkdown: string;
}

export interface CategorizationResult {
  category: string;
  confidence: number;
  rationale: string;
}

export interface LlmCategorizationClient {
  /** True when this categorizer consumes paid/model LLM budget. False for deterministic local categorization. */
  readonly consumesLlmBudget?: boolean;
  categorize(input: CategorizationInput): Promise<CategorizationResult>;
}

/** Builds the categorization prompt sent to the model. Exported for unit testing prompt construction independent of any actual model call. */
export function buildCategorizationPrompt(input: CategorizationInput): string {
  return [
    "You are categorizing a discovered business lead against a fixed product/service catalog.",
    "Respond with ONLY a JSON object of the shape:",
    '{"category": "<one heading from the catalog below, exactly as written after \'## \'>", "confidence": <number 0-1>, "rationale": "<1-2 sentences>"}',
    'If nothing in the catalog is a plausible fit, use "category": "none" and confidence 0.',
    "",
    `Business name: ${input.businessName}`,
    `Google Places category/types: ${input.placesCategory}`,
    input.scrapedDescription
      ? `Scraped website text (may be partial/noisy):\n${input.scrapedDescription}`
      : "No website reachable — categorize from name/Places category alone.",
    "",
    "--- Product/service catalog (categories.md) ---",
    input.categoriesMarkdown
  ].join("\n");
}

/** Parses a model's raw text response into a CategorizationResult, tolerating minor formatting noise (e.g. a model wrapping JSON in a code fence). Throws on genuinely unparseable output — the caller (research/pass.ts) already treats a categorization failure as non-fatal per lead. */
export function parseCategorizationResponse(raw: string): CategorizationResult {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Categorization response did not contain a JSON object: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]) as Partial<CategorizationResult>;
  if (
    typeof parsed.category !== "string" ||
    typeof parsed.confidence !== "number" ||
    typeof parsed.rationale !== "string"
  ) {
    throw new Error(`Categorization response JSON missing required fields: ${jsonMatch[0]}`);
  }
  return {
    category: parsed.category,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    rationale: parsed.rationale
  };
}

/**
 * Function signature for actually invoking a model, injected by the caller
 * so this module never hardcodes a provider SDK. On an OpenClaw install this
 * is expected to be backed by the install's own model-invocation tooling
 * (resolved to a concrete model id via src/models/router.ts's
 * resolveModelForTask() beforehand) rather than a bundled HTTP client here.
 */
export type ModelInvoker = (params: { modelId: string; prompt: string }) => Promise<string>;

class GenericLlmCategorizer implements LlmCategorizationClient {
  readonly consumesLlmBudget = true;

  constructor(
    private readonly invokeModel: ModelInvoker,
    private readonly resolvedModel: Pick<ResolvedModelForTask, "modelId">
  ) {}

  async categorize(input: CategorizationInput): Promise<CategorizationResult> {
    const prompt = buildCategorizationPrompt(input);
    const raw = await this.invokeModel({ modelId: this.resolvedModel.modelId, prompt });
    return parseCategorizationResponse(raw);
  }
}

/**
 * Constructs an LlmCategorizationClient backed by a caller-supplied model
 * invocation function and a pre-resolved model id (see
 * src/models/router.ts's resolveModelForTask() for how the caller should
 * pick that model id for the `lead_categorization` task type).
 */
export function createLlmCategorizer(
  invokeModel: ModelInvoker,
  resolvedModel: Pick<ResolvedModelForTask, "modelId">
): LlmCategorizationClient {
  return new GenericLlmCategorizer(invokeModel, resolvedModel);
}

interface ParsedCatalogCategory {
  name: string;
  terms: string[];
  pitchNotes?: string;
}

function parseCatalog(markdown: string): ParsedCatalogCategory[] {
  const sections = markdown.split(/^##\s+/m).slice(1);
  return sections
    .map((section) => {
      const [rawTitle = "", ...rest] = section.split("\n");
      const body = rest.join("\n");
      const typical = body.match(/\*\*Typical business types\*\*:\s*([^\n]+)/i)?.[1] ?? "";
      const pitchNotes = body.match(/\*\*Pitch notes\*\*:\s*([\s\S]*?)(?=\n\n|$)/i)?.[1]?.trim();
      const terms = typical
        .split(",")
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean);
      return { name: rawTitle.trim(), terms, ...(pitchNotes ? { pitchNotes } : {}) };
    })
    .filter((category) => category.name && category.terms.length > 0);
}

function termMatches(haystack: string, term: string): boolean {
  if (haystack.includes(term)) return true;
  if (term.endsWith("s") && haystack.includes(term.slice(0, -1))) return true;
  return false;
}

/**
 * Deterministic, zero-LLM categorizer for Phase 1 lead packs. It matches the
 * lead name/category/scraped text against categories.md's "Typical business
 * types" terms, providing a cheap baseline before an operator opts into LLM
 * judgment for higher-touch outreach.
 */
export function createKeywordCategorizer(): LlmCategorizationClient {
  return {
    consumesLlmBudget: false,
    async categorize(input: CategorizationInput): Promise<CategorizationResult> {
      const haystack = [input.businessName, input.placesCategory, input.scrapedDescription ?? ""]
        .join("\n")
        .toLowerCase();
      const categories = parseCatalog(input.categoriesMarkdown);
      let best: { category: ParsedCatalogCategory; matches: number } | undefined;
      for (const category of categories) {
        const matches = category.terms.filter((term) => termMatches(haystack, term)).length;
        if (matches > 0 && (!best || matches > best.matches)) best = { category, matches };
      }

      if (!best) {
        return {
          category: "none",
          confidence: 0,
          rationale:
            "No configured category terms matched the lead name, Places category, or scraped website text."
        };
      }

      return {
        category: best.category.name,
        confidence: Math.min(0.8, 0.45 + best.matches * 0.15),
        rationale: `Matched ${best.matches} configured target term(s) for ${best.category.name}. ${best.category.pitchNotes ?? "Review manually before outreach."}`
      };
    }
  };
}
