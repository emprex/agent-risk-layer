#!/usr/bin/env node
/**
 * AgentRisk Inspector
 * Read-only, zero-dependency repository and deployment-configuration scanner.
 *
 * Privacy contract:
 * - Source code and secret values are never placed in an evidence bundle.
 * - Evidence contains rule outcomes, bounded metadata, path hashes, basenames and line numbers.
 * - Upload is opt-in and uses a one-time assessment token.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const INSPECTOR_VERSION = '4.0.0';
export const POLICY_VERSION = 'arl-inspector-policy-2026.09';
export const BUNDLE_SCHEMA = 'arl.inspection.bundle.v1';

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 25_000,
  maxReadableFileBytes: 2_000_000,
  maxTotalReadBytes: 40_000_000,
  maxFindings: 500,
});

const IGNORED_FILE_PATTERNS = [/^agent-risk-inspector\.mjs$/i,/^agentrisk-inspection-?.*\.json$/i];

const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '.cache', '.pytest_cache', '__pycache__', '.venv', 'venv',
  'target', 'out', '.idea', '.vscode', '.terraform', '.serverless', '.agentrisk',
]);

const TEXT_EXTENSIONS = new Set([
  '.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.rb','.go','.rs','.java','.kt','.kts',
  '.cs','.php','.sh','.bash','.zsh','.ps1','.json','.jsonc','.yaml','.yml','.toml','.ini',
  '.conf','.cfg','.properties','.xml','.md','.txt','.env','.dockerfile','.tf','.hcl',
]);

const SEVERITY_WEIGHT = { critical: 25, high: 12, medium: 5, low: 2, info: 0 };
const CONFIDENCE_MULTIPLIER = { high: 1, medium: 0.75, low: 0.5 };

export const POLICY_CATALOG = Object.freeze([
  rule('ARL-SEC-001','Potential secret committed to repository','critical','Secrets management','Secret-like material was detected in a tracked text file. The matched value is never included in the evidence bundle.','Revoke and rotate the credential, remove it from current and historical source control, and use a managed secret store.',['OWASP Agent Security - Data Protection & Privacy','NIST AI RMF GOVERN 1.7']),
  rule('ARL-SEC-002','Private key material present in repository','critical','Secrets management','A private-key file or private-key marker was detected.','Remove the key from the repository, rotate it, protect replacement keys in a managed KMS or secret store, and review access logs.',['OWASP Agent Security - Tool Security','NIST AI RMF MANAGE 2.4']),
  rule('ARL-SEC-003','Environment file is tracked','high','Secrets management','An environment file is tracked by Git and may expose credentials or production configuration.','Remove environment files from source control, rotate exposed values, add a safe template, and enforce secret scanning in CI.',['OWASP LLM03 Supply Chain','NIST AI RMF GOVERN 1.7']),
  rule('ARL-CICD-001','GitHub Actions uses broad write permissions','high','CI/CD','A workflow grants write-all or broad write permissions to the workflow token.','Set default permissions to read-only and grant narrowly scoped write permissions only to the job that requires them.',['OWASP LLM03 Supply Chain','NIST AI RMF GOVERN 1.7']),
  rule('ARL-CICD-002','Third-party GitHub Action is not pinned to a commit','medium','CI/CD','A workflow action reference is pinned to a mutable tag or branch rather than a full commit SHA.','Pin third-party actions to reviewed immutable commit SHAs and automate controlled updates.',['SLSA Build L2','OWASP LLM03 Supply Chain']),
  rule('ARL-CICD-003','pull_request_target workflow handles untrusted pull requests','high','CI/CD','pull_request_target can expose privileged tokens or secrets to code influenced by an untrusted pull request.','Avoid checking out or executing untrusted pull-request code in pull_request_target; separate privileged metadata operations.',['OWASP LLM03 Supply Chain','SLSA Build L2']),
  rule('ARL-CICD-004','Remote script execution found in build workflow','high','CI/CD','A build or install script pipes downloaded content directly to a shell.','Download to a file, verify checksum and signature, inspect provenance, and execute only a pinned verified artifact.',['SLSA Source','OWASP LLM03 Supply Chain']),
  rule('ARL-CTR-001','Container runs without a non-root USER','medium','Container security','A Dockerfile does not declare a non-root runtime user.','Create a dedicated unprivileged user and switch with USER before the final command.',['NIST AI RMF MANAGE 2','OWASP Agent Security - Least Privilege']),
  rule('ARL-CTR-002','Container base image is mutable or unpinned','medium','Container security','A Docker base image uses latest or lacks a stable version or digest.','Pin a minimal image to a reviewed version and preferably an immutable digest; update through controlled automation.',['SLSA Build','OWASP LLM03 Supply Chain']),
  rule('ARL-CTR-003','Privileged container configuration detected','critical','Container security','A container is privileged, uses host networking, or mounts the Docker socket.','Remove privileged mode and host access; isolate the workload and provide only the minimum required capabilities.',['OWASP Agent Security - Least Privilege','NIST AI RMF MANAGE 2.4']),
  rule('ARL-CTR-004','Container allows privilege escalation','high','Container security','A Kubernetes or container security context allows privilege escalation or runs as privileged.','Set allowPrivilegeEscalation false, runAsNonRoot true, drop capabilities, and enforce the policy at admission.',['OWASP Agent Security - Least Privilege','NIST AI RMF MANAGE 2']),
  rule('ARL-MCP-001','MCP or tool configuration exposes shell execution','critical','Agent tools','An MCP server or tool configuration appears able to execute arbitrary commands.','Remove general shell access or place it behind a hardened sandbox, explicit allowlist, parameter validation, and transaction-bound approval.',['OWASP Agentic: Tool Misuse','OWASP Agent Security - Tool Security']),
  rule('ARL-MCP-002','Filesystem tool appears scoped to root or broad paths','high','Agent tools','A filesystem-capable tool appears to allow root, home, or other broad directories.','Restrict allowed paths to dedicated application directories and explicitly deny secrets, keys and environment files.',['OWASP Agent Security - Tool Security','OWASP Agentic: Excessive Agency']),
  rule('ARL-MCP-003','Dynamic or unreviewed MCP server configuration','high','Agent supply chain','An MCP configuration loads servers through mutable package references or network locations without an integrity pin.','Pin server versions and hashes, maintain an allowlist, review permissions, and record provenance before activation.',['OWASP MCP Security Guide','OWASP LLM03 Supply Chain']),
  rule('ARL-AI-001','Dangerous execution primitive found near AI integration','high','Agent execution','AI SDK usage is present alongside command execution, eval, or dynamic function creation.','Separate model reasoning from execution; enforce deterministic authorisation, sandboxing, allowlists, schemas, and human approval for sensitive actions.',['OWASP Agentic: Tool Misuse','OWASP Agent Security - Human-in-the-Loop']),
  rule('ARL-AI-002','Wildcard CORS configuration detected','medium','Application security','The application appears to allow cross-origin requests from any origin.','Use an explicit origin allowlist, reject credentialed wildcard access, and test browser security boundaries.',['OWASP API Security','NIST AI RMF MANAGE 2']),
  rule('ARL-AI-003','TLS certificate verification disabled','critical','Application security','Code disables TLS certificate verification, enabling man-in-the-middle attacks.','Remove the override, restore certificate verification, and use a trusted CA or pinned internal certificate.',['OWASP Transport Layer Security','NIST AI RMF MANAGE 2.4']),
  rule('ARL-AI-004','Sensitive environment values may be logged','high','Logging','A logging statement appears to emit process environment variables or secret-bearing configuration.','Log only approved fields, redact secrets before logging, and test logs for credential and personal-data leakage.',['OWASP Agent Security - Monitoring','NIST AI RMF MEASURE 2.4']),
  rule('ARL-AI-005','Agent resource limits are not evident','medium','Resource controls','AI SDK usage was detected, but no clear timeout, token, retry, recursion, or budget limit was observed in scanned configuration.','Enforce hard server-side limits for time, tokens, retries, tool depth, concurrency and spend; fail closed when limits are reached.',['OWASP LLM10 Unbounded Consumption','OWASP Agent Security - Resource Limits']),
  rule('ARL-AI-006','Structured output validation is not evident','medium','Output validation','Agent integration was detected without clear schema validation or structured-output enforcement.','Require typed structured outputs and independently validate every tool call, destination and business rule before execution.',['OWASP LLM05 Improper Output Handling','OWASP Agent Security - Output Validation']),
  rule('ARL-AI-007','Human approval control is not evident for execution-capable agent','high','Human oversight','An execution-capable agent was detected without a clear approval gate for sensitive operations.','Classify actions by impact and require unexpired, parameter-bound approval for financial, destructive, administrative and externally visible actions.',['OWASP Agent Security - Human-in-the-Loop','NIST AI RMF GOVERN 1']),
  rule('ARL-AI-008','Tenant or session isolation is not evident in persistent memory','high','Memory security','Persistent agent memory or vector storage was detected without a clear tenant or session scoping signal.','Scope every read and write by tenant and session, validate memory content, retain provenance, expire data, and test cross-user isolation.',['OWASP Agentic: Memory Poisoning','OWASP Agent Security - Memory & Context Security']),
  rule('ARL-DEP-001','Dependency lockfile is missing','medium','Supply chain','A package manifest exists without its ecosystem lockfile.','Commit and enforce a lockfile, use reproducible installs, and review automated dependency updates.',['SLSA Build','OWASP LLM03 Supply Chain']),
  rule('ARL-DEP-002','Dependency version is unbounded or mutable','medium','Supply chain','A direct dependency uses wildcard, latest, URL, branch, or another mutable version reference.','Pin direct dependencies to controlled versions and use a lockfile with integrity metadata.',['OWASP LLM03 Supply Chain','SLSA Source']),
  rule('ARL-DEP-003','Install script executes shell or remote content','high','Supply chain','A package lifecycle script executes a shell command or retrieves remote executable content.','Remove unnecessary lifecycle scripts; verify and pin unavoidable tooling and run installs in a restricted environment.',['OWASP LLM03 Supply Chain','SLSA Build']),
  rule('ARL-REPO-001','Security policy is missing','low','Governance','No SECURITY.md or equivalent vulnerability-reporting policy was found.','Publish a security policy with supported versions, a private reporting channel, response expectations and safe-harbour language.',['NIST AI RMF GOVERN 2','NIST SSDF']),
  rule('ARL-REPO-002','Automated tests are not evident','medium','Assurance','No test directory, test script, or common test configuration was detected.','Add repeatable unit, integration, security and adversarial tests and enforce them as a release gate.',['NIST AI RMF MEASURE 2.1','OWASP Secure Agent Testing']),
]);

function rule(id,title,severity,category,summary,remediation,frameworks){
  return Object.freeze({ id,title,severity,category,summary,remediation,frameworks });
}

const POLICY_BY_ID = new Map(POLICY_CATALOG.map((item)=>[item.id,item]));

export async function scanRepository(rootInput='.', options={}) {
  const root = fs.realpathSync(path.resolve(rootInput));
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const startedAt = new Date().toISOString();
  const scannerConfig = loadScannerConfig(root);
  const inventory = discoverFiles(root, limits, scannerConfig);
  const context = createContext(root, inventory, limits, { ...options, scannerConfig });

  runRepositoryChecks(context);
  runSecretChecks(context);
  runDependencyChecks(context);
  runDockerChecks(context);
  runWorkflowChecks(context);
  runMcpChecks(context);
  runSourceChecks(context);
  runKubernetesChecks(context);
  runAssuranceChecks(context);

  const findings = applyFindingReviews(
    deduplicateFindings(context.findings).sort(compareFindings),
    scannerConfig,
  ).slice(0, limits.maxFindings);
  const summary = summarise(findings, context.checksRun, inventory);
  const payload = {
    schema: BUNDLE_SCHEMA,
    bundleId: `ins_${crypto.randomUUID().replaceAll('-','')}`,
    generatedAt: new Date().toISOString(),
    scanner: {
      name: 'AgentRisk Inspector',
      version: INSPECTOR_VERSION,
      policyVersion: POLICY_VERSION,
      buildDigest: sha256(fs.readFileSync(fileURLToPath(import.meta.url),'utf8').replace(/\r\n/g,'\n')),
      runtime: `node ${process.version}`,
      platform: `${process.platform}/${process.arch}`,
    },
    subject: subjectMetadata(root, inventory, options),
    scope: {
      mode: 'read-only-static-inspection',
      startedAt,
      completedAt: new Date().toISOString(),
      filesDiscovered: inventory.files.length,
      filesInspected: context.filesInspected,
      bytesRead: context.bytesRead,
      skippedLargeFiles: inventory.skippedLargeFiles,
      truncatedByLimit: inventory.truncated,
      excludedDirectories: [...IGNORED_DIRS].sort(),
      limits,
      includeRelativePaths: options.includePaths === true,
      userExclusions: scannerConfig.exclude,
      declaredFalsePositiveReviews: scannerConfig.falsePositives.length,
    },
    summary,
    findings,
    acceptedRiskReviews: findings.filter((item)=>item.review?.status==='accepted-risk').map((item)=>({ruleId:item.ruleId,title:item.title,review:item.review})),
    falsePositiveReviews: findings.filter((item)=>item.review?.status==='false-positive').map((item)=>({ruleId:item.ruleId,title:item.title,review:item.review})),
    observedTechnologies: [...context.technologies].sort(),
    attestations: {
      authorisedByOperator: options.authorised === true,
      readOnlyInspection: true,
      noSourceCodeUploaded: true,
      noSecretValuesUploaded: true,
      noExploitExecution: true,
      noNetworkProbing: true,
    },
    trust: {
      evidenceClass: 'locally-observed-static-evidence',
      boundary: 'Integrity proves the bundle was not changed after signing. It does not prove the scanned system was complete, deployed, uncompromised or independently operated.',
    },
  };
  return signBundle(payload, options.privateKeyPem);
}

function loadScannerConfig(root){
  const file=path.join(root,'.agentrisk.json');
  if(!fs.existsSync(file))return {exclude:[],acceptedRisks:[],falsePositives:[]};
  try{
    const stat=fs.statSync(file);if(stat.size>64_000)throw new Error('.agentrisk.json exceeds 64 KB');
    const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
    const exclude=Array.isArray(parsed.exclude)?parsed.exclude.slice(0,50).map((x)=>cleanMetadata(x,180)).filter(Boolean):[];
    const normaliseReview=(item)=>({
      ruleId:cleanMetadata(item.ruleId,40),basename:item.basename?cleanMetadata(item.basename,120):null,
      reason:cleanMetadata(item.reason,400),owner:cleanMetadata(item.owner,120),expires:cleanMetadata(item.expires,30),
    });
    const acceptedRisks=Array.isArray(parsed.acceptedRisks)?parsed.acceptedRisks.slice(0,100).map(normaliseReview).filter((item)=>item.ruleId&&item.reason.length>=10&&item.owner):[];
    const falsePositives=Array.isArray(parsed.falsePositives)?parsed.falsePositives.slice(0,100).map(normaliseReview).filter((item)=>item.ruleId&&item.reason.length>=10&&item.owner&&item.expires):[];
    return {exclude,acceptedRisks,falsePositives};
  }catch(error){throw new Error(`Invalid .agentrisk.json: ${error.message}`);}
}
function isUserExcluded(relative,patterns){return patterns.some((pattern)=>globMatch(relative,pattern));}
function globMatch(value,pattern){
  const escaped=String(pattern).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\*\*/g,'§§').replace(/\*/g,'[^/]*').replace(/§§/g,'.*').replace(/\?/g,'[^/]');
  try{return new RegExp(`^${escaped}$`).test(value);}catch{return false;}
}
function applyFindingReviews(findings,scannerConfig){
  const now=Date.now();
  const match=(finding,review)=>review.ruleId===finding.ruleId&&(!review.basename||finding.evidence.some((e)=>e.basename===review.basename));
  return findings.map((finding)=>{
    const falsePositive=scannerConfig.falsePositives.find((item)=>match(finding,item));
    if(falsePositive){const expiry=Date.parse(falsePositive.expires);const expired=!Number.isFinite(expiry)||expiry<=now;if(!expired)return {...finding,review:{status:'false-positive',reason:falsePositive.reason,owner:falsePositive.owner,expires:falsePositive.expires,expired:false}};}
    const accepted=scannerConfig.acceptedRisks.find((item)=>match(finding,item));
    if(!accepted)return finding;
    const expiry=Date.parse(accepted.expires);const expired=!Number.isFinite(expiry)||expiry<=now;
    return {...finding,review:{status:expired?'expired-review':'accepted-risk',reason:accepted.reason,owner:accepted.owner,expires:accepted.expires||null,expired}};
  });
}

