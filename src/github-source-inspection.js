import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { db, insertEvent, nowIso } from './db.js';
import { createInspectionToken, consumeInspectionUpload, getInspection } from './inspector.js';
import { scanRepository } from '../public/downloads/agent-risk-inspector.mjs';

const TARGET_MARKER = '[ARL_TARGET]';
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 150 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const GITHUB_REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA40_RE = /^[a-f0-9]{40}$/i;

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function parseFrozenGithubTarget(assessment = {}) {
  const answers = parseJson(assessment.answers_json, assessment.answers || {});
  const result = parseJson(assessment.result_json, assessment.result || {});
  const raw = String(
    result.systemDescription
    || assessment.systemDescription
    || answers.__system_description
    || '',
  );
  const markerIndex = raw.indexOf(TARGET_MARKER);
  if (markerIndex < 0) return null;
  const targetText = raw.slice(markerIndex + TARGET_MARKER.length);
  const repository = targetText.match(/Repository:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const revision = targetText.match(/Revision:\s*([a-f0-9]{40})/i)?.[1]?.toLowerCase() || '';
  if (!GITHUB_REPOSITORY_RE.test(repository) || !SHA40_RE.test(revision)) return null;
  return { repository, revision };
}

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'AgentRiskLayer-GitHub-Source-Evidence',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: githubHeaders(),
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const reason = response.status === 404
      ? 'GitHub repository or frozen revision was not found.'
      : `GitHub returned HTTP ${response.status}.`;
    throw Object.assign(new Error(reason), { statusCode: response.status === 404 ? 404 : 502 });
  }
  return response.json();
}

async function verifyPublicFrozenTarget(target) {
  const repo = await githubJson(`https://api.github.com/repos/${target.repository}`);
  if (repo.private) {
    throw Object.assign(new Error('Private GitHub repositories are not fetched by the hosted Inspector. Use the local Inspector fallback for private source.'), { statusCode: 400 });
  }
  const commit = await githubJson(`https://api.github.com/repos/${target.repository}/commits/${target.revision}`);
  const resolved = String(commit.sha || '').toLowerCase();
  if (resolved !== target.revision) {
    throw Object.assign(new Error(`Frozen revision mismatch: expected ${target.revision} but GitHub resolved ${resolved || 'no commit'}.`), { statusCode: 409 });
  }
  return {
    repositoryId: repo.id || null,
    defaultBranch: repo.default_branch || null,
    commitUrl: commit.html_url || `https://github.com/${target.repository}/commit/${target.revision}`,
  };
}

async function fetchArchive(target) {
  const response = await fetch(`https://api.github.com/repos/${target.repository}/tarball/${target.revision}`, {
    headers: githubHeaders(),
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Object.assign(new Error(`GitHub source archive download failed with HTTP ${response.status}.`), { statusCode: 502 });
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength && contentLength > MAX_ARCHIVE_BYTES) {
    throw Object.assign(new Error('The GitHub source archive is too large for hosted inspection. Use the local Inspector fallback.'), { statusCode: 413 });
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES) {
    throw Object.assign(new Error('The GitHub source archive is empty or too large for hosted inspection.'), { statusCode: 413 });
  }
  return bytes;
}

function tarString(buffer, start, length) {
  return buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '').trim();
}

