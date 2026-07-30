// Inline diagnostics: the compiler's own verdict, drawn where you are typing.
//
// Nothing here decides what is wrong with a file. It loads the compiler's
// WebAssembly build, asks it, and turns the answer into squiggles. That is
// deliberate -- a second implementation of the rules living in an editor would
// eventually disagree with the first, and then the language would have two
// meanings depending on where you read it.
//
// The severity policy -- and it is not the obvious one -- lives in `verdict.js`,
// which has no dependency on VS Code so it can be checked without an editor.
// This file is glue: read the files, call the compiler, place the ranges.

const vscode = require('vscode');
const path = require('path');
const { toDiagnostics, GENIE } = require('./verdict.js');

/** Milliseconds of quiet before a keystroke turns into a judgment. */
const SETTLE = 250;

/** The compiler module, loaded once, lazily, and only if a .wish is opened. */
let compiler = null;
function load(context) {
  if (!compiler) {
    compiler = (async () => {
      const createLoophole = require(
        path.join(context.extensionPath, 'wasm', 'loophole.js'));
      return await createLoophole();
    })();
  }
  return compiler;
}

// ---------------------------------------------------------------------------
// Which genie judges this wish.
//
// `# genie: path` is already a convention in the language's own examples --
// `make run` reads the same line to decide what to load. Following it means a
// file the terminal judges one way is not judged another way here. With no such
// line the compiler's built-in genie applies, which is what an empty string
// means to `judge`.
// ---------------------------------------------------------------------------
const GENIE_LINE = /^[ \t]*#[ \t]*genie:[ \t]*(\S+)/m;

const openDoc = (fsPath) =>
  vscode.workspace.textDocuments.find((d) => d.uri.fsPath === fsPath);

async function genieFor(doc) {
  const text = doc.getText();
  const m = GENIE_LINE.exec(text);
  if (!m) return { text: '', uri: null };

  const fsPath = path.resolve(path.dirname(doc.uri.fsPath), m[1]);
  // An open editor's unsaved buffer beats what is on disk. Editing a genie
  // should move the squiggles in the wish immediately -- reading the saved file
  // instead would leave the two panes disagreeing about the same moment.
  const open = openDoc(fsPath);
  if (open) return { text: open.getText(), uri: open.uri };
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
    return { text: Buffer.from(bytes).toString('utf8'), uri: vscode.Uri.file(fsPath) };
  } catch {
    return { missing: m[1], line: doc.positionAt(m.index).line };
  }
}

// ---------------------------------------------------------------------------

/** Turn a `verdict.js` entry into a range in `doc`. */
function rangeOf(doc, d) {
  // The compiler counts from 1, VS Code from 0. A line past the end of the
  // buffer is reachable while typing -- the text was handed over before the
  // last keystroke landed -- so clamp instead of dropping the diagnostic.
  const line = Math.max(0, Math.min((d.line || 1) - 1, doc.lineCount - 1));
  const text = doc.lineAt(line).text;
  const col = Math.max(0, Math.min((d.column || 1) - 1, Math.max(text.length - 1, 0)));

  if (d.span === 'token') {
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(col));
    return new vscode.Range(line, col, line, col + (word ? word[0].length : 1));
  }
  // The whole line, minus the indent, so the underline traces the code rather
  // than the empty space in front of it.
  const from = text.length - text.trimStart().length;
  return new vscode.Range(line, from, line, Math.max(text.trimEnd().length, from + 1));
}

function activate(context) {
  const bag = vscode.languages.createDiagnosticCollection('loophole');
  context.subscriptions.push(bag);

  const timers = new Map();
  // Which genie each wish was judged by, so editing a genie re-judges the
  // wishes that actually depend on it rather than every open file.
  const dependsOn = new Map();
  let announcedFailure = false;

  async function judge(doc) {
    if (doc.languageId !== 'wish') return;

    let M;
    try {
      M = await load(context);
    } catch (err) {
      // Once, not once per keystroke. And loudly: silence here would look
      // exactly like a clean file, which is the worst possible lie to tell.
      console.error('loophole: could not load the compiler', err);
      if (!announcedFailure) {
        announcedFailure = true;
        vscode.window.showErrorMessage(
          'Loophole: the compiler failed to load, so diagnostics are off.');
      }
      return;
    }

    const genie = await genieFor(doc);
    dependsOn.set(doc.uri.toString(), genie.uri ? genie.uri.fsPath : null);

    if (genie.missing) {
      const d = new vscode.Diagnostic(
        rangeOf(doc, { line: genie.line + 1, column: 1, span: 'line' }),
        `no such genie: ${genie.missing}`, vscode.DiagnosticSeverity.Error);
      d.source = 'loophole';
      bag.set(doc.uri, [d]);
      return;
    }

    let r;
    try {
      r = M.judge(doc.getText(), genie.text, false, false, 0, 0);
    } catch (err) {
      console.error('loophole: the compiler threw', err);
      return;
    }

    let json = null;
    try { json = JSON.parse(r.json); } catch { /* nothing to report */ }

    const genieDoc = genie.uri && openDoc(genie.uri.fsPath);
    const wish = [], gen = [];
    for (const d of toDiagnostics(json)) {
      const onGenie = d.file === GENIE && genieDoc;
      const target = onGenie ? genieDoc : doc;
      const v = new vscode.Diagnostic(rangeOf(target, d), d.message,
        d.severity === 'error' ? vscode.DiagnosticSeverity.Error
                               : vscode.DiagnosticSeverity.Information);
      v.source = 'loophole';
      v.code = d.code;
      (onGenie ? gen : wish).push(v);
    }
    bag.set(doc.uri, wish);
    if (genieDoc) bag.set(genieDoc.uri, gen);
  }

  function schedule(doc) {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); judge(doc); }, SETTLE));
  }

  /** A genie changed: re-judge the wishes that named it. */
  function scheduleDependants(genieDoc) {
    for (const d of vscode.workspace.textDocuments) {
      if (d.languageId !== 'wish') continue;
      const named = dependsOn.get(d.uri.toString());
      // `undefined` means never judged, so which genie it wants is unknown.
      if (named === undefined || named === genieDoc.uri.fsPath) schedule(d);
    }
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => judge(d)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'wish') schedule(e.document);
      else if (e.document.languageId === 'genie') scheduleDependants(e.document);
    }),
    // A genie edited outside an editor, or one whose buffer was never open, is
    // read from disk -- a save is the only signal there is.
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.languageId === 'genie') scheduleDependants(d);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      bag.delete(d.uri);
      clearTimeout(timers.get(d.uri.toString()));
      timers.delete(d.uri.toString());
      dependsOn.delete(d.uri.toString());
    }),
  );

  for (const d of vscode.workspace.textDocuments) judge(d);
}

function deactivate() {}

module.exports = { activate, deactivate };
