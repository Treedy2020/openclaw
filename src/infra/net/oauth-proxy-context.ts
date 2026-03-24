import { resolveProxyFetchFromEnv } from "./proxy-fetch.js";
import { forceGlobalUndiciEnvProxyDispatcher } from "./undici-global-dispatcher.js";

function isLikelyMockedFetch(fetchImpl: typeof fetch): boolean {
  const candidate = fetchImpl as { mock?: unknown; _isMockFunction?: unknown };
  return Boolean(candidate?.mock) || candidate?._isMockFunction === true;
}

/**
 * Ensure OAuth network calls honor HTTP(S)_PROXY in this process.
 * Returns a restore function for any temporary global fetch override.
 */
export function installOAuthProxyContext(env: NodeJS.ProcessEnv = process.env): () => void {
  forceGlobalUndiciEnvProxyDispatcher();

  if (isLikelyMockedFetch(globalThis.fetch)) {
    return () => {};
  }

  const proxyFetch = resolveProxyFetchFromEnv(env);
  if (!proxyFetch) {
    return () => {};
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = proxyFetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}
