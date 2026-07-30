// Download a VS Code, install nothing else, run `vscode-test.js` inside it.
//
// A real editor because the thing being checked is the manifest -- `main`,
// `activationEvents`, whether a `.wish` file is recognised as `wish` at all --
// and none of that runs anywhere else. Cached under `.vscode-test/`, so this is
// slow once.
import { runTests } from '@vscode/test-electron';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A folder, not a loose file. Tasks are scoped to a workspace, and VS Code drops
// workspace-scoped tasks when no folder is open -- so without this the task
// provider looks broken while being perfectly fine. It is also what people
// actually do.
const workspace = mkdtempSync(path.join(tmpdir(), 'loophole-ws-'));

try {
  const code = await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'tools', 'vscode-test.js'),
    // Nothing else installed. A formatter or a linter that also reports on
    // these files would make it impossible to tell whose diagnostics arrived.
    launchArgs: [workspace, '--disable-extensions', '--disable-gpu'],
  });
  process.exit(code);
} catch (err) {
  console.error(err?.message ?? err);
  process.exit(1);
}
