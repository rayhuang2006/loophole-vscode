// Drive `activate()` for real, against a stub of the VS Code API.
//
// `diagnostics-check.mjs` proves the right things get reported. This proves they
// arrive: that `activate` wires up without throwing, that the compiler loads
// from `context.extensionPath` the way it will once installed, that a `# genie:`
// line finds its file, and that the ranges land on the text they blame.
//
// The stub is only the shape of the API -- every judgment still comes from the
// real WebAssembly compiler through the real `extension.js`. Without something
// at this level an extension can be broken on install while every other check in
// the repo stays green, which is a failure this project has already shipped once
// in a different form: a cached web worker that answered every question with
// silence.

import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// --- the stub --------------------------------------------------------------
class Range {
  constructor(sl, sc, el, ec) {
    this.start = { line: sl, character: sc };
    this.end = { line: el, character: ec };
  }
}
class Diagnostic {
  constructor(range, message, severity) {
    Object.assign(this, { range, message, severity });
  }
}
const bags = new Map();
const handlers = { open: [], change: [], save: [], close: [] };
const docs = [];

function doc(fsPath, text, languageId) {
  const lines = text.split('\n');
  return {
    languageId, uri: { fsPath, toString: () => 'file://' + fsPath },
    getText: () => text,
    lineCount: lines.length,
    lineAt: (i) => ({ text: lines[i] ?? '' }),
    positionAt: (index) => {
      let line = 0;
      for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
      return { line };
    },
  };
}

const vscode = {
  Range, Diagnostic,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Uri: { file: (p) => ({ fsPath: p, toString: () => 'file://' + p }) },
  languages: {
    createDiagnosticCollection: () => ({
      set: (uri, list) => bags.set(uri.fsPath, list),
      delete: (uri) => bags.delete(uri.fsPath),
      dispose: () => {},
    }),
  },
  window: { showErrorMessage: (m) => { throw new Error('unexpected: ' + m); } },
  workspace: {
    get textDocuments() { return docs; },
    fs: { readFile: async () => { throw new Error('not on disk'); } },
    onDidOpenTextDocument: (f) => (handlers.open.push(f), { dispose() {} }),
    onDidChangeTextDocument: (f) => (handlers.change.push(f), { dispose() {} }),
    onDidSaveTextDocument: (f) => (handlers.save.push(f), { dispose() {} }),
    onDidCloseTextDocument: (f) => (handlers.close.push(f), { dispose() {} }),
  },
};

const load = Module._load;
Module._load = (request, parent, isMain) =>
  request === 'vscode' ? vscode : load(request, parent, isMain);

// --- the run ---------------------------------------------------------------
const dir = mkdtempSync(path.join(tmpdir(), 'loophole-'));
const wishPath = path.join(dir, 'demo.wish');
const geniePath = path.join(dir, 'strict.genie');

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
  'invariant I1 {',
  '    check wishes <= 3',
  '    label "wishes <= 3"',
  '}',
  '',
  // I2 is the one `humble` breaks. I1 alone would not do: underflowing back to
  // 3 satisfies "wishes <= 3" exactly, which is the joke -- the ceiling held and
  // the thing it was there for did not.
  'invariant I2 {',
  '    check wishes <= max(before(wishes) - toll, 0)',
  '    label "no net gain"',
  '}',
  '',
].join('\n');
writeFileSync(wishPath, WISH);
writeFileSync(geniePath, GENIE);

// The genie is an open buffer, which is the path that matters: an unsaved genie
// must be what judges the wish, or the two panes would disagree on screen.
docs.push(doc(geniePath, GENIE, 'genie'), doc(wishPath, WISH, 'wish'));

let failed = 0;
const check = (name, ok, saw) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) { failed = 1; if (saw !== undefined) console.log(`       saw: ${saw}`); }
};

const { activate } = load(path.join(root, 'src', 'extension.js'), null, false);
const subs = [];
activate({ extensionPath: root, subscriptions: subs });

// `activate` judges asynchronously; the compiler has to instantiate first.
await new Promise((r) => setTimeout(r, 3000));

check('activate registered its listeners', subs.length >= 5, subs.length);
check('every document event is handled',
      handlers.open.length && handlers.change.length &&
      handlers.save.length && handlers.close.length);

const got = bags.get(wishPath);
check('the wish got diagnostics', Array.isArray(got) && got.length === 2,
      JSON.stringify(got));

if (got && got.length === 2) {
  const [refused, exploit] = got;
  check('the refusal is Information', refused.severity === 2, refused.severity);
  check('the refusal names the rule',
        /NoMoreWishes/.test(refused.message), refused.message);
  check('the refusal is drawn on `add wishes, 3` (line index 4)',
        refused.range.start.line === 4, JSON.stringify(refused.range));
  check('and skips the indent',
        refused.range.start.character === 4, refused.range.start.character);
  check('and stops at the end of the code, not the line',
        refused.range.end.character === 17, refused.range.end.character);

  check('the exploit is Information, not an error', exploit.severity === 2,
        exploit.severity);
  check('the exploit is drawn on `wish humble` (line index 7)',
        exploit.range.start.line === 7, JSON.stringify(exploit.range));
  check('the exploit says it broke I2', /broke I2/.test(exploit.message),
        exploit.message);
}

// The genie was read from the open buffer, not from disk -- the stub's
// `workspace.fs.readFile` throws, so reaching disk would have failed loudly.
check('the genie itself has nothing wrong with it',
      (bags.get(geniePath) || []).length === 0,
      JSON.stringify(bags.get(geniePath)));

// Closing a document takes its squiggles with it. Left behind, they would sit in
// the Problems panel forever describing a file nobody has open.
handlers.close.forEach((f) => f(docs[1]));
check('closing the wish clears it', !bags.has(wishPath));

process.exit(failed);
