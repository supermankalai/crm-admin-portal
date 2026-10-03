import { api, MOBILE_API_BASE, type EndpointName, type RequestOf, type ResponseOf } from "./contract";
import { apiErrorSchema } from "./schemas";

/**
 * Typed client for the mobile API, derived from the contract. Responses are validated with the
 * contract's schemas. On a 401 it asks the host app to refresh once, then retries.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown when the request never reached the server (offline, DNS, TLS). */
export class NetworkError extends Error {
  constructor(message = "You're offline or the server can't be reached.") {
    super(message);
    this.name = "NetworkError";
  }
}

export type ClientOptions = {
  /** e.g. https://app.example.com (no trailing slash). */
  baseUrl: string;
  getAccessToken: () => string | null | Promise<string | null>;
  /** Called once on a 401 from an authenticated endpoint; return true if tokens were refreshed. */
  refresh?: () => Promise<boolean>;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

function buildPath(template: string, params?: Record<string, unknown>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(params?.[key] ?? "")));
}

function buildQuery(query?: Record<string, unknown>) {
  if (!query) return "";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function createApiClient(options: ClientOptions) {
  // Looked up per request, so a fetch installed or replaced later (polyfills, tests) is used.
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);

  async function send<N extends EndpointName>(name: N, input: RequestOf<N>, retried: boolean): Promise<ResponseOf<N>> {
    const def = api[name];
    const req = input as { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown };
    const url = `${options.baseUrl}${MOBILE_API_BASE}${buildPath(def.path, req.params)}${buildQuery(req.query)}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (def.auth !== "none") {
      const token = await options.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (req.body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await doFetch(url, { method: def.method, headers, body: req.body !== undefined ? JSON.stringify(req.body) : undefined, signal: controller.signal });
    } catch {
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 && def.auth !== "none" && !retried && options.refresh && (await options.refresh())) {
      return send(name, input, true);
    }

    const json: unknown = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) {
      const parsed = apiErrorSchema.safeParse(json);
      if (parsed.success) throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.fieldErrors);
      throw new ApiError(res.status, "http_error", `Request failed (${res.status}).`);
    }
    return def.response.parse(json) as ResponseOf<N>;
  }

  return {
    call<N extends EndpointName>(name: N, ...args: object extends RequestOf<N> ? [input?: RequestOf<N>] : [input: RequestOf<N>]): Promise<ResponseOf<N>> {
      return send(name, (args[0] ?? {}) as RequestOf<N>, false);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
