import { scanRepository } from '../../../inspector/agent-risk-inspector.mjs';

export async function inspectRepository(repositoryPath) {
  if (!repositoryPath) {
    throw new Error('repositoryPath is required');
  }

  const result = await scanRepository(repositoryPath, {
    authorised: true,
    environment: 'local',
  });

  return result;
}
