import type { HttpClient } from "./flex-query-fetcher";

/**
 * Adapter between the host's brokered network API (SDK 3.9 `ctx.api.network`)
 * and the `HttpClient` interface consumed by flex-query-fetcher.
 *
 * The host broker only allows HTTPS requests to hosts declared in the addon
 * manifest's `network.allowedHosts`. The IBKR Flex token rides in the URL
 * query string (`?t=TOKEN`) — never send an Authorization header.
 */

/** Minimal structural view of the SDK 3.9 NetworkAPI request/response shapes. */
export interface NetworkApiLike {
  request(req: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutSecs?: number;
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }>;
}

/** Default request timeout. IBKR statement generation can exceed 10s. */
const DEFAULT_TIMEOUT_SECS = 60;

function toTimeoutSecs(timeoutMs?: number): number {
  if (!timeoutMs || timeoutMs <= 0) return DEFAULT_TIMEOUT_SECS;
  // Host caps timeoutSecs at 120.
  return Math.min(Math.max(Math.ceil(timeoutMs / 1000), 1), 120);
}

/**
 * Wrap a `NetworkAPI` instance behind the flex-query-fetcher `HttpClient`
 * interface. The fetcher keeps its own interface unchanged; this module is the
 * only place that knows about `ctx.api.network`.
 */
export function createNetworkHttpClient(network: NetworkApiLike): HttpClient {
  return {
    async fetch(url, options = {}) {
      const response = await network.request({
        url,
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
        timeoutSecs: toTimeoutSecs(options.timeout_ms),
      });

      return {
        status: response.status,
        status_text: "",
        headers: response.headers ?? {},
        body: response.body,
        ok: response.status >= 200 && response.status < 300,
      };
    },
  };
}
