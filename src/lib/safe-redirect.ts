const BASE = "https://same-origin.invalid";

/**
 * Only allow same-origin relative paths as post-login redirect targets (no open redirects).
 * Browsers strip tabs/newlines and treat "\" like "/", so "/\t/evil.com" would become
 * "//evil.com": reject any control character or whitespace, then require that parsing the value
 * against a dummy origin keeps that origin. Returns the normalised path + query + hash.
 */
export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\x00-\x20\x7f]/.test(value)) return fallback;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
