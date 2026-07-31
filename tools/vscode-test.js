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
  // Write into the folder VS Code was launched with, when there is one, so the
  // files live inside a workspace. Tasks are workspace-scoped and VS Code will
  // not hand back a task for a file that belongs to no folder.
  const dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
           ?? fs.mkdtempSync(path.join(os.tmpdir(), 'loophole-vscode-'));
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

  // --- a genie, checked on its own -----------------------------------------
  // Open the genie and break it. Two things must happen, and the second is the
  // one the old code got wrong: the genie carries its own error, and the wish
  // says only that it cannot be judged -- on its `# genie:` line, never as a
  // red mark on code that is fine.
  const genieUri = vscode.Uri.file(path.join(dir, 'strict.genie'));
  const genieDoc = await vscode.workspace.openTextDocument(genieUri);
  await vscode.window.showTextDocument(genieDoc);
  if (genieDoc.languageId !== 'genie') {
    throw new Error(`a .genie file was opened as '${genieDoc.languageId}'`);
  }

  // The rule opens with `rule NoMoreWishes {` on line 3. Take the brace off.
  const brokeIt = new vscode.WorkspaceEdit();
  brokeIt.replace(genieUri, new vscode.Range(3, 0, 3, GENIE.split('\n')[3].length),
                  'rule NoMoreWishes');
  await vscode.workspace.applyEdit(brokeIt);

  let g = [], w = [];
  for (let i = 0; i < 60; i++) {
    await wait(250);
    g = vscode.languages.getDiagnostics(genieUri);
    w = vscode.languages.getDiagnostics(doc.uri);
    if (g.length && w.some((d) => d.code === 'genie-error')) break;
  }
  const E = vscode.DiagnosticSeverity.Error;
  must(g.length === 1 && g[0].severity === E,
       'a broken genie must show its own error\n  saw: ' +
       JSON.stringify(g.map((d) => ({ line: d.range.start.line, sev: d.severity }))));
  must(g[0].source === 'loophole', 'the genie error must be attributed');

  const note = w.find((d) => d.code === 'genie-error');
  must(note, 'the wish must say it cannot be judged\n  saw: ' +
             JSON.stringify(w.map((d) => d.code)));
  must(note.severity === vscode.DiagnosticSeverity.Warning,
       'a broken genie is not the wish being wrong -- a warning, not an error');
  must(note.range.start.line === 0,
       'the note belongs on the `# genie:` line, not on the wish code');
  must(!w.some((d) => d.severity === E),
       'nothing in the wish should be an error when only the genie is broken');

  console.log('  ok   VS Code activates it and the diagnostics arrive');
  console.log('  ok   a lone genie carries its own syntax errors');

  // --- the three providers, through VS Code's own commands -----------------
  // `executeCodeLensProvider` and friends are how the editor itself asks. They
  // go through the same contribution points the manifest declares, so this is
  // the only place that proves a provider is actually reachable -- registering
  // one for a language nothing resolves to would pass every other check here.
  //
  // Put the genie back first: a broken genie means no judgment, and no judgment
  // means no lenses.
  const fixIt = new vscode.WorkspaceEdit();
  fixIt.replace(genieUri, new vscode.Range(3, 0, 3, 'rule NoMoreWishes'.length),
                'rule NoMoreWishes {');
  await vscode.workspace.applyEdit(fixIt);

  await vscode.window.showTextDocument(doc);
  // The wish was edited earlier to `sub wishes, 1`, which is clean. Put the
  // exploit back so there is a verdict worth reading.
  const restore = new vscode.WorkspaceEdit();
  restore.replace(doc.uri, new vscode.Range(8, 4, 8, 17), 'sub wishes, 3');
  await vscode.workspace.applyEdit(restore);

  let lenses = [];
  for (let i = 0; i < 60; i++) {
    await wait(250);
    lenses = await vscode.commands.executeCommand(
      'vscode.executeCodeLensProvider', doc.uri);
    if (lenses && lenses.length === 2) break;
  }
  must(lenses && lenses.length === 2,
       'VS Code must get one CodeLens per wish\n  saw: ' +
       JSON.stringify((lenses || []).map((l) => l.command?.title)));
  const titles = lenses.map((l) => l.command.title);
  must(titles.some((t) => /not granted/.test(t)),
       'a lens must report the refusal\n  saw: ' + JSON.stringify(titles));
  must(titles.some((t) => /EXPLOIT/.test(t)),
       'a lens must report the exploit\n  saw: ' + JSON.stringify(titles));

  // Hover over the `sub` on line index 8.
  const hovers = await vscode.commands.executeCommand(
    'vscode.executeHoverProvider', doc.uri, new vscode.Position(8, 5));
  const hoverText = (hovers || [])
    .flatMap((h) => h.contents.map((c) => c.value ?? String(c))).join('\n');
  must(/modulo the register/.test(hoverText),
       'hovering `sub` must show the compiler\'s own sentence\n  saw: ' + hoverText);

  // Hover over `wishes` on the same line: a register, so the trail of values.
  const regHover = await vscode.commands.executeCommand(
    'vscode.executeHoverProvider', doc.uri, new vscode.Position(8, 10));
  const regText = (regHover || [])
    .flatMap((h) => h.contents.map((c) => c.value ?? String(c))).join('\n');
  must(/after each wish/.test(regText),
       'hovering a register must show its trail\n  saw: ' + regText);

  // Completion just after `    sub ` on line index 8.
  const list = await vscode.commands.executeCommand(
    'vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(8, 8));
  const labels = (list?.items ?? []).map((i) =>
    typeof i.label === 'string' ? i.label : i.label.label);
  must(labels.includes('wishes'),
       'completing after `sub` must offer the register\n  saw: ' +
       JSON.stringify(labels.slice(0, 12)));

  console.log('  ok   VS Code reaches the lens, hover and completion providers');

  // --- running --------------------------------------------------------------
  // The command has to be registered with VS Code, and the task has to be one
  // VS Code itself will hand back from `fetchTasks` -- a provider registered for
  // a task type the manifest never declared produces nothing, silently, and
  // every check outside a real editor still passes.
  const ids = await vscode.commands.getCommands(true);
  must(ids.includes('loophole.run'),
       'the run command must be registered with VS Code');

  const tasks = await vscode.tasks.fetchTasks({ type: 'loophole' });
  must(tasks.length >= 1,
       'VS Code must find a loophole task for the open wish\n  saw: ' + tasks.length);
  const t = tasks[0];
  must(t.definition.type === 'loophole',
       'the task must carry the declared type\n  saw: ' + JSON.stringify(t.definition));
  must(/--genie/.test(t.execution?.args?.join(' ') ?? ''),
       'the task must pass --genie, or it judges against a different genie than ' +
       'the editor\n  saw: ' + JSON.stringify(t.execution?.args));

  console.log('  ok   VS Code registers the run command and finds the task');

  // --- outline and go-to-definition ----------------------------------------
  // Through VS Code's own commands, which is the only way to know the providers
  // are reachable for these languages rather than merely constructed.
  let symbols = [];
  for (let i = 0; i < 40 && symbols.length < 3; i++) {
    await wait(250);
    symbols = await vscode.commands.executeCommand(
      'vscode.executeDocumentSymbolProvider', doc.uri) ?? [];
  }
  must(symbols.length === 3,
       'VS Code must get an outline\n  saw: ' +
       JSON.stringify(symbols.map((s) => s.name)));
  must(symbols.some((s) => s.name === 'humble'),
       'the outline must list the wishes\n  saw: ' +
       JSON.stringify(symbols.map((s) => s.name)));

  // `sub wishes, 3` is line index 8; `wishes` starts at character 8.
  const defs = await vscode.commands.executeCommand(
    'vscode.executeDefinitionProvider', doc.uri, new vscode.Position(8, 10));
  must(defs?.length >= 1,
       'go to definition must find the register\n  saw: ' + JSON.stringify(defs));
  must(defs[0].range.start.line === 1,
       'and land on the `register` line\n  saw: ' + JSON.stringify(defs[0].range));

  console.log('  ok   VS Code reaches the outline and definition providers');
}

module.exports = { run };
