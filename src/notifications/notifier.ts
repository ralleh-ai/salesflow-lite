/**
 * SalesFlow-Lite — provider-agnostic notification dispatch.
 * Mirrors docs/SPEC.md §7 (Notifications). Every channel implements the
 * same narrow interface so event-routing and digest logic never need to
 * know which channel they're talking to — same pattern as
 * src/agentmail/client.ts's EmailDraftClient for outreach.
 *
 * Hard rules (see docs/SPEC.md §7.4):
 *   - A channel adapter only ever *sends a notification the operator
 *     configured*. It must never be repurposed to send outreach to a lead
 *     — that stays exclusively the drafts-only EmailDraftClient's job.
 *   - Every dispatch attempt (sent, skipped, or failed) is logged via
 *     appendNotificationLogEntry() — no silent drops, matching the rest of
 *     the app's audit posture.
 *   - Quiet hours are checked once, centrally, in Notifier.dispatch() —
 *     individual channel adapters never re-implement that logic.
 */
import type { NotificationChannelKind } from "../types/domain.js";
import type { AppConfig, NotificationDestinationConfig } from "../config/schema.js";

export interface NotificationMessage {
  /** Short line suitable for a push notification / SMS; always required. */
  title: string;
  /** Longer body; channels that only support a single line may concatenate title+body. */
  body: string;
  /** Optional deep-link back to the relevant Sheets row/tab, when the channel supports links. */
  sheetLink?: string;
}

/** One channel's ability to deliver a NotificationMessage to a specific target string. */
export interface NotificationChannelAdapter {
  readonly channel: NotificationChannelKind;
  send(
    target: string,
    message: NotificationMessage
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * Adapter stub — real implementation wires to OpenClaw's `message` tool
 * (per AGENTS.md: never hand-roll provider HTTP calls when a first-class
 * tool exists). Channel === "telegram" | "discord" | "slack" all route
 * through the same OpenClaw `message` tool with a different `channel`
 * param; kept as separate NotificationChannelKind values because operators
 * think and configure in terms of the platform name, not the tool name.
 */
export class OpenClawMessageAdapter implements NotificationChannelAdapter {
  constructor(public readonly channel: "telegram" | "discord" | "slack") {}

  send(
    _target: string,
    _message: NotificationMessage
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    throw new Error(
      `OpenClawMessageAdapter.send() not yet implemented for channel=${this.channel} — wire to the OpenClaw \`message\` tool (action=send) once credentials/target routing land. See docs/SPEC.md §7.1.`
    );
  }
}

/** Email notification adapter — distinct from EmailDraftClient. Operator-facing notifications (e.g. "new qualified lead") may be sent directly; they are notifications *about* the business, not outreach *to* a lead, so the drafts-only rule does not apply here. See docs/SPEC.md §7.4 for the exact boundary. */
export class EmailNotificationAdapter implements NotificationChannelAdapter {
  readonly channel = "email" as const;

  send(
    _target: string,
    _message: NotificationMessage
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    throw new Error(
      "EmailNotificationAdapter.send() not yet implemented — wire to the configured email provider's transactional-send capability (this is the one place a real 'send', not a draft, is appropriate — see SPEC §7.4). See docs/SPEC.md §7.1."
    );
  }
}

/** Generic webhook adapter — for operators wiring their own alerting (PagerDuty, Zapier, a custom endpoint, etc.). */
export class WebhookNotificationAdapter implements NotificationChannelAdapter {
  readonly channel = "webhook" as const;

  send(
    _target: string,
    _message: NotificationMessage
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    throw new Error(
      "WebhookNotificationAdapter.send() not yet implemented — POST message JSON to the configured URL. See docs/SPEC.md §7.1."
    );
  }
}

/** SMS adapter — deliberately last-class-citizen; most operators will prefer Telegram/email, but some want a text for urgent items (e.g. quota exhaustion). */
export class SmsNotificationAdapter implements NotificationChannelAdapter {
  readonly channel = "sms" as const;

  send(
    _target: string,
    _message: NotificationMessage
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    throw new Error(
      "SmsNotificationAdapter.send() not yet implemented — requires an SMS provider (e.g. Twilio) configured by the operator. See docs/SPEC.md §7.1."
    );
  }
}

export function buildDefaultAdapters(): Record<
  Exclude<NotificationChannelKind, "none">,
  NotificationChannelAdapter
> {
  return {
    telegram: new OpenClawMessageAdapter("telegram"),
    discord: new OpenClawMessageAdapter("discord"),
    slack: new OpenClawMessageAdapter("slack"),
    email: new EmailNotificationAdapter(),
    webhook: new WebhookNotificationAdapter(),
    sms: new SmsNotificationAdapter()
  };
}

/**
 * Pure function: is `atIsoTimestamp` inside the operator's configured quiet
 * hours? No I/O, no Date.now() default — the caller supplies "now" so this
 * stays trivially unit-testable across timezone/midnight-wrap edge cases.
 * Handles the wrap-around case (e.g. startHourLocal=22, endHourLocal=7).
 */
export function isWithinQuietHours(
  quietHours: NonNullable<AppConfig["quietHours"]>,
  atLocalHour: number
): boolean {
  const { startHourLocal, endHourLocal } = quietHours;
  if (startHourLocal === endHourLocal) return false; // zero-width window disables quiet hours
  if (startHourLocal < endHourLocal) {
    return atLocalHour >= startHourLocal && atLocalHour < endHourLocal;
  }
  // Wraps past midnight, e.g. 22 -> 7
  return atLocalHour >= startHourLocal || atLocalHour < endHourLocal;
}

/**
 * Resolves the destination(s) for a given event type against the operator's
 * `notifications` routing table and `notificationDestinations` list. Pure
 * function so routing logic is testable without constructing a full
 * Notifier. Returns [] (not an error) when an event type has no route
 * configured or is explicitly routed to "none" — both are valid, silent-by-
 * design outcomes, distinct from a delivery failure.
 */
export function resolveDestinationsForEvent(
  eventType: string,
  routes: AppConfig["notifications"],
  destinations: NotificationDestinationConfig[]
): NotificationDestinationConfig[] {
  const route = routes.find((r) => r.eventType === eventType);
  if (!route || route.channel === "none") return [];
  // Route may reference a destination by name (preferred, supports multiple
  // named targets per channel) or, for backward compatibility with the
  // pre-multi-channel config shape, carry its own inline target.
  const byChannel = destinations.filter((d) => d.enabled && d.channel === route.channel);
  if (route.target) {
    const named = byChannel.find((d) => d.name === route.target || d.target === route.target);
    if (named) return [named];
    // Inline target with no matching named destination — synthesize one so
    // legacy single-target configs (route.target as a raw address) keep working.
    return [{ name: route.eventType, channel: route.channel, target: route.target, enabled: true }];
  }
  return byChannel;
}
