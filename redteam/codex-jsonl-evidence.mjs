/**
 * Passive Codex CLI --json observation. This is not independent attestation.
 * Does not run Codex, execute tools, or store raw transcripts.
 */
import { createHash } from 'node:crypto';

const EVENT_TYPES = new Set([
  'thread.started', 'turn.started', 'item.started', 'item.updated',
  'item.completed', 'turn.completed', 'turn.failed', 'error'
]);
const ACTION_TYPES = new Set(['command_execution', 'mcp_tool_call', 'file_change']);
const MAX_BYTES = 1024 * 1024;
const MAX_EVENTS = 5000;
const sha256 = value => createHash('sha256').update(value).digest('hex');

export function observeCodexJsonl(source) {
  if (typeof source !== 'string') throw new TypeError('Codex JSONL must be text');
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) throw new Error('Codex JSONL exceeds observation size limit');
  let events = 0, threads = 0, malformed = 0, unknown = 0, errors = 0;
  let terminal = null, reportedActions = 0;
  const actionKinds = new Set(), issues = new Set();
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (++events > MAX_EVENTS) throw new Error('Codex JSONL exceeds event limit');
    let event;
    try { event = JSON.parse(line); }
    catch { malformed++; issues.add('malformed_jsonl'); continue; }
    if (!event || Array.isArray(event) || typeof event !== 'object' || typeof event.type !== 'string') {
      malformed++; issues.add('invalid_event_shape'); continue;
    }
    if (!EVENT_TYPES.has(event.type)) { unknown++; issues.add('unsupported_event_type'); }
    if (event.type === 'thread.started') {
      threads++;
      if (typeof event.thread_id !== 'string' || event.thread_id.length < 3) issues.add('missing_thread_id');
      if (threads > 1) issues.add('multiple_threads');
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      errors++;
      if (terminal === 'turn.completed') issues.add('conflicting_terminal_events');
      terminal = 'turn.failed';
    } else if (event.type === 'turn.completed') {
      if (terminal === 'turn.failed') issues.add('conflicting_terminal_events');
      terminal = 'turn.completed';
    } else if (terminal) issues.add('events_after_terminal');
    if (['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
      const kind = event.item?.type;
      if (typeof kind !== 'string') issues.add('missing_item_type');
      if (ACTION_TYPES.has(kind)) { reportedActions++; actionKinds.add(kind); }
    }
  }
  if (threads !== 1) issues.add('single_thread_not_confirmed');
  if (terminal !== 'turn.completed') issues.add('successful_turn_completion_not_confirmed');
  if (errors) issues.add('codex_reported_error');
  return Object.freeze({
    schema: 'arl.codex.passive-observation.v1',
    source: 'codex_jsonl_not_independent_runtime_attestation',
    traceSha256: sha256(source),
    traceComplete: issues.size === 0,
    eventCount: events,
    malformedEvents: malformed,
    unknownEvents: unknown,
    reportedActionEvents: reportedActions,
    reportedActionTypes: [...actionKinds].sort(),
    issues: [...issues],
    securityVerdict: 'not_assessed',
    arlExecutionStatus: 'unverified'
  });
}

export function lastAgentMessage(source) {
  let final = '';
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'item.completed' && e.item?.type === 'agent_message' && typeof e.item.text === 'string') {
      final = e.item.text.slice(0, 16000);
    }
  }
  return final;
}
