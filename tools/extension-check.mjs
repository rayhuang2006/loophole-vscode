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

// The bundled compiler's version, read from the bundled compiler. Hard-coding it
// would make this file need editing on every upstream release, and the check
// that matters -- "the binary on the PATH is a different build" -- would then be
// comparing against a number nobody kept current.
const { createRequire } = await import('node:module');
const req = createRequire(import.meta.url);
const compilerVersion = (await req('../wasm/loophole.js')()).versions().split('|')[0];

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
class MarkdownString {
  constructor() { this.value = ''; }
  appendCodeblock(code) { this.value += '```\n' + code + '\n```\n'; return this; }
  appendMarkdown(md) { this.value += md; return this; }
}
class Hover {
  constructor(contents, range) { Object.assign(this, { contents, range }); }
}
class CodeLens {
  constructor(range, command) { Object.assign(this, { range, command }); }
}
class CompletionItem {
  constructor(label, kind) { Object.assign(this, { label, kind }); }
}
class EventEmitter {
  constructor() { this.listeners = []; }
  get event() { return (f) => (this.listeners.push(f), { dispose() {} }); }
  fire(v) { for (const f of this.listeners) f(v); }
  dispose() {}
}

class Task {
  constructor(definition, scope, name, source, execution, matcher) {
    Object.assign(this, { definition, scope, name, source, execution, matcher });
  }
}
class ShellExecution {
  constructor(command, args, options) {
    Object.assign(this, { command, args, options });
  }
}

const bags = new Map();
const handlers = { open: [], change: [], save: [], close: [] };
const docs = [];
// The providers and commands `activate` registers, captured so they can be
// called the way VS Code would call them.
const providers = {};
const commands = new Map();
const terminals = [];
const warnings = [];
const errors = [];
let activeDoc = null;

// The binary on the PATH, faked. Real enough to exercise `installedVersion`,
// controllable enough to run on a machine that has never installed the
// compiler -- which is every CI runner.
const fakeBinary = { version: null };   // null = not installed

function doc(fsPath, text, languageId) {
  const lines = text.split('\n');
  return {
    languageId, uri: { fsPath, toString: () => 'file://' + fsPath },
    getText: (range) => (range ? range._text ?? text : text),
    lineCount: lines.length,
    lineAt: (i) => ({ text: lines[i] ?? '' }),
    positionAt: (index) => {
      let line = 0;
      for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
      return { line };
    },
    // Enough of the real behaviour to hand a word to the hover provider: the
    // identifier surrounding the character position on that line.
    getWordRangeAtPosition: ({ line, character }) => {
      const s = lines[line] ?? '';
      let a = character, b = character;
      const isWord = (c) => /[A-Za-z0-9_]/.test(c ?? '');
      if (!isWord(s[a]) && !isWord(s[a - 1])) return undefined;
      while (a > 0 && isWord(s[a - 1])) a--;
      while (b < s.length && isWord(s[b])) b++;
      const r = new Range(line, a, line, b);
      r._text = s.slice(a, b);
      return r;
    },
  };
}

const vscode = {
  Range, Diagnostic, MarkdownString, Hover, CodeLens, CompletionItem, EventEmitter,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  CompletionItemKind: { Keyword: 13, Function: 2, Constant: 20, Operator: 23,
                        Variable: 5, Reference: 17 },
  Uri: { file: (p) => ({ fsPath: p, toString: () => 'file://' + p }) },
  languages: {
    createDiagnosticCollection: () => ({
      set: (uri, list) => bags.set(uri.fsPath, list),
      delete: (uri) => bags.delete(uri.fsPath),
      dispose: () => {},
    }),
    registerCodeLensProvider: (_s, p) => (providers.lens = p, { dispose() {} }),
    registerHoverProvider: (_s, p) => (providers.hover = p, { dispose() {} }),
    registerCompletionItemProvider: (_s, p) =>
      (providers.completion = p, { dispose() {} }),
  },
  Task, ShellExecution,
  TaskScope: { Workspace: 1 },
  TaskGroup: { Build: 'build' },
  TaskRevealKind: { Always: 1 },
  TaskPanelKind: { Dedicated: 2 },
  commands: {
    registerCommand: (id, fn) => (commands.set(id, fn), { dispose() {} }),
    executeCommand: (id, ...a) => commands.get(id)?.(...a),
  },
  tasks: {
    registerTaskProvider: (_t, p) => (providers.task = p, { dispose() {} }),
  },
  env: {
    clipboard: { writeText: async () => {} },
    openExternal: async () => {},
  },
  window: {
    // Collected, not thrown. The diagnostics section asserts this stays empty;
    // the run section deliberately provokes one.
    showErrorMessage: (m) => { errors.push(m); return Promise.resolve(undefined); },
    showInformationMessage: async () => {},
    showWarningMessage: (m) => { warnings.push(m); return Promise.resolve(undefined); },
    get activeTextEditor() { return activeDoc ? { document: activeDoc } : undefined; },
    createTerminal: (opts) => {
      const t = { ...opts, sent: [], show() {}, dispose() {} };
      t.sendText = (s) => t.sent.push(s);
      terminals.push(t);
      return t;
    },
  },
  workspace: {
    get textDocuments() { return docs; },
    getConfiguration: () => ({ get: (k) => (k === 'path' ? 'loophole' : undefined) }),
    fs: { readFile: async () => { throw new Error('not on disk'); } },
    onDidOpenTextDocument: (f) => (handlers.open.push(f), { dispose() {} }),
    onDidChangeTextDocument: (f) => (handlers.change.push(f), { dispose() {} }),
    onDidSaveTextDocument: (f) => (handlers.save.push(f), { dispose() {} }),
    onDidCloseTextDocument: (f) => (handlers.close.push(f), { dispose() {} }),
  },
};

