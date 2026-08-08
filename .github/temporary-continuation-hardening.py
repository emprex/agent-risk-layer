from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old!r}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'server.js',
    "                const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? { ...body.answers } : {};\n                if (sourceAssessment) answers.__source_assessment_id = sourceAssessment.id;",
    "                const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? { ...body.answers } : {};\n                // Revision lineage is server-derived evidence; never trust a caller-supplied lineage marker.\n                delete answers.__source_assessment_id;\n                if (sourceAssessment) answers.__source_assessment_id = sourceAssessment.id;",
)

replace_once(
    'public/result.js',
    "  if (token) params.set('token', token);",
    "  // Signed-in owners do not need the access token propagated to another URL.\n  if (token && !isOwner) params.set('token', token);",
)

path = Path('tests/customer-journey.test.js')
text = path.read_text()
old = "  assert.match(server, /__source_assessment_id/);\n  assert.match(server, /You do not have permission to create an update from this assessment/);\n  assert.match(resultJs, /Create updated assessment/);"
new = "  assert.match(server, /delete answers\\.__source_assessment_id/);\n  assert.match(server, /if \\(sourceAssessment\\) answers\\.__source_assessment_id = sourceAssessment\\.id/);\n  assert.match(server, /You do not have permission to create an update from this assessment/);\n  assert.match(resultJs, /Create updated assessment/);\n  assert.match(resultJs, /token && !isOwner/);"
if text.count(old) != 1:
    raise SystemExit(f'tests/customer-journey.test.js: expected hardening marker once, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))

print('Continuation hardening patch applied.')