function createContext(root, inventory, limits, options) {
  return {
    root, inventory, limits, options, findings: [], checksRun: new Set(),
    technologies: new Set(), bytesRead: 0, filesInspected: 0, secretFingerprintKey: crypto.randomBytes(32),
    textCache: new Map(), relative(file){return path.relative(root,file).replaceAll(path.sep,'/');},
    read(file){
      if (this.textCache.has(file)) return this.textCache.get(file);
      const stat = fs.statSync(file);
      if (stat.size > limits.maxReadableFileBytes || this.bytesRead + stat.size > limits.maxTotalReadBytes) return null;
      const buffer = fs.readFileSync(file);
      if (buffer.includes(0)) return null;
      const text = buffer.toString('utf8');
      this.textCache.set(file,text); this.bytesRead += buffer.length; this.filesInspected += 1; return text;
    },
    add(ruleId, evidence, overrides={}){
      this.checksRun.add(ruleId);
      const policy = POLICY_BY_ID.get(ruleId);
      if (!policy) throw new Error(`Unknown policy ${ruleId}`);
      this.findings.push({
        ruleId, title: policy.title, severity: overrides.severity || policy.severity,
        confidence: overrides.confidence || 'high', category: policy.category,
        summary: overrides.summary || policy.summary, remediation: overrides.remediation || policy.remediation,
        frameworks: policy.frameworks, evidence: (evidence || []).slice(0, 12),
      });
    },
    checked(ruleId){this.checksRun.add(ruleId);},
  };
}

