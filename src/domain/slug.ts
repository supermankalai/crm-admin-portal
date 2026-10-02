/** Gym URL slugs: /g/<slug>/… */

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;

/** Slugs that could be confused with platform routes or impersonate the platform. */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "billing", "dashboard", "g", "help", "login", "logout", "new",
  "platform", "pricing", "select-gym", "settings", "signup", "static", "status", "support", "www",
  "fitcrm", "root", "system",
]);

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/, "");
}

export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return "Use at least 3 characters";
  if (slug.length > 48) return "Use at most 48 characters";
  if (!SLUG_PATTERN.test(slug)) return "Use lowercase letters, numbers and single hyphens (not at the start or end)";
  if (slug.includes("--")) return "Use single hyphens only";
  if (RESERVED_SLUGS.has(slug)) return "This address is reserved";
  return null;
}
