import path from 'node:path';
import { scanRepositoryScopeConsistency } from '../inspector/repository-scope-consistency.mjs';

const root = path.resolve(process.argv[2] || '.');
const result = scanRepositoryScopeConsistency(root);
console.log(JSON.stringify(result, null, 2));

if (result.findings.length) process.exitCode = 2;
