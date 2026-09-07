import { describe, expect, it } from "vitest";
import {
  isWithinQuietHours,
  resolveDestinationsForEvent,
  buildDefaultAdapters
} from "../../src/notifications/notifier.js";
import type { NotificationRoute, NotificationDestinationConfig } from "../../src/config/schema.js";

describe("isWithinQuietHours", () => {
  it("returns false for a zero-width window (quiet hours disabled)", () => {
    expect(isWithinQuietHours({ startHourLocal: 5, endHourLocal: 5, timezone: "UTC" }, 5)).toBe(
      false
    );
  });

  it("handles a same-day window", () => {
    const qh = { startHourLocal: 22, endHourLocal: 23, timezone: "UTC" };
    expect(isWithinQuietHours(qh, 22)).toBe(true);
    expect(isWithinQuietHours(qh, 21)).toBe(false);
  });

  it("handles a window that wraps past midnight", () => {
    const qh = { startHourLocal: 22, endHourLocal: 7, timezone: "UTC" };
    expect(isWithinQuietHours(qh, 23)).toBe(true);
    expect(isWithinQuietHours(qh, 3)).toBe(true);
    expect(isWithinQuietHours(qh, 12)).toBe(false);
    expect(isWithinQuietHours(qh, 7)).toBe(false);
  });
});

describe("resolveDestinationsForEvent", () => {
  const destinations: NotificationDestinationConfig[] = [
    { name: "owner-telegram", channel: "telegram", target: "12345", enabled: true },
    { name: "sales-slack", channel: "slack", target: "#sales", enabled: true },
    { name: "disabled-discord", channel: "discord", target: "999", enabled: false }
  ];

  it("returns [] when no route is configured for the event type", () => {
    const routes: NotificationRoute[] = [];
    expect(resolveDestinationsForEvent("lead_won", routes, destinations)).toEqual([]);
  });

  it("returns [] when the route is explicitly 'none'", () => {
    const routes: NotificationRoute[] = [{ eventType: "lead_won", channel: "none" }];
    expect(resolveDestinationsForEvent("lead_won", routes, destinations)).toEqual([]);
  });

  it("resolves all enabled destinations on the matching channel when no specific target is named", () => {
    const routes: NotificationRoute[] = [{ eventType: "lead_won", channel: "telegram" }];
    const result = resolveDestinationsForEvent("lead_won", routes, destinations);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("owner-telegram");
  });

  it("excludes disabled destinations", () => {
    const routes: NotificationRoute[] = [{ eventType: "lead_won", channel: "discord" }];
    expect(resolveDestinationsForEvent("lead_won", routes, destinations)).toEqual([]);
  });

  it("resolves a specific named destination when route.target matches a destination name", () => {
    const routes: NotificationRoute[] = [
      { eventType: "lead_won", channel: "slack", target: "sales-slack" }
    ];
    const result = resolveDestinationsForEvent("lead_won", routes, destinations);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("sales-slack");
  });

  it("synthesizes a destination for a legacy inline target with no matching named destination", () => {
    const routes: NotificationRoute[] = [
      { eventType: "lead_won", channel: "webhook", target: "https://example.com/hook" }
    ];
    const result = resolveDestinationsForEvent("lead_won", routes, destinations);
    expect(result).toHaveLength(1);
    expect(result[0]?.target).toBe("https://example.com/hook");
    expect(result[0]?.channel).toBe("webhook");
  });
});

describe("buildDefaultAdapters", () => {
  it("returns one adapter per non-none channel", () => {
    const adapters = buildDefaultAdapters();
    expect(Object.keys(adapters).sort()).toEqual(
      ["discord", "email", "sms", "slack", "telegram", "webhook"].sort()
    );
  });
});
