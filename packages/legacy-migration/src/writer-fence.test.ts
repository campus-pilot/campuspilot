import { expect, it } from 'vitest';
import { assertDeploymentFencePayload, workloadBindings } from './writer-fence.ts';

it('requires every configured Kubernetes writer to be scaled and ready at zero', () => {
  const item = { metadata: { name: 'api' }, spec: { replicas: 0 }, status: { readyReplicas: 0, availableReplicas: 0 } };
  expect(() => assertDeploymentFencePayload({ items: [item] }, ['api'])).not.toThrow();
  expect(() => assertDeploymentFencePayload({ items: [{ ...item, spec: { replicas: 1 } }] }, ['api'])).toThrow('not closed');
});

it('accepts kubectl single-deployment object output', () => {
  expect(() => assertDeploymentFencePayload({
    kind: 'Deployment',
    metadata: { name: 'api' },
    spec: { replicas: 0 },
    status: {},
  }, ['api'])).not.toThrow();
});

it('binds the writer workload to the pinned database Secret', () => {
  const deployment = {
    metadata: { name: 'api', uid: 'uid-1', resourceVersion: '42' },
    spec: {
      template: {
        spec: {
          serviceAccountName: 'campuspilot-plus',
          containers: [{ envFrom: [{ secretRef: { name: 'campuspilot-plus-api-env' } }] }],
        },
      },
    },
  };
  expect(workloadBindings({ items: [deployment] }, ['api'])).toEqual([
    expect.objectContaining({ name: 'api', databaseSecretName: 'campuspilot-plus-api-env' }),
  ]);
  deployment.spec.template.spec.containers[0]!.envFrom = [];
  expect(() => workloadBindings({ items: [deployment] }, ['api'])).toThrow('pinned database Secret');
});