function discoverFiles(root, limits, scannerConfig = { exclude: [] }) {
  const files=[]; let skippedLargeFiles=0; let truncated=false;
  const tracked = gitTrackedFiles(root);
  if (tracked) {
    for (const rel of tracked) {
      if (files.length >= limits.maxFiles) { truncated=true; break; }
      const abs=path.join(root,rel); if (IGNORED_FILE_PATTERNS.some((pattern)=>pattern.test(path.basename(rel))) || isUserExcluded(rel, scannerConfig.exclude)) continue; if (!fs.existsSync(abs)) continue;
      const stat=fs.lstatSync(abs); if(!stat.isFile() || stat.isSymbolicLink()) continue;
      if(stat.size>limits.maxReadableFileBytes) skippedLargeFiles+=1;
      files.push(abs);
    }
  } else {
    const walk=(dir)=>{
      if(files.length>=limits.maxFiles){truncated=true;return;}
      for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
        if(files.length>=limits.maxFiles){truncated=true;return;}
        if(entry.isSymbolicLink())continue;
        const abs=path.join(dir,entry.name);
        if(entry.isDirectory()){if(!IGNORED_DIRS.has(entry.name))walk(abs);}
        else if(entry.isFile()){const rel=path.relative(root,abs).replaceAll(path.sep,'/');if(IGNORED_FILE_PATTERNS.some((pattern)=>pattern.test(entry.name))||isUserExcluded(rel,scannerConfig.exclude))continue;const stat=fs.statSync(abs);if(stat.size>limits.maxReadableFileBytes)skippedLargeFiles+=1;files.push(abs);}
      }
    }; walk(root);
  }
  return { files, tracked: Boolean(tracked), skippedLargeFiles, truncated };
}

