/**
 * Development-only logging. Production builds strip console calls entirely (babel config), and
 * this wrapper is a no-op there too. Never pass tokens, passwords, codes or personal data.
 */
export const log = {
  info: (message: string, extra?: Record<string, string | number | boolean | null>) => {
    if (__DEV__) console.log(`[fitcrm] ${message}`, extra ?? "");
  },
  warn: (message: string, extra?: Record<string, string | number | boolean | null>) => {
    if (__DEV__) console.warn(`[fitcrm] ${message}`, extra ?? "");
  },
};
