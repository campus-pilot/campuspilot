import { env } from '@campuspilot/env/server';
import {
  connect,
  type Ingress,
} from '@restatedev/restate-sdk-clients';

let restateClient: Ingress | undefined;

export const createRestateClient = (
  url = env.RESTATE_INGRESS_URL,
): Ingress => connect({ url });

export const getRestateClient = (): Ingress => {
  restateClient ??= createRestateClient();

  return restateClient;
};