function gitTrackedFiles(root){
  try {
    const output=execFileSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:20_000_000});
    const values=output.split('\0').filter(Boolean); return values.length?values:null;
  } catch { return null; }
}

function subjectMetadata(root, inventory, options){
  const gitCommit=safeExec('git',['-C',root,'rev-parse','HEAD']);
  const gitStatus=safeExec('git',['-C',root,'status','--porcelain']);
  const packageName=readJsonSafe(path.join(root,'package.json'))?.name;
  const basename=path.basename(root);
  return {
    projectName: cleanMetadata(packageName || basename,120),
    rootFingerprint: sha256(`${basename}:${inventory.files.map((f)=>path.relative(root,f)).sort().join('\n')}`),
    gitCommit: /^[a-f0-9]{40}$/i.test(gitCommit)?gitCommit:null,
    gitDirty: gitStatus ? true : gitStatus === '' ? false : null,
    environment: cleanMetadata(options.environment || 'unspecified',40),
  };
}

function runRepositoryChecks(ctx){
  const rels=ctx.inventory.files.map((f)=>ctx.relative(f));
  ctx.checked('ARL-SEC-003'); ctx.checked('ARL-REPO-001');
  for(const file of ctx.inventory.files){
    const rel=ctx.relative(file); const base=path.basename(rel).toLowerCase();
    if(/^\.env($|\.)/.test(base) && !base.endsWith('.example') && !base.endsWith('.sample')){
      ctx.add('ARL-SEC-003',[ev(ctx,file,null,'Tracked environment file')]);
    }
  }
  if(!rels.some((r)=>/(^|\/)(security\.md|security\.txt)$/i.test(r)))ctx.add('ARL-REPO-001',[]);
}

