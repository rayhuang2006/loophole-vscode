// The one check that runs inside a real VS Code.
//
// `extension-check.mjs` drives `activate()` against a stub, which proves the
// code works. It cannot prove that *VS Code* runs it -- that depends on the
// manifest: `main`, `activationEvents`, `engines`, and whether a `.wish` file is
// even recognised as the `wish` language. Every one of those can be wrong in a
// package that installs without complaint and then does nothing at all.
//
// Run with:
//   code --extensionDevelopmentPath=<repo> --extensionTestsPath=<this file> <dir>
//
// `run()` returning means pass; throwing means fail, and VS Code exits non-zero.

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');

const WISH = [
  '# genie: strict.genie',
  'register wishes : uint<2> = 3',
  '',
  'wish greedy {',
  '    add wishes, 3',
  '}',
  '',
  'wish humble {',
  '    sub wishes, 3',
  '}',
  '',
].join('\n');

const GENIE = [
  'counter wishes',
  'toll    1',
  '',
  'rule NoMoreWishes {',
  '    layer   ast',
  '    forbid  add on wishes',
  '    because "no wishing for more wishes"',
  '}',
  '',
  'invariant I2 {',
  '    check wishes <= max(before(wishes) - toll, 0)',
  '    label "no net gain"',
  '}',
  '',
].join('\n');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loophole-vscode-'));
  const wishPath = path.join(dir, 'demo.wish');
  fs.writeFileSync(wishPath, WISH);
  fs.writeFileSync(path.join(dir, 'strict.genie'), GENIE);

  const doc = await vscode.workspace.openTextDocument(wishPath);
  await vscode.window.showTextDocument(doc);

  // The language has to be recognised before anything else can happen: without
  // it the file is plain text, `onLanguage:wish` never fires, and the extension
  // sits there deactivated while the editor looks perfectly fine.
  if (doc.languageId !== 'wish') {
    throw new Error(`a .wish file was opened as '${doc.languageId}'`);
  }

  const ext = vscode.extensions.getExtension('rayhuang2006.loophole');
  if (!ext) throw new Error('the extension is not present in this VS Code');

  // Deliberately NOT `await ext.activate()`. Opening a `.wish` file has to be
  // what activates it; asking it to activate would prove only that the function
  // exists.
  //
  // Note that the `activationEvents` entry in the manifest is not what does this
  // -- emptying that field changes nothing, because VS Code infers
  // `onLanguage:wish` from `contributes.languages`. The entry is documentation.
  // What this catches, checked by breaking each one: a `main` that does not
  // resolve, and `.wish` not being claimed by any language (the file opens as
  // plaintext, and the assertion above is the one that fires).
  for (let i = 0; i < 40 && !ext.isActive; i++) await wait(250);
  if (!ext.isActive) {
    throw new Error('opening a .wish file did not activate the extension');
  }

  // Poll rather than sleep once: the wasm instantiates asynchronously and how
  // long that takes is not this test's business.
  let got = [];
  for (let i = 0; i < 60 && got.length < 2; i++) {
    await wait(250);
    got = vscode.languages.getDiagnostics(doc.uri);
  }

  const show = () => JSON.stringify(got.map((d) => ({
    line: d.range.start.line, severity: d.severity, code: d.code,
    message: d.message.split('\n')[0],
  })), null, 1);

  const must = (ok, what) => { if (!ok) throw new Error(`${what}\n  saw: ${show()}`); };

  must(got.length === 2, 'expected two diagnostics on the wish');

  const refused = got.find((d) => d.code === 'NoMoreWishes');
  const exploit = got.find((d) => d.code === 'exploit');
  must(refused, 'no diagnostic for the refused wish');
  must(exploit, 'no diagnostic for the exploit');

  const INFO = vscode.DiagnosticSeverity.Information;
  must(refused.severity === INFO, 'a refusal must not be an error');
  must(exploit.severity === INFO, 'an exploit must not be an error');
  must(refused.range.start.line === 4, 'the refusal must sit on `add wishes, 3`');
  must(exploit.range.start.line === 7, 'the exploit must sit on `wish humble`');
  must(/broke I2/.test(exploit.message), 'the exploit must name what it broke');
  must(got.every((d) => d.source === 'loophole'), 'diagnostics must be attributed');

  // Editing the file must move the squiggles. A one-shot judgment on open would
  // pass everything above and be useless the moment somebody typed.
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(8, 4, 8, 17), 'sub wishes, 1');
  await vscode.workspace.applyEdit(edit);

  let after = got;
  for (let i = 0; i < 60; i++) {
    await wait(250);
    after = vscode.languages.getDiagnostics(doc.uri);
    if (after.length === 1) break;    // `sub wishes, 1` is clean; only the refusal is left
  }
  if (after.length !== 1) {
    throw new Error('editing the file did not re-judge it\n  saw: ' +
      JSON.stringify(after.map((d) => d.code)));
  }

  console.log('  ok   VS Code activates it and the diagnostics arrive');
}

module.exports = { run };
