/** Shared normalization helpers for duplicate, DNC, and import matching. */

/** Strips formatting and returns the last 10 digits of a phone number for US-number comparison. */
export function normalizePhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return undefined;
  return digits.slice(-10);
}

/** Lowercases, strips common legal suffixes and punctuation for fuzzy business-name comparison. */
export function normalizeBusinessName(name: string | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|pllc)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Extracts a 5-digit US ZIP from a formatted address string, if present. */
export function extractZip(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const match = address.match(/\b(\d{5})(-\d{4})?\b/);
  return match ? match[1] : undefined;
}

export function normalizeEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const trimmed = email.trim().toLowerCase();
  return trimmed || undefined;
}

export function normalizeDomain(urlOrDomain: string | undefined): string | undefined {
  if (!urlOrDomain) return undefined;
  try {
    const withProtocol = /^https?:\/\//i.test(urlOrDomain) ? urlOrDomain : `https://${urlOrDomain}`;
    const hostname = new URL(withProtocol).hostname.toLowerCase();
    return hostname.replace(/^www\./, "") || undefined;
  } catch {
    return urlOrDomain
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
  }
}
