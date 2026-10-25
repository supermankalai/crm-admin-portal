/**
 * Structured JSON logger with redaction. Never pass decrypted personal data, passwords,
 * tokens or keys — and if one slips into a context object, it is masked here.
 */

type Level = "trace" | "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };

const REDACT_KEY =
  /pass(word)?|secret|token|authorization|cookie|key$|^key|enc$|phone|address|dateofbirth|dob|emergency|health|notes?$|body$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      REDACT_KEY.test(k) ? "[redacted]" : redact(v, depth + 1),
    ])
  );
}

function threshold(): number {
  const level = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return LEVELS[level] ?? LEVELS.info;
}

function write(level: Level, msg: string, context?: Record<string, unknown>) {
  if (LEVELS[level] < threshold()) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...(redact(context) as object) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  trace: (msg: string, ctx?: Record<string, unknown>) => write("trace", msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => write("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
};
