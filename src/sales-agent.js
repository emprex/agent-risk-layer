import { db, id, insertEvent, nowIso } from './db.js';

const stages = ['research', 'qualified', 'contacted', 'replied', 'demo_booked', 'assessment_proposed', 'customer', 'subscription', 'lost'];
const messageStatuses = ['draft', 'approved', 'sent', 'rejected'];
const activityTypes = ['research', 'outreach', 'reply', 'follow_up', 'demo', 'proposal', 'assessment_sold', 'subscription_sold', 'note'];

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}
function optional(value, max) {
  const cleaned = text(value, max);
  return cleaned || null;
}
function jsonArray(value) {
  return JSON.stringify(Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean).slice(0, 20) : []);
}
function parseArray(value) {
  try { return Array.isArray(JSON.parse(value || '[]')) ? JSON.parse(value || '[]') : []; } catch { return []; }
}
function assertChoice(value, choices, label) {
  if (!choices.includes(value)) throw Object.assign(new Error(`Invalid ${label}.`), { statusCode: 400 });
  return value;
}
function validateUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString().slice(0, 500);
  } catch {
    throw Object.assign(new Error('Website and LinkedIn links must use http or https.'), { statusCode: 400 });
  }
}
function publicProspect(row) {
  if (!row) return null;
  return {
    id: row.id, companyName: row.company_name, website: row.website, companySize: row.company_size,
    buyerName: row.buyer_name, buyerRole: row.buyer_role, buyerEmail: row.buyer_email,
    buyerLinkedin: row.buyer_linkedin, source: row.source, triggerSignal: row.trigger_signal,
    agentUseCase: row.agent_use_case, toolAccess: row.tool_access, evidence: parseArray(row.evidence_json),
    score: Number(row.score), scoreReasons: parseArray(row.score_reasons_json), stage: row.stage,
    estimatedValuePence: Number(row.estimated_value_pence), nextAction: row.next_action,
    nextActionAt: row.next_action_at, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function publicMessage(row) {
  return {
    id: row.id, prospectId: row.prospect_id, channel: row.channel, messageType: row.message_type,
    subject: row.subject, body: row.body, factualBasis: parseArray(row.factual_basis_json),
    status: row.status, approvedAt: row.approved_at, sentAt: row.sent_at,
    responseOutcome: row.response_outcome, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function scoreProspect(input) {
  let score = 0;
  const reasons = [];
  const add = (points, reason) => { score += points; reasons.push(`${points > 0 ? '+' : ''}${points} ${reason}`); };
  if (text(input.agentUseCase)) add(20, 'specific AI-agent use case identified');
  if (text(input.toolAccess)) add(20, 'agent has real tool, data or system access');
  if (text(input.triggerSignal)) add(15, 'current buying trigger identified');
  if (text(input.buyerName) && text(input.buyerRole)) add(15, 'named decision-maker identified');
  if (text(input.buyerEmail) || text(input.buyerLinkedin)) add(10, 'verified contact route recorded');
  if (Array.isArray(input.evidence) && input.evidence.filter(Boolean).length) add(10, 'public evidence recorded');
  if (['1-10', '11-50', '51-200'].includes(text(input.companySize))) add(10, 'target company size');
  if (!text(input.agentUseCase) && !text(input.toolAccess)) add(-25, 'no demonstrated agent-security need');
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export async function createProspect(userId, input) {
  const companyName = text(input.companyName, 200);
  if (!companyName) throw Object.assign(new Error('Company name is required.'), { statusCode: 400 });
  const scored = scoreProspect(input);
  const prospect = {
    id: id('lead_'), companyName, website: validateUrl(optional(input.website, 500)),
    companySize: optional(input.companySize, 50), buyerName: optional(input.buyerName, 200),
    buyerRole: optional(input.buyerRole, 200), buyerEmail: optional(input.buyerEmail, 254)?.toLowerCase() || null,
    buyerLinkedin: validateUrl(optional(input.buyerLinkedin, 500)), source: text(input.source, 100) || 'manual',
    triggerSignal: optional(input.triggerSignal, 1000), agentUseCase: optional(input.agentUseCase, 2000),
    toolAccess: optional(input.toolAccess, 2000), evidence: input.evidence || [], stage: 'research',
    estimatedValuePence: Math.max(0, Number(input.estimatedValuePence || 9900) || 9900),
    nextAction: optional(input.nextAction, 500), nextActionAt: optional(input.nextActionAt, 50),
    notes: optional(input.notes, 4000), ...scored,
  };
  const now = nowIso();
  await db.prepare(`INSERT INTO sales_prospects
    (id,company_name,website,company_size,buyer_name,buyer_role,buyer_email,buyer_linkedin,source,trigger_signal,agent_use_case,tool_access,evidence_json,score,score_reasons_json,stage,estimated_value_pence,next_action,next_action_at,notes,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(prospect.id, prospect.companyName, prospect.website, prospect.companySize, prospect.buyerName, prospect.buyerRole,
      prospect.buyerEmail, prospect.buyerLinkedin, prospect.source, prospect.triggerSignal, prospect.agentUseCase,
      prospect.toolAccess, jsonArray(prospect.evidence), prospect.score, jsonArray(prospect.reasons), prospect.stage,
      prospect.estimatedValuePence, prospect.nextAction, prospect.nextActionAt, prospect.notes, userId, now, now);
  await insertEvent('sales_prospect_created', userId, { prospectId: prospect.id, score: prospect.score });
  return getProspect(prospect.id);
}

export async function updateProspect(userId, prospectId, patch) {
  const current = await getProspect(prospectId);
  if (!current) throw Object.assign(new Error('Prospect not found.'), { statusCode: 404 });
  const merged = { ...current, ...patch };
  const scored = scoreProspect(merged);
  const stage = patch.stage ? assertChoice(text(patch.stage), stages, 'pipeline stage') : current.stage;
  await db.prepare(`UPDATE sales_prospects SET company_name=?,website=?,company_size=?,buyer_name=?,buyer_role=?,buyer_email=?,buyer_linkedin=?,source=?,trigger_signal=?,agent_use_case=?,tool_access=?,evidence_json=?,score=?,score_reasons_json=?,stage=?,estimated_value_pence=?,next_action=?,next_action_at=?,notes=?,updated_at=? WHERE id=?`)
    .run(text(merged.companyName, 200), validateUrl(optional(merged.website, 500)), optional(merged.companySize, 50),
      optional(merged.buyerName, 200), optional(merged.buyerRole, 200), optional(merged.buyerEmail, 254)?.toLowerCase() || null,
      validateUrl(optional(merged.buyerLinkedin, 500)), text(merged.source, 100) || 'manual', optional(merged.triggerSignal, 1000),
      optional(merged.agentUseCase, 2000), optional(merged.toolAccess, 2000), jsonArray(merged.evidence), scored.score,
      jsonArray(scored.reasons), stage, Math.max(0, Number(merged.estimatedValuePence || 0)), optional(merged.nextAction, 500),
      optional(merged.nextActionAt, 50), optional(merged.notes, 4000), nowIso(), prospectId);
  await insertEvent('sales_prospect_updated', userId, { prospectId, stage, score: scored.score });
  return getProspect(prospectId);
}

export async function getProspect(prospectId) {
  return publicProspect(await db.prepare('SELECT * FROM sales_prospects WHERE id=?').get(prospectId));
}
export async function listProspects({ stage, limit = 200 } = {}) {
  const bounded = Math.max(1, Math.min(500, Number(limit) || 200));
  const rows = stage
    ? await db.prepare('SELECT * FROM sales_prospects WHERE stage=? ORDER BY score DESC, updated_at DESC LIMIT ?').all(assertChoice(stage, stages, 'pipeline stage'), bounded)
    : await db.prepare('SELECT * FROM sales_prospects ORDER BY CASE WHEN next_action_at IS NULL THEN 1 ELSE 0 END, next_action_at ASC, score DESC, updated_at DESC LIMIT ?').all(bounded);
  return rows.map(publicProspect);
}

export function draftOutreach(prospect, messageType = 'first_message', channel = 'linkedin') {
  const buyer = prospect.buyerName ? prospect.buyerName.split(/\s+/)[0] : 'there';
  const signal = prospect.triggerSignal || prospect.agentUseCase;
  if (!signal) throw Object.assign(new Error('Add a verified trigger signal or agent use case before drafting outreach.'), { statusCode: 400 });
  const basis = [signal, prospect.agentUseCase, prospect.toolAccess].filter(Boolean);
  const company = prospect.companyName;
  const useCase = prospect.agentUseCase || 'your AI-agent workflow';
  const bodies = {
    connection: `Hi ${buyer} — I saw that ${company} is working on ${useCase}. I focus on security testing for AI agents with real tools and permissions. I would be interested to follow what you are building.`,
    first_message: `Thanks for connecting, ${buyer}. AgentRiskLayer tests what can happen when an AI agent receives malicious instructions, misuses a tool, or acts beyond its intended authority. We produce an integrity-digested assessment, remediation list, and evidence-bounded deployment decision. I noticed ${signal}. Have you already tested the agent's tool permissions and prompt-injection paths?`,
    assessment_offer: `Hi ${buyer} — based on ${signal}, ${company}'s agent looks suitable for our £99 AI Agent Security Assessment. It includes a full evidence-bounded report plus customer-operated inspection, controlled-testing, remediation and retest workflows. The report claims only work actually completed. Would a 15-minute demonstration be useful this week?`,
    follow_up: `Hi ${buyer} — one practical question: if the agent took an unsafe action tomorrow, could ${company} show exactly which controls were tested before deployment? That evidence gap is what AgentRiskLayer is designed to close.`,
  };
  const body = bodies[messageType];
  if (!body) throw Object.assign(new Error('Invalid message type.'), { statusCode: 400 });
  return { channel, messageType, subject: channel === 'email' ? `Security evidence for ${company}'s AI agent` : null, body, factualBasis: basis };
}

export async function createMessage(userId, prospectId, input = {}) {
  const prospect = await getProspect(prospectId);
  if (!prospect) throw Object.assign(new Error('Prospect not found.'), { statusCode: 404 });
  const generated = input.body ? {
    channel: text(input.channel, 30) || 'linkedin', messageType: text(input.messageType, 50) || 'custom',
    subject: optional(input.subject, 200), body: text(input.body, 4000), factualBasis: input.factualBasis || [],
  } : draftOutreach(prospect, text(input.messageType, 50) || 'first_message', text(input.channel, 30) || 'linkedin');
  if (!generated.body) throw Object.assign(new Error('Message body is required.'), { statusCode: 400 });
  const messageId = id('msg_');
  const now = nowIso();
  await db.prepare(`INSERT INTO sales_messages (id,prospect_id,channel,message_type,subject,body,factual_basis_json,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'draft',?,?,?)`)
    .run(messageId, prospectId, generated.channel, generated.messageType, generated.subject, generated.body, jsonArray(generated.factualBasis), userId, now, now);
  await insertEvent('sales_message_drafted', userId, { prospectId, messageId });
  return publicMessage(await db.prepare('SELECT * FROM sales_messages WHERE id=?').get(messageId));
}

export async function updateMessage(userId, messageId, patch) {
  const current = await db.prepare('SELECT * FROM sales_messages WHERE id=?').get(messageId);
  if (!current) throw Object.assign(new Error('Message not found.'), { statusCode: 404 });
  const status = patch.status ? assertChoice(text(patch.status), messageStatuses, 'message status') : current.status;
  if (status === 'sent' && current.status !== 'approved' && patch.status === 'sent')
    throw Object.assign(new Error('Only an approved message can be marked sent.'), { statusCode: 409 });
  const approvedAt = status === 'approved' ? (current.approved_at || nowIso()) : current.approved_at;
  const approvedBy = status === 'approved' ? userId : current.approved_by;
  const sentAt = status === 'sent' ? (current.sent_at || nowIso()) : current.sent_at;
  await db.prepare(`UPDATE sales_messages SET subject=?,body=?,status=?,approved_by=?,approved_at=?,sent_at=?,response_outcome=?,updated_at=? WHERE id=?`)
    .run(optional(patch.subject ?? current.subject, 200), text(patch.body ?? current.body, 4000), status, approvedBy, approvedAt, sentAt,
      optional(patch.responseOutcome ?? current.response_outcome, 500), nowIso(), messageId);
  await insertEvent(`sales_message_${status}`, userId, { prospectId: current.prospect_id, messageId });
  return publicMessage(await db.prepare('SELECT * FROM sales_messages WHERE id=?').get(messageId));
}

export async function listMessages(prospectId = null) {
  const rows = prospectId
    ? await db.prepare('SELECT * FROM sales_messages WHERE prospect_id=? ORDER BY created_at DESC').all(prospectId)
    : await db.prepare('SELECT * FROM sales_messages ORDER BY created_at DESC LIMIT 250').all();
  return rows.map(publicMessage);
}

export async function recordActivity(userId, prospectId, input) {
  if (!await getProspect(prospectId)) throw Object.assign(new Error('Prospect not found.'), { statusCode: 404 });
  const activityType = assertChoice(text(input.activityType), activityTypes, 'activity type');
  const activityId = id('act_');
  const occurredAt = optional(input.occurredAt, 50) || nowIso();
  await db.prepare(`INSERT INTO sales_activities (id,prospect_id,activity_type,outcome,detail,amount_pence,occurred_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(activityId, prospectId, activityType, optional(input.outcome, 200), optional(input.detail, 2000),
      input.amountPence == null ? null : Math.max(0, Number(input.amountPence) || 0), occurredAt, userId, nowIso());
  await insertEvent('sales_activity_recorded', userId, { prospectId, activityType });
  return { id: activityId, prospectId, activityType, occurredAt };
}

export async function salesOverview() {
  const [totals, stagesRows, dueRows, messages, activities] = await Promise.all([
    db.prepare(`SELECT COUNT(*) prospects, COALESCE(SUM(CASE WHEN stage IN ('customer','subscription') THEN 1 ELSE 0 END),0) customers, COALESCE(SUM(CASE WHEN stage NOT IN ('customer','subscription','lost') THEN estimated_value_pence ELSE 0 END),0) pipeline_value_pence FROM sales_prospects`).get(),
    db.prepare('SELECT stage,COUNT(*) count FROM sales_prospects GROUP BY stage ORDER BY count DESC').all(),
    db.prepare(`SELECT * FROM sales_prospects WHERE next_action_at IS NOT NULL AND stage NOT IN ('customer','subscription','lost') ORDER BY next_action_at ASC LIMIT 30`).all(),
    db.prepare(`SELECT COUNT(*) drafts, COALESCE(SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END),0) approved, COALESCE(SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END),0) sent FROM sales_messages`).get(),
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN activity_type='assessment_sold' THEN amount_pence ELSE 0 END),0) assessment_revenue_pence, COALESCE(SUM(CASE WHEN activity_type='subscription_sold' THEN amount_pence ELSE 0 END),0) subscription_revenue_pence, COALESCE(SUM(CASE WHEN activity_type='demo' THEN 1 ELSE 0 END),0) demos FROM sales_activities`).get(),
  ]);
  return {
    totals: { prospects: Number(totals.prospects), customers: Number(totals.customers), pipelineValuePence: Number(totals.pipeline_value_pence), drafts: Number(messages.drafts), approved: Number(messages.approved), sent: Number(messages.sent), demos: Number(activities.demos), assessmentRevenuePence: Number(activities.assessment_revenue_pence), subscriptionRevenuePence: Number(activities.subscription_revenue_pence) },
    stages: stagesRows.map((row) => ({ stage: row.stage, count: Number(row.count) })),
    due: dueRows.map(publicProspect),
  };
}

export function buildDemoBrief(prospect) {
  if (!prospect) throw Object.assign(new Error('Prospect not found.'), { statusCode: 404 });
  return {
    company: prospect.companyName,
    opening: `Before I show the platform: what can your agent access, and what would be the consequence of an incorrect action?`,
    knownContext: [prospect.triggerSignal, prospect.agentUseCase, prospect.toolAccess].filter(Boolean),
    qualificationQuestions: [
      'Which models, MCP servers, tools, data stores and credentials can the agent access?',
      'How do you currently test prompt injection and unsafe tool calls?',
      'Which actions require human approval, and is approval bound to the exact transaction?',
      'What evidence must you show customers or management before deployment?',
    ],
    sequence: [
      '2 min — confirm the agent, access and possible business impact',
      '3 min — register the agent, models, tools and permissions',
      '4 min — show deterministic inspection and controlled red-team evidence',
      '3 min — show findings, remediation owners and evidence chain',
      '2 min — show retest and deployment decision',
      '1 min — ask for the £99 assessment',
    ],
    close: `Would you like us to run the £99 assessment on ${prospect.companyName}'s real agent this week?`,
    claimBoundaries: ['Do not promise zero risk or guaranteed security.', 'Do not claim certification or automatic compliance.', 'Do not invent customers, outcomes or findings.'],
  };
}
