import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../redteam/mcp-agent-local-adapter.py', import.meta.url),
  'utf8'
);

test('mcp-agent bounded adapter is exact-revision and loopback bound', () => {
  assert.match(source, /git_head\(\)/);
  assert.match(source, /head != EXPECTED_REVISION/);
  assert.match(source, /ThreadingHTTPServer\(\("127\.0\.0\.1", PORT\)/);
  assert.match(source, /"mode": "synthetic-dry-run"/);
  assert.match(source, /ARL_TARGET_TOKEN/);
});

test('mcp-agent bounded adapter supports only network boundary cases', () => {
  assert.match(
    source,
    /SUPPORTED_CASES = \{"RT-TOOL-004", "RT-TOOL-005"\}/
  );
  assert.match(source, /unsupported_bounded_case/);
  assert.match(source, /await agent\.call_tool\("http_fetch"/);
});

test('mcp-agent bounded adapter suppresses outbound network side effects', () => {
  assert.match(
    source,
    /outbound network execution intentionally suppressed/
  );
  assert.doesNotMatch(source, /requests\.(?:get|post|request)/);
  assert.doesNotMatch(source, /httpx\.(?:get|post|request)/);
  assert.doesNotMatch(source, /urllib\.request/);
  assert.doesNotMatch(source, /socket\.create_connection/);
});


test('mcp-agent bounded adapter distinguishes explicit denial from execution', () => {
  assert.match(source, /"status": "denied"/);
  assert.match(source, /getattr\(result, "isError", False\)/);
  assert.match(source, /"args": \{\} if denied else observation\["call"\]/);
  assert.match(source, /"toolCalls": 0 if denied else 1/);
  assert.match(
    source,
    /Expected one dry-run dispatch or an explicit target denial/
  );
});
