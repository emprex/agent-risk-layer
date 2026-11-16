// ENK-08: pure validation boundary for local PSA mission planning.
// No database calls, authority grants, client acceptance, testing permission or sending.
// Workspace, actor and permissions must be resolved by a trusted backend, NOT IPC input.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HIDDEN_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069]/u;
const TASK_KINDS = new Set(['task', 'milestone']);

function record(input, allowed, operation) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) ||
      Object.keys(input).some(key => !allowed.includes(key))) {
    throw new Error(`PSA invalid ${operation} request`);
  }
  if (input.confirmed !== true) throw new Error('PSA explicit operator confirmation required');
  return input;
}

function uuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new Error(`PSA invalid ${field}`);
  }
  return value.toLowerCase();
}

function text(value, field, min, max) {
  if (typeof value !== 'string' || HIDDEN_OR_CONTROL.test(value) ||
      value.length > max || value.trim().length < min) {
    throw new Error(`PSA invalid ${field}`);
  }
  const result = value.trim();
  if (result.length > max) throw new Error(`PSA invalid ${field}`);
  return result;
}

function date(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`PSA invalid ${field}`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || year > 2099 || parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`PSA invalid ${field}`);
  }
  return value;
}

export function validateMissionPlanCreate(input) {
  const data = record(input, [
    'company_id', 'opportunity_id', 'title', 'description',
    'due_date', 'request_id', 'confirmed'
  ], 'mission planning');
  return {
    company_id: uuid(data.company_id, 'company ID'),
    opportunity_id: data.opportunity_id == null ? null : uuid(data.opportunity_id, 'opportunity ID'),
    title: text(data.title, 'mission title', 5, 160),
    description: text(data.description, 'mission description', 20, 2000),
    due_date: date(data.due_date, 'mission due date'),
    request_id: uuid(data.request_id, 'request ID'),
    status: 'planning',
  };
}

export function validateMissionTaskCreate(input) {
  const data = record(input, [
    'mission_id', 'kind', 'title', 'due_date', 'request_id', 'confirmed'
  ], 'mission task');
  if (!TASK_KINDS.has(data.kind)) throw new Error('PSA invalid task kind');
  return {
    mission_id: uuid(data.mission_id, 'mission ID'),
    kind: data.kind,
    title: text(data.title, 'task title', 5, 200),
    due_date: date(data.due_date, 'task due date'),
    request_id: uuid(data.request_id, 'request ID'),
    status: 'open',
  };
}

export function validateMissionTaskCompletion(input) {
  const data = record(input, [
    'mission_id', 'task_id', 'expected_version', 'completed', 'request_id', 'confirmed'
  ], 'task completion');
  if (data.completed !== true || !Number.isSafeInteger(data.expected_version) ||
      data.expected_version < 1) {
    throw new Error('PSA invalid task completion or revision');
  }
  return {
    mission_id: uuid(data.mission_id, 'mission ID'),
    task_id: uuid(data.task_id, 'task ID'),
    expected_version: data.expected_version,
    request_id: uuid(data.request_id, 'request ID'),
    completed: true,
  };
}