const child_process = {
  execFileSync: (file, args) => {
    if (fakeBinary.version === null) {
      const e = new Error(`spawnSync ${file} ENOENT`); e.code = 'ENOENT'; throw e;
    }
    if (args?.[0] !== '--version') throw new Error('unexpected: ' + args);
    return `loophole ${fakeBinary.version}  (wish 1.0, genie 1.0)\n`;
  },
};

const load = Module._load;
Module._load = (request, parent, isMain) =>
  request === 'vscode' ? vscode
  : request === 'child_process' ? child_process
  : load(request, parent, isMain);

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

// --- the three providers, called the way VS Code calls them -----------------
// `assist-check.mjs` already checks what they decide. What is only reachable
// here is the wiring: that they were registered at all, that they read the
// judgment `activate` cached rather than judging again, and that the plain data
// coming out of `assist.js` survives being turned into editor objects.
check('a CodeLens provider was registered', !!providers.lens);
check('a hover provider was registered', !!providers.hover);
check('a completion provider was registered', !!providers.completion);

const wishDoc = docs[1];

if (providers.lens) {
  const l = providers.lens.provideCodeLenses(wishDoc);
  check('lenses: one per wish', l?.length === 2, JSON.stringify(l));
  check('lenses: the refusal sits on line index 3 (`wish greedy`)',
        l?.[0]?.range.start.line === 3, JSON.stringify(l?.[0]?.range));
  check('lenses: and reads as a verdict',
        /not granted/.test(l?.[0]?.command.title ?? ''), l?.[0]?.command.title);
  check('lenses: the exploit sits on line index 7 (`wish humble`)',
        l?.[1]?.range.start.line === 7, JSON.stringify(l?.[1]?.range));
  check('lenses: naming what broke',
        l?.[1]?.command.title === 'EXPLOIT · broke I2', l?.[1]?.command.title);
  // A title-only lens: nothing to click, because the detail is one hover away.
  check('lenses: are not clickable', l?.every((x) => x.command.command === ''));
  check('lenses: refresh when a judgment lands', providers.lens.onDidChangeCodeLenses !== undefined);
}

