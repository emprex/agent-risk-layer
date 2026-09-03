import fs from 'node:fs';

const file = new URL('../server.js', import.meta.url);
let source = fs.readFileSync(file, 'utf8');

const inspectorImport = "import { attachInspectionToResult, consumeInspectionUpload, createInspectionToken, getInspection, latestInspection, listInspectionsForAssessment } from './src/inspector.js';";
const githubImport = "import { runFrozenGithubSourceInspection } from './src/github-source-inspection.js';";
if (!source.includes(githubImport)) {
  if (!source.includes(inspectorImport)) throw new Error('Expected Inspector import anchor was not found in server.js');
  source = source.replace(inspectorImport, `${inspectorImport}\n${githubImport}`);
}

const routeAnchor = "        if (req.method === 'POST' && url.pathname === '/api/inspector/tokens') {";
const githubRoute = `        if (req.method === 'POST' && url.pathname === '/api/inspector/github') {\n            if (!requireUser(req, res) || !requireVerifiedEmail(req, res))\n                return;\n            if (!await rateLimitAllowed(req, { windowMs: 60000, max: 4, bucket: 'github-source-inspection', identity: req.user.id }))\n                return json(res, 429, { error: 'Too many hosted source-inspection requests. Wait a minute and try again.' });\n            const body = await readBody(req);\n            try {\n                const result = await runFrozenGithubSourceInspection({\n                    userId: req.user.id,\n                    assessmentId: cleanText(body.assessmentId, 80),\n                });\n                return json(res, 201, result);\n            }\n            catch (error) {\n                return json(res, error.statusCode || 400, { error: error.message });\n            }\n        }\n`;
if (!source.includes("url.pathname === '/api/inspector/github'")) {
  if (!source.includes(routeAnchor)) throw new Error('Expected Inspector token route anchor was not found in server.js');
  source = source.replace(routeAnchor, `${githubRoute}${routeAnchor}`);
}

fs.writeFileSync(file, source);
console.log('Applied hosted GitHub source-inspection route to server.js');
