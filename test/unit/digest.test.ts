import { describe, expect, it } from "vitest";
import { renderDigestMessage, resolveDigestDestinations } from "../../src/notifications/digest.js";
import type { DigestConfig, NotificationDestinationConfig } from "../../src/config/schema.js";

describe("renderDigestMessage", () => {
  it("only renders configured sections that have data", () => {
    const msg = renderDigestMessage("Acme Print Shop", ["pipeline_funnel", "response_rate"], {
      pipelineFunnel: { new: 5, qualified: 2 },
      categoryVolume: { schools: 3 },
      responseRatePct: 12.345
    });
    expect(msg.title).toContain("Acme Print Shop");
    expect(msg.body).toContain("Pipeline funnel");
    expect(msg.body).toContain("new: 5");
    expect(msg.body).toContain("Response rate: 12.3%");
    expect(msg.body).not.toContain("category"); // category_volume not in requested sections
  });

  it("falls back to a no-data message when nothing is available", () => {
    const msg = renderDigestMessage("Acme", ["drafts_pending"], {});
    expect(msg.body).toContain("No data available");
  });

  it("renders guardrail usage with used/max pairs", () => {
    const msg = renderDigestMessage("Acme", ["guardrail_usage"], {
      guardrailUsageToday: {
        placesApiCalls: { used: 10, max: 50 },
        llmCalls: { used: 20, max: 100 },
        scrapeFetches: { used: 30, max: 150 },
        draftsCreated: { used: 2, max: 25 }
      }
    });
    expect(msg.body).toContain("Places: 10/50");
    expect(msg.body).toContain("Drafts: 2/25");
  });
});

describe("resolveDigestDestinations", () => {
  const destinations: NotificationDestinationConfig[] = [
    { name: "owner-telegram", channel: "telegram", target: "12345", enabled: true },
    { name: "sales-slack", channel: "slack", target: "#sales", enabled: false }
  ];
  const baseDigest: DigestConfig = {
    enabled: true,
    cronExpr: "0 8 * * 1",
    timezone: "America/Chicago",
    destinationNames: ["owner-telegram", "sales-slack"],
    sections: ["pipeline_funnel"],
    respectQuietHours: false
  };

  it("returns [] when the digest is disabled", () => {
    expect(
      resolveDigestDestinations({ ...baseDigest, enabled: false }, destinations, false)
    ).toEqual([]);
  });

  it("excludes disabled destinations even if named", () => {
    const result = resolveDigestDestinations(baseDigest, destinations, false);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("owner-telegram");
  });

  it("returns [] during quiet hours when respectQuietHours is true", () => {
    const result = resolveDigestDestinations(
      { ...baseDigest, respectQuietHours: true },
      destinations,
      true
    );
    expect(result).toEqual([]);
  });

  it("ignores quiet hours when respectQuietHours is false", () => {
    const result = resolveDigestDestinations(baseDigest, destinations, true);
    expect(result).toHaveLength(1);
  });
});
