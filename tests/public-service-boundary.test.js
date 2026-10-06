import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUBLIC_SERVICE_ALLOWED_PATHS,
  isPublicServiceRestrictedPath
} from '../src/public-service-boundary.js';

test('public deployment keeps only the request and health boundary open', () => {
  for (const pathname of PUBLIC_SERVICE_ALLOWED_PATHS) {
    assert.equal(
      isPublicServiceRestrictedPath(pathname),
      false,
      pathname
    );
  }

  for (const pathname of [
    '/api/projects',
    '/api/csrf',
    '/api/inspector/upload',
    '/api/redteam/upload',
    '/v1/guard',
    '/scim/v2/workspaces/example/Users'
  ]) {
    assert.equal(
      isPublicServiceRestrictedPath(pathname),
      true,
      pathname
    );
  }
});

test('public static pages are not blocked by the API boundary', () => {
  for (const pathname of [
    '/',
    '/index.html',
    '/request-assessment.html',
    '/trust.html',
    '/sample-report.html',
    '/marketing.css'
  ]) {
    assert.equal(
      isPublicServiceRestrictedPath(pathname),
      false,
      pathname
    );
  }
});
