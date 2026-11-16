import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMissionPlanCreate,
  validateMissionTaskCreate,
  validateMissionTaskCompletion,
} from '../desktop/enkyron-psa-planning-contract.mjs';

const company = '11111111-2222-4333-8444-555555555555';
const opportunity = '22222222-3333-4444-8555-666666666666';
const mission = '33333333-4444-4555-8666-777777777777';
const taskId = '44444444-5555-4666-8777-888888888888';
const request = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const plan = {
  company_id: company, opportunity_id: opportunity,
  title: 'Synthetic security assessment',
  description: 'Prepare a client engagement for later independent review.',
  due_date: '2026-12-18', request_id: request, confirmed: true,
};
const task = {
  mission_id: mission, kind: 'task', title: 'Schedule the kickoff meeting',
  due_date: '2026-11-30', request_id: request, confirmed: true,
};

test('ENK-08: a mission can only start as planning, never as an accepted contract', () => {
  assert.deepEqual(validateMissionPlanCreate(plan), {
    ...Object.fromEntries(Object.entries(plan).filter(([k]) => k !== 'confirmed')),
    status: 'planning',
  });
  assert.equal(validateMissionPlanCreate({...plan, opportunity_id: undefined}).opportunity_id, null);
  assert.equal(validateMissionPlanCreate({...plan, due_date: null}).due_date, null);
  for (const key of ['status', 'workspace_key', 'actor', 'assignee_id', 'sow_approved', 'testing_authorised', 'budget_minor']) {
    assert.throws(() => validateMissionPlanCreate({...plan, [key]: true}), /PSA invalid/);
  }
});

test('ENK-08: malformed identities, hidden text and invalid dates are rejected', () => {
  for (const bad of [
    {...plan, confirmed: false},
    {...plan, company_id: 'other-tenant'},
    {...plan, opportunity_id: 'not-a-uuid'},
    {...plan, request_id: 'reused but not UUID'},
    {...plan, title: 'Bad\u202Etitle'},
    {...plan, description: 'short'},
    {...plan, due_date: '2026-02-30'},
    {...plan, due_date: '2026-13-01'},
    {...plan, due_date: '2026-12-18T00:00:00Z'},
    {...plan, title: ' '.repeat(200)},
    []
  ]) assert.throws(() => validateMissionPlanCreate(bad), /PSA/);
});

test('ENK-08: tasks and milestones are accepted as planning-only work items', () => {
  assert.deepEqual(validateMissionTaskCreate(task), {
    mission_id: mission, kind: 'task', title: task.title,
    due_date: task.due_date, request_id: request, status: 'open',
  });
  assert.equal(validateMissionTaskCreate({...task, kind: 'milestone'}).kind, 'milestone');
  for (const bad of [
    {...task, kind: 'invoice'}, {...task, assignee_id: company},
    {...task, completed: true}, {...task, confirmed: false},
    {...task, due_date: '2026-02-29'}, {...task, title: '<script>bad</script>\u200B'},
  ]) assert.throws(() => validateMissionTaskCreate(bad), /PSA/);
});

test('ENK-08: completion requires explicit confirmation and optimistic version', () => {
  const completion = {
    mission_id: mission, task_id: taskId, expected_version: 3,
    request_id: request, completed: true, confirmed: true,
  };
  assert.deepEqual(validateMissionTaskCompletion(completion), {
    mission_id: mission, task_id: taskId, expected_version: 3,
    request_id: request, completed: true,
  });
  for (const bad of [
    {...completion, expected_version: 0},
    {...completion, expected_version: 1.5},
    {...completion, completed: false},
    {...completion, confirmed: false},
    {...completion, status: 'done'},
    {...completion, task_id: 'stranger'},
  ]) assert.throws(() => validateMissionTaskCompletion(bad), /PSA/);
});

test('ENK-08: request payload prototypes and unexpected input are denied', () => {
  assert.throws(() => validateMissionPlanCreate(Object.assign(Object.create({company_id: company}), plan)), /PSA/);
  assert.throws(() => validateMissionTaskCreate({...task, __proto__: undefined, unexpected: 1}), /PSA/);
  assert.throws(() => validateMissionTaskCompletion(null), /PSA/);
});
