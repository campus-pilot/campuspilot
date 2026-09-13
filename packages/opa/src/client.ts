import { env } from '@campuspilot/env/server';
import type { ZodType } from 'zod';

export interface OpaDecision<TResult> {
  decision_id?: string;
  result?: TResult;
}

export class OpaHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseText: string,
  ) {
    super(`OPA request failed with status ${status}`);
    this.name = 'OpaHttpError';
  }
}

export class OpaClient {
  private readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch,
  ) {
    this.baseUrl = new URL(baseUrl);

    if (!this.baseUrl.pathname.endsWith('/')) {
      this.baseUrl.pathname += '/';
    }
  }

  async query<TInput, TResult>(
    policyPath: string,
    input: TInput,
    options?: { signal?: AbortSignal },
  ): Promise<OpaDecision<TResult>> {
    const path = policyPath
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
    const response = await this.fetcher(new URL(`v1/data/${path}`, this.baseUrl), {
      body: JSON.stringify({ input }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new OpaHttpError(response.status, await response.text());
    }

    return (await response.json()) as OpaDecision<TResult>;
  }

  /**
   * Parses both the OPA envelope and its result at the trust boundary. Use this
   * for authorization decisions so a missing or malformed result fails closed.
   */
  async queryValidated<TInput, TResult>(
    policyPath: string,
    input: TInput,
    resultSchema: ZodType<TResult>,
    options?: { signal?: AbortSignal },
  ): Promise<TResult> {
    const decision = await this.query<TInput, unknown>(policyPath, input, options);

    return resultSchema.parse(decision.result);
  }
}

let opaClient: OpaClient | undefined;

export const createOpaClient = (url = env.OPA_URL): OpaClient =>
  new OpaClient(url);

export const getOpaClient = (): OpaClient => {
  opaClient ??= createOpaClient();

  return opaClient;
};
