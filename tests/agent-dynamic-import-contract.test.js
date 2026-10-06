import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const agentRoot = path.join(root, 'src', 'agent');

function agentModules(directory = agentRoot) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...agentModules(absolute));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(absolute);
  }
  return files.sort();
}

function requestedBindings(fragment) {
  return fragment
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part.replace(/^\.\.\./, '').split(':')[0].split('=')[0].trim()
    )
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

test('agent dynamic imports request exports that actually exist', async () => {
  const pattern =
    /(?:const|let|var)\s*\{([\s\S]*?)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let checkedBindings = 0;

  for (const sourceFile of agentModules()) {
    const source = fs.readFileSync(sourceFile, 'utf8');
    let match;

    while ((match = pattern.exec(source)) !== null) {
      const [, bindingFragment, specifier] = match;
      if (!specifier.startsWith('.')) continue;

      const targetPath =
        path.resolve(path.dirname(sourceFile), specifier);

      assert.ok(
        fs.existsSync(targetPath),
        `${path.relative(root, sourceFile)} dynamically imports missing module ${specifier}`
      );

      const namespace =
        await import(pathToFileURL(targetPath).href);

      for (const binding of requestedBindings(bindingFragment)) {
        checkedBindings += 1;
        assert.ok(
          Object.prototype.hasOwnProperty.call(namespace, binding),
          `${path.relative(root, sourceFile)} requests ${binding} from ${path.relative(root, targetPath)}, but that export does not exist`
        );
      }
    }
  }

  assert.ok(
    checkedBindings > 0,
    'Expected to validate at least one agent dynamic import binding'
  );
});
