import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  categoryCatalogSanityCheck,
  checkGuardrailSanity,
  checkTierModelMapCompleteness
} from "../../src/doctor/checks.js";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "salesflow-lite-test-"));
}

describe("checkGuardrailSanity", () => {
  it("passes when daily budgets comfortably exceed cron run frequency", () => {
    const result = checkGuardrailSanity({
      maxPlacesApiCallsPerDay: 50,
      discoveryCronIntervalMinutes: 240,
      maxResearchLlmCallsPerDay: 100,
      researchCronIntervalMinutes: 20
    });
    expect(result.status).toBe("pass");
  });

  it("warns when the places budget can't cover one call per discovery run", () => {
    const result = checkGuardrailSanity({
      maxPlacesApiCallsPerDay: 3,
      discoveryCronIntervalMinutes: 60,
      maxResearchLlmCallsPerDay: 100,
      researchCronIntervalMinutes: 20
    });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("maxPlacesApiCallsPerDay");
  });

  it("warns when the research LLM budget can't cover one call per research run", () => {
    const result = checkGuardrailSanity({
      maxPlacesApiCallsPerDay: 50,
      discoveryCronIntervalMinutes: 240,
      maxResearchLlmCallsPerDay: 10,
      researchCronIntervalMinutes: 5
    });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("maxResearchLlmCallsPerDay");
  });
});

describe("checkTierModelMapCompleteness", () => {
  it("skips (not fails) when no tierModelMap is configured yet", () => {
    const result = checkTierModelMapCompleteness(undefined);
    expect(result.status).toBe("skipped");
  });

  it("skips when an empty object is passed", () => {
    const result = checkTierModelMapCompleteness({});
    expect(result.status).toBe("skipped");
  });

  it("fails when one or more tiers are missing a model id", () => {
    const result = checkTierModelMapCompleteness({ economy: "gpt-5.4-mini" });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("standard");
    expect(result.detail).toContain("premium");
  });

  it("passes when all three tiers have a model id", () => {
    const result = checkTierModelMapCompleteness({
      economy: "gpt-5.4-mini",
      standard: "claude-sonnet-4.6",
      premium: "claude-sonnet-5"
    });
    expect(result.status).toBe("pass");
  });
});

describe("categoryCatalogSanityCheck", () => {
  it("fails when the root runtime catalog is missing", () => {
    const cwd = tempRepo();
    const result = categoryCatalogSanityCheck.run({ cwd, env: {}, applyFixes: false });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("repo-root categories.md");
  });

  it("fails when docs/examples contains another plain categories.md", () => {
    const cwd = tempRepo();
    writeFileSync(
      join(cwd, "categories.md"),
      "## Menus\n\n**Typical business types**: restaurants\n",
      "utf8"
    );
    mkdirSync(join(cwd, "docs", "examples"), { recursive: true });
    writeFileSync(join(cwd, "docs", "examples", "categories.md"), "## Example\n", "utf8");

    const result = categoryCatalogSanityCheck.run({ cwd, env: {}, applyFixes: false });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("docs/examples/categories.md");
    expect(result.detail).toContain("categories.<business-or-niche>.md");
  });

  it("warns when the root runtime catalog is still the template", () => {
    const cwd = tempRepo();
    writeFileSync(
      join(cwd, "categories.md"),
      "# Target Categories\n\n⚠️ **Template file. Replace before a live install.**\n\n## Example — Menus\n\n**Typical business types**: restaurants\n",
      "utf8"
    );

    const result = categoryCatalogSanityCheck.run({ cwd, env: {}, applyFixes: false });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("still the template");
  });

  it("passes when the root runtime catalog is customized and examples are descriptively named", () => {
    const cwd = tempRepo();
    writeFileSync(
      join(cwd, "categories.md"),
      "## Menus\n\n**Typical business types**: restaurants\n",
      "utf8"
    );
    mkdirSync(join(cwd, "docs", "examples"), { recursive: true });
    writeFileSync(
      join(cwd, "docs", "examples", "categories.print-shop-satx.md"),
      "## Menus\n",
      "utf8"
    );

    const result = categoryCatalogSanityCheck.run({ cwd, env: {}, applyFixes: false });
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("Runtime catalog found");
  });
});
