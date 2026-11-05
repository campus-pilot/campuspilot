import { env } from '@campuspilot/env/server';
import type { Ingress } from '@restatedev/restate-sdk-clients';

import { connectRestateIngress } from './connect';

let restateClient: Ingress | undefined;

export const createRestateClient = (url = env.RESTATE_INGRESS_URL): Ingress =>
  connectRestateIngress(url);

export const getRestateClient = (): Ingress => {
  restateClient ??= createRestateClient();

  return restateClient;
};
