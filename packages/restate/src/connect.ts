import { connect, type Ingress } from '@restatedev/restate-sdk-clients';

/** Restate ingress client for a URL, free of any app's env module. */
export const connectRestateIngress = (url: string): Ingress => connect({ url });

export { rpc, type Ingress, type VirtualObjectDefinition } from '@restatedev/restate-sdk-clients';