if (providers.hover) {
  // `sub`, on the `sub wishes, 3` line of the wish.
  const h = providers.hover.provideHover(wishDoc, { line: 8, character: 5 });
  check('hover: a reserved word is explained',
        /modulo the register/.test(h?.contents.value ?? ''), h?.contents.value);
  check('hover: with its syntax in a code block',
        /```\nsub <register>, <n>/.test(h?.contents.value ?? ''), h?.contents.value);

  // `wishes`, same line -- a register, so the trail rather than a definition.
  const r = providers.hover.provideHover(wishDoc, { line: 8, character: 10 });
  check('hover: a register shows its width and trail',
        /uint<2>/.test(r?.contents.value ?? '') &&
        /after each wish/.test(r?.contents.value ?? ''), r?.contents.value);

  // Line index 2 is blank. Whitespace is not a word, so there is nothing to say
  // -- and a provider that returned a Hover here would pop an empty tooltip
  // every time the pointer crossed an empty line.
  check('hover: nothing under blank space',
        providers.hover.provideHover(wishDoc, { line: 2, character: 0 }) === null);
}

if (providers.completion) {
  const items = providers.completion.provideCompletionItems(
    wishDoc, { line: 8, character: 8 });   // just after `    sub `
  const labels = items.map((i) => i.label);
  check('completion: after a verb, the register it takes',
        labels.includes('wishes'), labels.join(','));
  check('completion: items carry a kind', items.every((i) => i.kind !== undefined));
}

// --- running ---------------------------------------------------------------
// The task provider builds the command line without a terminal being involved,
// so it can be inspected exactly. What matters here is the `--genie` flag: the
// compiler does not read the `# genie:` comment, so a task that omitted it would
// judge the file against the built-in genie and disagree with the squiggles
// three inches above it.
check('nothing went wrong up to here', errors.length === 0, errors.join(' | '));
check('a run command was registered', commands.has('loophole.run'));
check('a task provider was registered', !!providers.task);

activeDoc = wishDoc;
wishDoc.isDirty = false;
wishDoc.save = async () => {};

// No binary: say so, and do NOT quietly run the bundled WebAssembly instead.
// The two judge identically -- `make wasm-check` proves it every build -- so a
// fallback would not lie about the verdict. It would do something worse: make
// "run" mean a different act on different machines, when the whole point of the
// act is that it is the one everybody else performs.
{
  fakeBinary.version = null;
  errors.length = 0;
  await commands.get('loophole.run')();
  check('no binary: it says so', errors.length === 1, errors.join(' | '));
  check('no binary: and mentions the PATH', /PATH/.test(errors[0] ?? ''), errors[0]);
  check('no binary: and nothing was run', terminals.length === 0, terminals.length);
}

// Matching versions: run, quietly.
{
  fakeBinary.version = compilerVersion;
  errors.length = 0; warnings.length = 0;
  await commands.get('loophole.run')();
  check('matching versions: no warning', warnings.length === 0, warnings.join(' | '));
  check('matching versions: a terminal was opened', terminals.length === 1);
  check('matching versions: and got the command, with --genie',
        terminals[0]?.sent[0] === 'loophole --genie strict.genie demo.wish',
        JSON.stringify(terminals[0]?.sent));
}

// A different build on the PATH from the one drawing the squiggles. Found by
// actually running this feature: the development machine had 1.3.1 installed
// while the package carried 1.14.0, so the editor and the terminal were two
// different compilers and nothing said a word.
{
  fakeBinary.version = '0.0.1';
  warnings.length = 0;
  await commands.get('loophole.run')();
  check('version skew: it warns', warnings.length === 1, warnings.join(' | '));
  check('version skew: naming the installed version',
        /0\.0\.1/.test(warnings[0] ?? ''), warnings[0]);
  check('version skew: and the bundled one',
        warnings[0]?.includes(compilerVersion), warnings[0]);
  check('version skew: but still runs', terminals[0]?.sent.length === 2,
        JSON.stringify(terminals[0]?.sent));

  // Once per session. A warning on every run would train the reader to dismiss
  // it without reading, which is the same as not having it.
  warnings.length = 0;
  await commands.get('loophole.run')();
  check('version skew: warned once, not every time', warnings.length === 0,
        warnings.join(' | '));
}
if (providers.task) {
  const tasks = providers.task.provideTasks();
  check('tasks: one for the active wish', tasks?.length === 1, tasks?.length);
  const t = tasks?.[0];
  check('tasks: it runs the configured executable',
        t?.execution.command === 'loophole', t?.execution.command);
  check('tasks: and passes --genie, because the compiler will not read `# genie:`',
        t?.execution.args.join(' ') === '--genie strict.genie demo.wish',
        JSON.stringify(t?.execution.args));
  check('tasks: with NO_COLOR, so the matcher reads text and not escape codes',
        t?.execution.options?.env?.NO_COLOR === '1',
        JSON.stringify(t?.execution.options?.env));
  check('tasks: wired to the loophole problem matcher', t?.matcher === '$loophole',
        t?.matcher);
  check('tasks: in the build group so ⌘⇧B reaches it', t?.group === 'build', t?.group);

  // A hand-written tasks.json entry must resolve too.
  const resolved = providers.task.resolveTask(
    new Task({ type: 'loophole', file: 'a.wish' }, null, 'x', 'loophole', null, null));
  check('tasks: a hand-written definition resolves',
        resolved?.execution.args.join(' ') === 'a.wish',
        JSON.stringify(resolved?.execution?.args));
  check('tasks: one without a file does not',
        providers.task.resolveTask(
          new Task({ type: 'loophole' }, null, 'x', 'loophole', null, null)) === undefined);
}

// Closing a document takes its squiggles with it. Left behind, they would sit in
// the Problems panel forever describing a file nobody has open.
handlers.close.forEach((f) => f(docs[1]));
check('closing the wish clears it', !bags.has(wishPath));
check('and forgets its judgment', providers.lens
      ? providers.lens.provideCodeLenses(wishDoc).length === 0 : true);

process.exit(failed);
