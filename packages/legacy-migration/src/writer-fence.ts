import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { stableJson, sha256 } from './source-evidence.ts';

const execFile = promisify(execFileCallback);
export type WriterFence = {
  namespace: string;
  deployments: string[];
  kubeContext: string;
  kubeconfigSha256: string;
  workloadBindings: Array<{
    name: string;
    uid: string;
    resourceVersion: string;
    serviceAccountName: string;
    databaseSecretName: string;
  }>;
  databaseSecret: {
    name: string;
    uid: string;
    resourceVersion: string;
    type: string;
  };
};
export const REQUIRED_WRITER_DEPLOYMENTS = ['api'] as const;
export const REQUIRED_WRITER_NAMESPACE = 'campuspilot-plus';
export const REQUIRED_DATABASE_SECRET = 'campuspilot-plus-api-env';

export function assertDeploymentFencePayload(payload: any, expected: string[]) {
  const items = Array.isArray(payload.items)
    ? payload.items
    : payload.kind === 'Deployment'
      ? [payload]
      : [];
  const byName = new Map(items.map((item: any) => [item.metadata?.name, item]));
  for (const name of expected) {
    const item: any = byName.get(name);
    if (!item || Number(item.spec?.replicas) !== 0 || Number(item.status?.readyReplicas ?? 0) !== 0 || Number(item.status?.availableReplicas ?? 0) !== 0)
      throw new Error(`Kubernetes writer fence is not closed for deployment ${name}`);
  }
  if (byName.size !== expected.length) throw new Error('Kubernetes writer fence returned unexpected deployment scope');
}

export function workloadBindings(payload: any, expected: string[]) {
  const items = Array.isArray(payload.items)
    ? payload.items
    : payload.kind === 'Deployment'
      ? [payload]
      : [];
  return items
    .map((item: any) => {
      const secretNames = (item.spec?.template?.spec?.containers ?? [])
        .flatMap((container: any) => container.envFrom ?? [])
        .map((entry: any) => entry.secretRef?.name)
        .filter(Boolean);
      if (!secretNames.includes(REQUIRED_DATABASE_SECRET))
        throw new Error(`Kubernetes writer ${item.metadata?.name} is not bound to the pinned database Secret`);
      return {
        name: String(item.metadata?.name ?? ''),
        uid: String(item.metadata?.uid ?? ''),
        resourceVersion: String(item.metadata?.resourceVersion ?? ''),
        serviceAccountName: String(item.spec?.template?.spec?.serviceAccountName ?? ''),
        databaseSecretName: REQUIRED_DATABASE_SECRET,
      };
    })
    .toSorted((left: any, right: any) => left.name.localeCompare(right.name))
    .filter((item: any) => expected.includes(item.name));
}

/** Query Kubernetes itself; an environment boolean is never sufficient. */
export async function verifyKubernetesWriterFence(options: {
  kubeconfig: string; namespace: string; deployments: string[];
}) {
  if (options.namespace !== REQUIRED_WRITER_NAMESPACE)
    throw new Error(`Writer fence namespace must be ${REQUIRED_WRITER_NAMESPACE}`);
  const { stdout: context } = await execFile('kubectl', ['--kubeconfig', options.kubeconfig, 'config', 'current-context']);
  const args = ['--kubeconfig', options.kubeconfig, '-n', options.namespace, 'get', 'deployment', ...options.deployments, '-o', 'json'];
  const { stdout } = await execFile('kubectl', args);
  const deploymentPayload = JSON.parse(stdout);
  assertDeploymentFencePayload(deploymentPayload, options.deployments);
  const { stdout: secretOutput } = await execFile('kubectl', [
    '--kubeconfig', options.kubeconfig, '-n', options.namespace,
    'get', 'secret', REQUIRED_DATABASE_SECRET, '-o', 'json',
  ]);
  const secret = JSON.parse(secretOutput);
  if (secret.metadata?.name !== REQUIRED_DATABASE_SECRET ||
    !secret.metadata?.uid || !secret.metadata?.resourceVersion)
    throw new Error('Pinned target database Secret identity is incomplete');
  const { readFile } = await import('node:fs/promises');
  return {
    namespace: options.namespace, deployments: [...options.deployments].toSorted(),
    kubeContext: context.trim(), kubeconfigSha256: sha256(await readFile(options.kubeconfig)),
    workloadBindings: workloadBindings(deploymentPayload, options.deployments),
    databaseSecret: {
      name: REQUIRED_DATABASE_SECRET,
      uid: String(secret.metadata.uid),
      resourceVersion: String(secret.metadata.resourceVersion),
      type: String(secret.type ?? ''),
    },
  } satisfies WriterFence;
}

export function writerFenceSha256(fence: WriterFence) { return sha256(stableJson(fence)); }