function tarOctal(buffer, start, length) {
  const value = tarString(buffer, start, length).replace(/[^0-7].*$/, '').trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function safeRelativeTarPath(name) {
  const normalised = String(name || '').replaceAll('\\', '/').replace(/^\/+/, '');
  const parts = normalised.split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  const relative = parts.slice(1).join('/');
  const clean = path.posix.normalize(relative);
  if (!clean || clean === '.' || clean.startsWith('../') || clean.includes('/../') || path.posix.isAbsolute(clean)) return '';
  return clean;
}

function extractTarGz(bytes, destination) {
  const tar = gunzipSync(bytes, { finishFlush: 2 });
  let offset = 0;
  let extractedBytes = 0;
  let files = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = tarOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const relative = safeRelativeTarPath(fullName);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error('GitHub source archive is truncated.');
    if (relative && (type === '0' || type === '\0')) {
      if (size <= MAX_ENTRY_BYTES) {
        extractedBytes += size;
        if (extractedBytes > MAX_EXTRACTED_BYTES) throw Object.assign(new Error('GitHub source archive exceeds the hosted inspection extraction limit.'), { statusCode: 413 });
        const targetPath = path.join(destination, ...relative.split('/'));
        const resolved = path.resolve(targetPath);
        const root = `${path.resolve(destination)}${path.sep}`;
        if (!resolved.startsWith(root)) throw new Error('Unsafe path in GitHub source archive.');
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, tar.subarray(dataStart, dataEnd), { mode: 0o600 });
        files += 1;
      }
    } else if (relative && type === '5') {
      const targetPath = path.resolve(destination, ...relative.split('/'));
      const root = `${path.resolve(destination)}${path.sep}`;
      if (targetPath.startsWith(root)) fs.mkdirSync(targetPath, { recursive: true, mode: 0o700 });
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (!files) throw new Error('No inspectable files were extracted from the GitHub source archive.');
  return { files, extractedBytes };
}

async function bindHostedProvenance({ inspectionId, userId, target, verification }) {
  const row = await db.prepare('SELECT trust_json FROM inspections WHERE id = ? AND user_id = ?').get(inspectionId, userId);
  if (!row) throw new Error('Hosted inspection was recorded but could not be reloaded.');
  const current = parseJson(row.trust_json, {});
  const trust = {
    ...current,
    evidenceClass: 'server-observed-github-static-evidence',
    boundary: 'AgentRiskLayer fetched the public GitHub repository at the exact frozen commit and ran the read-only Inspector server-side. The source archive was temporary and deleted after scanning. This is observed static evidence, not runtime evidence or independent attestation of a deployed environment.',
    sourceBinding: {
      provider: 'github',
      repository: target.repository,
      revision: target.revision,
      repositoryId: verification.repositoryId,
      commitUrl: verification.commitUrl,
      verifiedAt: nowIso(),
    },
  };
  await db.prepare('UPDATE inspections SET trust_json = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(trust), inspectionId, userId);
  return trust;
}

export async function runFrozenGithubSourceInspection({ userId, assessmentId }) {
  const assessment = await db.prepare('SELECT * FROM assessments WHERE id = ? AND user_id = ?').get(assessmentId, userId);
  if (!assessment) throw Object.assign(new Error('Assessment not found.'), { statusCode: 404 });
  const target = parseFrozenGithubTarget(assessment);
  if (!target) throw Object.assign(new Error('This assessment does not contain a frozen GitHub repository and full commit SHA.'), { statusCode: 400 });

  const verification = await verifyPublicFrozenTarget(target);
  const archive = await fetchArchive(target);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-github-source-'));
  try {
    const extraction = extractTarGz(archive, temporaryRoot);
    const bundle = await scanRepository(temporaryRoot, {
      authorised: true,
      environment: 'frozen-github-source',
      includePaths: false,
    });
    const token = await createInspectionToken({ userId, assessmentId });
    const recorded = await consumeInspectionUpload({ rawToken: token.token, bundle });
    const trust = await bindHostedProvenance({ inspectionId: recorded.inspectionId, userId, target, verification });
    await insertEvent('github_source_inspection_completed', userId, {
      assessmentId,
      inspectionId: recorded.inspectionId,
      repository: target.repository,
      revision: target.revision,
      filesExtracted: extraction.files,
      extractedBytes: extraction.extractedBytes,
    });
    const inspection = await getInspection({ inspectionId: recorded.inspectionId, userId });
    return { inspection: { ...inspection, trust }, target };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