function runSecretChecks(ctx){
  const patterns=[
    ['Private key marker',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,'ARL-SEC-002'],
    ['Stripe secret key',/\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g,'ARL-SEC-001'],
    ['OpenAI API key',/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,'ARL-SEC-001'],
    ['Anthropic API key',/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,'ARL-SEC-001'],
    ['GitHub token',/\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/g,'ARL-SEC-001'],
    ['AWS access key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,'ARL-SEC-001'],
    ['PEM private key file',/\.(?:pem|key|p12|pfx)$/i,'ARL-SEC-002'],
  ];
  ctx.checked('ARL-SEC-001'); ctx.checked('ARL-SEC-002');
  for(const file of ctx.inventory.files){
    const rel=ctx.relative(file);
    for(const [name,pattern,ruleId] of patterns){
      if(name==='PEM private key file'){
        if(pattern.test(rel) && !/public|cert|certificate/i.test(path.basename(rel)))ctx.add(ruleId,[ev(ctx,file,null,name)],isTestOrExamplePath(rel)?{severity:'high',confidence:'medium'}:{});
        continue;
      }
      if(!isTextCandidate(file))continue;
      const text=ctx.read(file); if(text===null)continue;
      pattern.lastIndex=0; let match; const matches=new Map();
      while((match=pattern.exec(text))){
        const fingerprint=secretFingerprint(ctx,match[0]);
        if(!matches.has(fingerprint))matches.set(fingerprint,[]);
        if(matches.get(fingerprint).length<5)matches.get(fingerprint).push(lineNumber(text,match.index));
        if(pattern.lastIndex===match.index)pattern.lastIndex++;
      }
      for(const [fingerprint,lines] of matches){
        const evidence=lines.map((line)=>ev(ctx,file,line,`${name}; fingerprint ${fingerprint}`));
        const example=isTestOrExamplePath(rel);
        ctx.add(ruleId,evidence,example?{severity:'low',confidence:'low',summary:'Credential-shaped material was detected in a test, fixture or example file. It remains visible until a named, expiring false-positive review is recorded. The matched value is never included in the evidence bundle.'}:{});
      }
    }
  }
}
function runDependencyChecks(ctx){
  ctx.checked('ARL-DEP-001'); ctx.checked('ARL-DEP-002'); ctx.checked('ARL-DEP-003');
  const packageFiles=ctx.inventory.files.filter((f)=>path.basename(f)==='package.json');
  for(const file of packageFiles){
    ctx.technologies.add('Node.js'); const pkg=readJsonSafe(file); if(!pkg)continue;
    const dir=path.dirname(file); const lockNames=['package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','yarn.lock','bun.lock','bun.lockb'];
    const dependencyCount=['dependencies','devDependencies','optionalDependencies'].reduce((sum,section)=>sum+Object.keys(pkg[section]||{}).length,0);
    if(dependencyCount>0&&!lockNames.some((name)=>fs.existsSync(path.join(dir,name))))ctx.add('ARL-DEP-001',[ev(ctx,file,null,'package.json has dependencies but no adjacent lockfile')]);
    for(const section of ['dependencies','devDependencies','optionalDependencies','peerDependencies']){
      for(const [name,version] of Object.entries(pkg[section]||{})){
        if(isMutableVersion(String(version)))ctx.add('ARL-DEP-002',[ev(ctx,file,null,`${section} ${name} uses mutable reference ${cleanMetadata(version,80)}`)],{confidence:'high'});
        if(/openai|anthropic|langchain|llamaindex|semantic-kernel|autogen|crewai|mcp/i.test(name))ctx.technologies.add(`AI package: ${name}`);
      }
    }
    for(const [name,script] of Object.entries(pkg.scripts||{})){
      if(/(?:curl|wget)\b[^\n|;&]*(?:\||&&|;)\s*(?:sh|bash|zsh)|\b(?:preinstall|postinstall)\b.*(?:curl|wget)/i.test(`${name} ${script}`) || /\b(?:eval|bash -c|sh -c)\b/i.test(String(script)))
        ctx.add('ARL-DEP-003',[ev(ctx,file,null,`Lifecycle/script ${name} contains shell or remote execution`)],{confidence:'medium'});
    }
  }
  for(const file of ctx.inventory.files.filter((f)=>/requirements(?:-[^/]+)?\.txt$/i.test(path.basename(f)))){
    ctx.technologies.add('Python'); const text=ctx.read(file); if(text===null)continue;
    const unpinned=text.split(/\r?\n/).map((x)=>x.trim()).filter((x)=>x&&!x.startsWith('#')&&!/[<>=!~]=/.test(x)&&!/^-[ercf]/.test(x));
    if(unpinned.length)ctx.add('ARL-DEP-002',[ev(ctx,file,null,`${unpinned.length} Python requirements are not pinned`)],{confidence:'high'});
  }
}

function runDockerChecks(ctx){
  ctx.checked('ARL-CTR-001');ctx.checked('ARL-CTR-002');ctx.checked('ARL-CTR-003');
  for(const file of ctx.inventory.files){
    const base=path.basename(file).toLowerCase(); const rel=ctx.relative(file);
    if(base==='dockerfile'||base.startsWith('dockerfile.')){
      ctx.technologies.add('Docker'); const text=ctx.read(file); if(text===null)continue;
      if(!/^\s*USER\s+[^\s]+/mi.test(text))ctx.add('ARL-CTR-001',[ev(ctx,file,null,'No USER directive found')]);
      for(const match of text.matchAll(/^\s*FROM\s+([^\s]+).*$/gmi)){
        const image=match[1]; if(/:latest$/i.test(image)||(!image.includes('@sha256:')&&!/:[^/]+$/.test(image)))ctx.add('ARL-CTR-002',[ev(ctx,file,lineNumber(text,match.index),`Mutable base image ${cleanMetadata(image,120)}`)]);
      }
      if(/(?:curl|wget)[^\n]*\|\s*(?:sh|bash)/i.test(text))ctx.add('ARL-CICD-004',[ev(ctx,file,null,'Remote content piped to shell in Docker build')]);
    }
    if(/(?:docker-)?compose.*\.ya?ml$/i.test(base)){
      ctx.technologies.add('Docker Compose'); const text=ctx.read(file);if(text===null)continue;
      if(/privileged\s*:\s*true|network_mode\s*:\s*["']?host|\/var\/run\/docker\.sock/i.test(text))ctx.add('ARL-CTR-003',[ev(ctx,file,null,'Privileged, host-network or Docker-socket configuration')]);
      if(/(?:^|\s)-\s*["']?0\.0\.0\.0:\d+:/m.test(text))ctx.technologies.add('Publicly bound container port');
    }
  }
}

function runWorkflowChecks(ctx){
  ctx.checked('ARL-CICD-001');ctx.checked('ARL-CICD-002');ctx.checked('ARL-CICD-003');ctx.checked('ARL-CICD-004');
  for(const file of ctx.inventory.files.filter((f)=>/\.github\/workflows\/[^/]+\.ya?ml$/i.test(ctx.relative(f)))){
    ctx.technologies.add('GitHub Actions'); const text=ctx.read(file);if(text===null)continue;
    if(/permissions\s*:\s*write-all/i.test(text)||/permissions\s*:\s*\n(?:\s+[\w-]+\s*:\s*write\s*\n){3,}/i.test(text))ctx.add('ARL-CICD-001',[ev(ctx,file,null,'Broad workflow token permissions')]);
    if(/pull_request_target\s*:/i.test(text))ctx.add('ARL-CICD-003',[ev(ctx,file,null,'pull_request_target trigger present')],{confidence:'medium'});
    for(const match of text.matchAll(/uses\s*:\s*([^\s#]+)@([^\s#]+)/gi)){
      const ownerRef=match[1],version=match[2];
      if(ownerRef.startsWith('./')||ownerRef.startsWith('docker://'))continue;
      if(!/^[a-f0-9]{40}$/i.test(version))ctx.add('ARL-CICD-002',[ev(ctx,file,lineNumber(text,match.index),`${cleanMetadata(ownerRef,100)} pinned to mutable ${cleanMetadata(version,60)}`)]);
    }
    if(/(?:curl|wget)[^\n]*\|\s*(?:sh|bash)/i.test(text))ctx.add('ARL-CICD-004',[ev(ctx,file,null,'Remote content piped to shell in workflow')]);
  }
}

function runMcpChecks(ctx){
  ctx.checked('ARL-MCP-001');ctx.checked('ARL-MCP-002');ctx.checked('ARL-MCP-003');
  for(const file of ctx.inventory.files){
    const rel=ctx.relative(file); const base=path.basename(file).toLowerCase();
    if(!/(^|\/)(\.mcp\.json|mcp\.json|claude_desktop_config\.json|mcp[^/]*\.ya?ml)$/i.test(rel) && !/mcp/.test(base))continue;
    const text=ctx.read(file);if(text===null)continue;
    if(!/mcpServers|mcp_servers|modelcontextprotocol|@modelcontextprotocol/i.test(text))continue;
    ctx.technologies.add('MCP');
    if(/(?:execute_command|shell|bash|powershell|cmd\.exe|child_process|terminal|docker)["']?\s*[:,]/i.test(text) || /"command"\s*:\s*"(?:bash|sh|zsh|powershell|cmd|npx)"/i.test(text))
      ctx.add('ARL-MCP-001',[ev(ctx,file,null,'Shell or command-capable MCP configuration')],{confidence:'medium'});
    if(/allowed(?:Directories|Paths)[\s\S]{0,200}["'](?:\/|~|[A-Za-z]:\\)["']/i.test(text)||/"args"\s*:\s*\[[^\]]*["']\/["']/i.test(text))
      ctx.add('ARL-MCP-002',[ev(ctx,file,null,'Broad filesystem scope in MCP configuration')],{confidence:'medium'});
    if(/"(?:command|url)"\s*:\s*"(?:npx\s+)?[^"@]+(?:@latest)?"/i.test(text)||/https?:\/\//i.test(text))
      ctx.add('ARL-MCP-003',[ev(ctx,file,null,'Mutable or network MCP server reference')],{confidence:'medium'});
  }
}

function runSourceChecks(ctx){
  ctx.checked('ARL-AI-001');ctx.checked('ARL-AI-002');ctx.checked('ARL-AI-003');ctx.checked('ARL-AI-004');ctx.checked('ARL-AI-005');ctx.checked('ARL-AI-006');ctx.checked('ARL-AI-007');ctx.checked('ARL-AI-008');
  let hasAi=false,hasLimits=false,hasSchema=false,hasApproval=false,hasMemory=false,hasTenantScope=false;
  const executionEvidence=[],memoryEvidence=[];
  for(const file of ctx.inventory.files){
    if(!isSourceCandidate(file))continue;
    const rel=ctx.relative(file);
    if(isTestOrExamplePath(rel))continue;
    const text=ctx.read(file);if(text===null)continue;
    const aiInFile=/(?:from|require\s*\(|import\s+).*?(?:openai|anthropic|langchain|llamaindex|semantic.?kernel|autogen|crewai|modelcontextprotocol)|\b(?:OpenAI|Anthropic|ChatOpenAI|AgentExecutor|MCPClient)\b/i.test(text);
    if(aiInFile){hasAi=true;ctx.technologies.add('AI/agent source integration');}
    const importsChildProcess=/(?:from\s+['"](?:node:)?child_process['"]|require\s*\(\s*['"](?:node:)?child_process['"]\s*\)|import[\s\S]{0,180}from\s+['"](?:node:)?child_process['"])/i.test(text);
    const executionInFile=/\beval\s*\(|new\s+Function\s*\(|(?:child_process|subprocess)\.(?:exec|execSync|spawn|spawnSync|run|Popen|call)\s*\(|\bos\.system\s*\(/i.test(text)
      || (importsChildProcess && /\b(?:exec|execSync|spawn|spawnSync)\s*\(/.test(text));
    if(aiInFile&&executionInFile){const item=ev(ctx,file,null,'AI integration and an operating-system execution primitive occur in the same source file');executionEvidence.push(item);ctx.add('ARL-AI-001',[item],{confidence:'medium'});}
    if(/(?:max_tokens|max_output_tokens|AbortSignal\.timeout|tool_call_limit|max_iterations|(?:retry|recursion|budget|spend)[A-Za-z_]*\s*[:=])/i.test(text))hasLimits=true;
    if(/(?:zod|ajv|jsonschema|pydantic|response_format|json_schema|structuredOutput|schema\.parse|safeParse)/i.test(text))hasSchema=true;
    if(/(?:human.?in.?the.?loop|requiresApproval|authori[sz]eAction|pending_confirmation|transaction.?bound.?approval)/i.test(text))hasApproval=true;
    if(/(?:vectorstore|vector_store|conversation_history|chat_history|pinecone|weaviate|qdrant|chroma|persistent.?memory)/i.test(text)){hasMemory=true;memoryEvidence.push(ev(ctx,file,null,'Persistent memory/vector-store signal detected'));}
    if(/(?:tenant_id|tenantId|user_id|userId|session_id|sessionId|namespace)/i.test(text))hasTenantScope=true;
    for(const signal of wildcardCorsSignals(text)){
      const context=text.slice(Math.max(0,signal.index-700),Math.min(text.length,signal.index+900));
      const credentialed=/Access-Control-Allow-Credentials['"]?\s*,?\s*['"]?true|credentials\s*:\s*true/i.test(context);
      const publicStatic=/image\/(?:svg\+xml|png|jpeg|webp)|font\/(?:woff2?|ttf)|application\/manifest\+json/i.test(context)&&/Cache-Control['"]?[^\n]{0,120}public/i.test(context)&&/Cross-Origin-Resource-Policy['"]?[^\n]{0,120}cross-origin/i.test(context);
      if(publicStatic&&!credentialed)continue;
      ctx.add('ARL-AI-002',[ev(ctx,file,lineNumber(text,signal.index),credentialed?'Wildcard CORS with credentials signal':'Wildcard CORS on an application route; verify that no sensitive response or credentialed access is exposed')],credentialed?{severity:'high',confidence:'high'}:{severity:'medium',confidence:'medium'});
    }
    if(/rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/i.test(text))ctx.add('ARL-AI-003',[ev(ctx,file,null,'TLS verification disabled')]);
    if(/console\.(?:log|dir|info|debug)\s*\(\s*process\.env(?:\b|\[)|(?:logger|log)\.(?:info|debug|warn)\s*\([^\n]*(?:secret|token|password|apiKey|api_key)/i.test(text))ctx.add('ARL-AI-004',[ev(ctx,file,null,'Potential sensitive configuration logging')],{confidence:'medium'});
  }
  if(hasAi&&!hasLimits)ctx.add('ARL-AI-005',[],{confidence:'low'});
  if(hasAi&&!hasSchema)ctx.add('ARL-AI-006',[],{confidence:'low'});
  if(executionEvidence.length&&!hasApproval)ctx.add('ARL-AI-007',executionEvidence.slice(0,4),{confidence:'medium'});
  if(hasAi&&hasMemory&&!hasTenantScope)ctx.add('ARL-AI-008',memoryEvidence.slice(0,4),{confidence:'low'});
}
function runKubernetesChecks(ctx){
  ctx.checked('ARL-CTR-004');
  for(const file of ctx.inventory.files.filter((f)=>/\.ya?ml$/i.test(f))){
    const text=ctx.read(file);if(text===null||!/apiVersion\s*:|kind\s*:/i.test(text))continue;
    if(/kind\s*:\s*(?:Deployment|StatefulSet|DaemonSet|Pod|Job|CronJob)/i.test(text)){ctx.technologies.add('Kubernetes');
      if(/privileged\s*:\s*true|allowPrivilegeEscalation\s*:\s*true|hostNetwork\s*:\s*true/i.test(text))ctx.add('ARL-CTR-004',[ev(ctx,file,null,'Privileged Kubernetes security context')]);
    }
  }
}

function runAssuranceChecks(ctx){
  ctx.checked('ARL-REPO-002');
  const rels=ctx.inventory.files.map((f)=>ctx.relative(f));
  const pkg=readJsonSafe(path.join(ctx.root,'package.json'));
  const testSignal=rels.some((r)=>(/(^|\/)(test|tests|spec|__tests__)(\/|$)/i.test(r)||/(?:\.test|\.spec)\.[^.]+$/i.test(r))) || Boolean(pkg?.scripts?.test && !/no test specified/i.test(pkg.scripts.test));
  if(!testSignal)ctx.add('ARL-REPO-002',[]);
}

function ev(ctx,file,line,fact){
  const rel=ctx.relative(file); return {
    source:'static-file-observation',
    basename:path.basename(rel).slice(0,120),
    relativePath:ctx.options.includePaths===true?cleanMetadata(rel,240):null,
    pathHash:sha256(rel).slice(0,24),
    line:Number.isInteger(line)?line:null,
    fact:cleanMetadata(fact,220),
  };
}

function deduplicateFindings(findings){
  const map=new Map();
  for(const item of findings){
    const key=`${item.ruleId}:${item.evidence.map((x)=>`${x.pathHash}:${x.line}:${x.fact}`).join('|')}`;
    if(!map.has(key))map.set(key,item);
  }
  return [...map.values()];
}

function compareFindings(a,b){
  const order={critical:0,high:1,medium:2,low:3,info:4};
  return order[a.severity]-order[b.severity]||a.ruleId.localeCompare(b.ruleId);
}

function summarise(findings,checksRun,inventory){
  const counts={critical:0,high:0,medium:0,low:0,info:0};
  let risk=0;
  const active=findings.filter((item)=>item.review?.status!=='false-positive');
  for(const item of active){counts[item.severity]+=1;risk+=SEVERITY_WEIGHT[item.severity]*CONFIDENCE_MULTIPLIER[item.confidence];}
  risk=Math.min(100,Math.round(risk));
  const postureScore=Math.max(0,100-risk);
  const grade=postureScore>=90?'A':postureScore>=80?'B':postureScore>=65?'C':postureScore>=50?'D':'F';
  return {
    postureScore, technicalRisk:risk, grade, counts,
    checksEvaluated:checksRun.size,
    findingsTotal:findings.length,
    activeFindingsTotal:active.length,
    falsePositiveTotal:findings.filter((item)=>item.review?.status==='false-positive').length,
    acceptedRiskTotal:findings.filter((item)=>item.review?.status==='accepted-risk').length,
    highestSeverity:counts.critical?'critical':counts.high?'high':counts.medium?'medium':counts.low?'low':'none',
    repositoryTracking:inventory.tracked?'git-tracked-files':'filesystem-walk',
    conclusion:counts.critical?'Critical observed weaknesses require immediate remediation before relying on the inspected system.':counts.high?'Material observed weaknesses should be remediated before broader deployment.':counts.medium?'No critical issue was observed, but important hardening and assurance work remains.':'No material issue was observed by this static inspection. Runtime and cloud controls remain outside scope.',
  };
}

export function signBundle(payload, privateKeyPem=null){
  const pair=privateKeyPem?{privateKey:crypto.createPrivateKey(privateKeyPem),publicKey:crypto.createPublicKey(privateKeyPem)}:crypto.generateKeyPairSync('ed25519');
  const canonical=canonicalJson(payload); const digest=sha256(canonical);
  const signature=crypto.sign(null,Buffer.from(canonical),pair.privateKey).toString('base64');
  return {...payload,integrity:{digestAlgorithm:'SHA-256',digest,signatureAlgorithm:'Ed25519',signature,publicKeySpki:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')}};
}

export function verifyBundle(bundle){
  try{
    if(bundle?.schema!==BUNDLE_SCHEMA||!bundle.integrity)return {valid:false,error:'Unsupported bundle schema'};
    const {integrity,...payload}=bundle; const canonical=canonicalJson(payload); const digest=sha256(canonical);
    if(!crypto.timingSafeEqual(Buffer.from(digest),Buffer.from(String(integrity.digest||''))))return {valid:false,error:'Digest mismatch'};
    const publicKey=crypto.createPublicKey({key:Buffer.from(integrity.publicKeySpki,'base64'),type:'spki',format:'der'});
    const valid=crypto.verify(null,Buffer.from(canonical),publicKey,Buffer.from(integrity.signature,'base64'));
    return valid?{valid:true,digest}:{valid:false,error:'Signature mismatch'};
  }catch(error){return {valid:false,error:error.message};}
}

function canonicalJson(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((k)=>`${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function secretFingerprint(ctx,value){return crypto.createHmac('sha256',ctx.secretFingerprintKey).update(value).digest('hex').slice(0,16);}
function cleanMetadata(value,max=200){return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function safeExec(command,args){try{return execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:3000,maxBuffer:2_000_000}).trim();}catch{return null;}}
function readJsonSafe(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function lineNumber(text,index){return text.slice(0,index).split('\n').length;}
function isMutableVersion(version){return /^(?:\*|latest|next|main|master|workspace:\*|file:|git\+|https?:)|[xX*]/.test(version)||/#[^a-f0-9]*$/i.test(version);}
function wildcardCorsSignals(text){const regex=/(?:cors\s*\(\s*\{[\s\S]{0,180}origin\s*:\s*['"]\*['"]|setHeader\s*\(\s*['"]Access-Control-Allow-Origin['"]\s*,\s*['"]\*['"]|header\s*\(\s*['"]Access-Control-Allow-Origin['"]\s*,\s*['"]\*['"])/ig;const signals=[];let match;while((match=regex.exec(text))){signals.push({index:match.index});if(regex.lastIndex===match.index)regex.lastIndex++;}return signals;}
function isTestOrExamplePath(relative){return /(^|\/)(?:test|tests|spec|__tests__|fixtures?|examples?|samples?)(\/|$)|(?:\.test|\.spec)\.[^/]+$/i.test(String(relative));}
function isTextCandidate(file){const base=path.basename(file).toLowerCase();return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())||base==='dockerfile'||base.startsWith('.env')||base.endsWith('.lock');}
function isSourceCandidate(file){return /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|cs|php|sh)$/i.test(file);}

export async function uploadBundle(bundle,{baseUrl,token}){
  if(!baseUrl||!token)throw new Error('Upload requires --upload URL and --token TOKEN.');
  const response=await fetch(new URL('/api/inspector/upload',baseUrl),{
    method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`,'user-agent':`AgentRiskInspector/${INSPECTOR_VERSION}`},body:JSON.stringify(bundle),signal:AbortSignal.timeout(30_000),
  });
  const text=await response.text(); let body;try{body=JSON.parse(text);}catch{body={error:text};}
  if(!response.ok)throw new Error(body.error||`Upload failed with HTTP ${response.status}`);return body;
}

function printSummary(bundle){
  const s=bundle.summary;
  console.log(`\nAgentRisk Inspector ${INSPECTOR_VERSION}`);
  console.log(`Project: ${bundle.subject.projectName}`);
  console.log(`Posture: ${s.postureScore}/100 (grade ${s.grade}) | Technical risk ${s.technicalRisk}/100`);
  console.log(`Findings: ${s.findingsTotal} — critical ${s.counts.critical}, high ${s.counts.high}, medium ${s.counts.medium}, low ${s.counts.low}`);
  console.log(`Files inspected: ${bundle.scope.filesInspected}/${bundle.scope.filesDiscovered} | Bytes read: ${bundle.scope.bytesRead}`);
  console.log(`Integrity digest: ${bundle.integrity.digest}`);
  for(const finding of bundle.findings.slice(0,20))console.log(`- [${finding.severity.toUpperCase()}] ${finding.ruleId} ${finding.title}`);
  if(bundle.findings.length>20)console.log(`- … ${bundle.findings.length-20} additional findings in the JSON bundle`);
  console.log(`\n${s.conclusion}`);
}

export function toSarif(bundle){
  const rules=POLICY_CATALOG.map((item)=>({id:item.id,name:item.title,shortDescription:{text:item.title},fullDescription:{text:item.summary},help:{text:item.remediation},properties:{severity:item.severity,category:item.category,frameworks:item.frameworks}}));
  const results=(bundle.findings||[]).map((item)=>({
    ruleId:item.ruleId,level:item.severity==='critical'||item.severity==='high'?'error':item.severity==='medium'?'warning':'note',
    message:{text:`${item.summary} Remediation: ${item.remediation}`},
    locations:(item.evidence||[]).filter((e)=>e.relativePath).slice(0,5).map((e)=>({physicalLocation:{artifactLocation:{uri:e.relativePath},region:e.line?{startLine:e.line}:undefined}})),
    properties:{severity:item.severity,confidence:item.confidence,category:item.category,review:item.review||null},
  }));
  return {version:'2.1.0','$schema':'https://json.schemastore.org/sarif-2.1.0.json',runs:[{tool:{driver:{name:'AgentRisk Inspector',version:INSPECTOR_VERSION,informationUri:'https://agentrisklayer.com/methodology.html',rules}},results}]};
}
export function compareBundles(baseline,current){
  if(!baseline||!current||baseline.schema!==BUNDLE_SCHEMA||current.schema!==BUNDLE_SCHEMA)throw new Error('Both files must be AgentRisk Inspector bundles.');
  const key=(item)=>`${item.ruleId}:${(item.evidence||[]).map((e)=>e.pathHash||e.basename||e.fact).sort().join('|')}`;
  const before=new Map((baseline.findings||[]).map((item)=>[key(item),item]));
  const after=new Map((current.findings||[]).map((item)=>[key(item),item]));
  const added=[...after].filter(([id])=>!before.has(id)).map(([,item])=>item);
  const resolved=[...before].filter(([id])=>!after.has(id)).map(([,item])=>item);
  const unchanged=[...after].filter(([id])=>before.has(id)).map(([,item])=>item);
  return {
    schema:'arl.inspection.delta.v1',generatedAt:new Date().toISOString(),
    baseline:{bundleId:baseline.bundleId,generatedAt:baseline.generatedAt,postureScore:baseline.summary?.postureScore},
    current:{bundleId:current.bundleId,generatedAt:current.generatedAt,postureScore:current.summary?.postureScore},
    summary:{added:added.length,resolved:resolved.length,unchanged:unchanged.length,postureChange:(current.summary?.postureScore||0)-(baseline.summary?.postureScore||0)},
    added,resolved,unchanged,
  };
}

export function frameworkCoverage(bundle){
  const coverage=new Map();
  for(const finding of bundle.findings||[])for(const framework of finding.frameworks||[]){
    const current=coverage.get(framework)||{framework,findings:0,critical:0,high:0,medium:0,low:0};
    current.findings+=1;current[finding.severity]=(current[finding.severity]||0)+1;coverage.set(framework,current);
  }
  return [...coverage.values()].sort((a,b)=>b.findings-a.findings||a.framework.localeCompare(b.framework));
}
function failsThreshold(findings,threshold){
  const rank={critical:4,high:3,medium:2,low:1,info:0};const target=rank[String(threshold).toLowerCase()];
  if(target===undefined)throw new Error('--fail-on must be critical, high, medium, low, or info.');
  return findings.some((item)=>rank[item.severity]>=target&&item.review?.status!=='false-positive');
}

function parseArgs(argv){
  const args={command:argv[0]||'help',positionals:[],includePaths:false,authorised:false};
  for(let i=1;i<argv.length;i++){
    const item=argv[i];
    if(item==='--out')args.out=argv[++i]; else if(item==='--upload')args.upload=argv[++i]; else if(item==='--token')args.token=argv[++i]; else if(item==='--key')args.key=argv[++i]; else if(item==='--include-paths')args.includePaths=true; else if(item==='--authorised')args.authorised=true; else if(item==='--environment')args.environment=argv[++i]; else if(item==='--sarif')args.sarif=argv[++i]; else if(item==='--fail-on')args.failOn=argv[++i]; else args.positionals.push(item);
  }return args;
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  if(args.command==='rules'){console.log(JSON.stringify({policyVersion:POLICY_VERSION,rules:POLICY_CATALOG},null,2));return;}
  if(args.command==='verify'){
    const file=args.positionals[0];if(!file)throw new Error('Usage: verify <bundle.json>');
    const result=verifyBundle(JSON.parse(fs.readFileSync(file,'utf8')));console.log(JSON.stringify(result,null,2));process.exitCode=result.valid?0:2;return;
  }
  if(args.command==='compare'){
    const [baselineFile,currentFile]=args.positionals;if(!baselineFile||!currentFile)throw new Error('Usage: compare <baseline.json> <current.json> [--out delta.json]');
    const delta=compareBundles(JSON.parse(fs.readFileSync(path.resolve(baselineFile),'utf8')),JSON.parse(fs.readFileSync(path.resolve(currentFile),'utf8')));
    if(args.out)fs.writeFileSync(path.resolve(args.out),JSON.stringify(delta,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(delta.summary,null,2));return;
  }
  if(args.command==='keygen'){
    const out=path.resolve(args.out||args.positionals[0]||path.join(os.homedir(),'.config','agentrisk','inspector-ed25519.pem'));
    fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(out,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});fs.writeFileSync(`${out}.pub`,publicKey.export({type:'spki',format:'pem'}),{mode:0o644});
    console.log(`Private signing key written to ${out}`);console.log(`Public key written to ${out}.pub`);return;
  }
  if(args.command!=='scan'){
    console.log(`AgentRisk Inspector ${INSPECTOR_VERSION}\n\nUsage:\n  node agent-risk-inspector.mjs scan [path] --authorised --out inspection.json\n  node agent-risk-inspector.mjs scan [path] --authorised --upload https://agentrisklayer.com --token ONE_TIME_TOKEN\n  node agent-risk-inspector.mjs scan [path] --authorised --include-paths --sarif agentrisk.sarif --fail-on high\n  node agent-risk-inspector.mjs compare baseline.json current.json --out delta.json\n  node agent-risk-inspector.mjs verify inspection.json\n  node agent-risk-inspector.mjs rules\n  node agent-risk-inspector.mjs keygen --out ~/.config/agentrisk/inspector-ed25519.pem\n\nThe scanner is read-only. Upload is opt-in. Source code and secret values are excluded from evidence bundles.`);return;
  }
  if(!args.authorised)throw new Error('Inspection requires explicit authorisation. Re-run with --authorised after confirming you own or are authorised to inspect the target.');
  const root=args.positionals[0]||'.';const privateKeyPem=args.key?fs.readFileSync(path.resolve(args.key),'utf8'):null;
  const bundle=await scanRepository(root,{includePaths:args.includePaths,authorised:true,environment:args.environment,privateKeyPem});
  const out=path.resolve(args.out||`agentrisk-inspection-${Date.now()}.json`);fs.writeFileSync(out,JSON.stringify(bundle,null,2),{mode:0o600});
  if(args.sarif){const sarifPath=path.resolve(args.sarif);fs.writeFileSync(sarifPath,JSON.stringify(toSarif(bundle),null,2));console.log(`SARIF output: ${sarifPath}`);}
  printSummary(bundle);console.log(`\nEvidence bundle: ${out}`);
  if(args.upload){const response=await uploadBundle(bundle,{baseUrl:args.upload,token:args.token});console.log(`Uploaded inspection ${response.inspectionId} to assessment ${response.assessmentId}.`);}
  if(args.failOn&&failsThreshold(bundle.findings,args.failOn)){console.error(`Policy gate failed: finding at or above ${args.failOn}.`);process.exitCode=2;}
}

const isMain=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain)main().catch((error)=>{console.error(`Inspector error: ${error.message}`);process.exitCode=1;});
