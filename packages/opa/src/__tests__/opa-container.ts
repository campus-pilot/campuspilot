import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

// Auto-detect Docker Desktop for Linux or host Docker socket
if (!process.env.DOCKER_HOST && !fs.existsSync('/var/run/docker.sock')) {
  const desktopSock = `${process.env.HOME}/.docker/desktop/docker.sock`;
  if (fs.existsSync(desktopSock)) {
    process.env.DOCKER_HOST = `unix://${desktopSock}`;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICIES_DIR = path.resolve(__dirname, '../policies');

export interface RunningOpaContainer {
  container: StartedTestContainer;
  url: string;
  stop: () => Promise<void>;
}

/**
 * Spins up an OPA container mounted with the package policies.
 */
export async function startOpaContainer(): Promise<RunningOpaContainer> {
  const container = await new GenericContainer('openpolicyagent/opa:1.20.2')
    .withCommand(['run', '--server', '--addr=0.0.0.0:8181', '/policies'])
    .withExposedPorts(8181)
    .withBindMounts([
      {
        source: POLICIES_DIR,
        target: '/policies',
        mode: 'ro',
      },
    ])
    .withWaitStrategy(Wait.forHttp('/health', 8181))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(8181);
  const url = `http://${host}:${port}`;

  return {
    container,
    url,
    stop: async () => {
      await container.stop();
    },
  };
}
