import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDirectCompanyOpportunityCreate,
  validateOpportunityUpdate
} from '../desktop/enkyron-crm-opportunities.mjs';

const company_id = '12345678-1234-1234-1234-123456789abc';
const opportunity_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const direct = (next_action) => ({
  company_id,
  company_name_at_review: 'Gradient Labs',
  next_action,
  due_date: null,
  confirmed: true
});

test('company opportunity accepts readable multiline next action from Qt', () => {
  const body = 'Send personalised introduction to Zan.\nAttach ARL overview.\nWait for reply by email.';
  assert.equal(validateDirectCompanyOpportunityCreate(direct(body)).next_action, body);
});

test('CRLF and CR input are normalised to LF without losing paragraphs', () => {
  const value = '  First action.\r\nSecond action.\rThird action.  ';
  assert.equal(validateDirectCompanyOpportunityCreate(direct(value)).next_action,
    'First action.\nSecond action.\nThird action.');
});

test('existing opportunity updates accept the same safe multiline format', () => {
  const result = validateOpportunityUpdate({
    id: opportunity_id, expected_version: 1, stage: 'contacted',
    next_action: 'Delivery confirmed.\nAwait reply via email.', due_date: null,
    company_id, confirmed: true
  });
  assert.equal(result.next_action, 'Delivery confirmed.\nAwait reply via email.');
});

test('next action still rejects controls, blank or excessive length', () => {
  for (const value of ['hi', '\tSend email', 'Send\0email', 'a'.repeat(1001), ' \n  ']) {
    assert.throws(() => validateDirectCompanyOpportunityCreate(direct(value)),
      /CRM invalid next action/);
  }
});

test('contact name remains subject to existing strict single-line validation', () => {
  assert.throws(() => validateDirectCompanyOpportunityCreate({
    ...direct('Send email to Zan.'),
    company_name_at_review: 'Gradient\nLabs'
  }), /CRM invalid company name/);
});
