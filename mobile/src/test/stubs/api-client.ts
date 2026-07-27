/**
 * `api/client` with NO TRANSPORT.
 *
 * The real module is an axios instance whose base URL falls back to the staging
 * deployment, and staging shares a Supabase database with production. This stub
 * has no socket, no axios and no URL — there is no code path from the test suite
 * to a network, which is a property of the harness rather than a promise about
 * how carefully the tests are written.
 *
 * `net.handler` decides what each call does, so a test can make the third POST
 * fail and the fourth succeed without touching anything real.
 */

export interface Call { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; url: string; body?: unknown }

export const net = {
  /** Every request this suite has made, in order. */
  calls: [] as Call[],
  /** Decides the outcome. Throw to fail the request. */
  handler: (async () => ({ data: {} })) as (call: Call) => Promise<{ data: unknown }>,
};

async function record(method: Call['method'], url: string, body?: unknown) {
  const call: Call = { method, url, body };
  net.calls.push(call);
  return net.handler(call);
}

export const apiClient = {
  get:    (url: string) => record('GET', url),
  post:   (url: string, body?: unknown) => record('POST', url, body),
  patch:  (url: string, body?: unknown) => record('PATCH', url, body),
  put:    (url: string, body?: unknown) => record('PUT', url, body),
  delete: (url: string) => record('DELETE', url),
  interceptors: { response: { use: () => undefined } },
};

export function __resetNet(): void {
  net.calls.length = 0;
  net.handler = async () => ({ data: {} });
}

/** Bodies of every POST to `url`, in order. */
export function __postsTo(url: string): unknown[] {
  return net.calls.filter(c => c.method === 'POST' && c.url === url).map(c => c.body);
}

/** Make every request reject, as an offline device would. */
export function __goOffline(message = 'Network Error'): void {
  net.handler = async () => { throw new Error(message); };
}

/** An axios-shaped HTTP rejection, for status-dependent paths. */
export function __failWith(status: number): void {
  net.handler = async () => {
    const err = new Error(`Request failed with status code ${status}`) as Error & {
      response?: { status: number };
    };
    err.response = { status };
    throw err;
  };
}

export default apiClient;
