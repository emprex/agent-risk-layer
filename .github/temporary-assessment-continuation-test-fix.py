from pathlib import Path

path = Path('tests/customer-journey.test.js')
text = path.read_text()
old = "  assert.match(js, /questionnaire\\[stepIndex - 1\\]/);"
new = "  assert.match(js, /flowQuestions\\[stepIndex - 1\\]/);"
if text.count(old) != 1:
    raise SystemExit(f'expected one legacy guided-question assertion, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
print('Updated guided-question regression expectation for continuation flow.')
