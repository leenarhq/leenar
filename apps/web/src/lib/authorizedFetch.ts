import { getFreshToken } from "./token";

export interface AuthorizedFetchDeps {
  getToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

/**
 * fetch() with the current fresh bearer token. On a 401 it forces one token
 * refresh and retries exactly once, so a just-expired token never surfaces as a
 * user-facing error (and never produces a server-side auth-failure event).
 */
export async function authorizedFetch(
  url: string,
  init: RequestInit = {},
  deps: AuthorizedFetchDeps = {},
): Promise<Response> {
  const getToken = deps.getToken ?? getFreshToken;
  const doFetch = deps.fetchImpl ?? fetch;

  const send = async (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return doFetch(url, { ...init, headers });
  };

  let res = await send(await getToken());
  if (res.status === 401) {
    // Force a refresh (getFreshToken refreshes when near/after expiry) and retry once.
    res = await send(await getToken());
  }
  return res;
}
