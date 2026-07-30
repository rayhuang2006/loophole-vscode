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
//
// Each file owns its own gutter. A `.genie` is checked on its own (`checkGenie`)
// and carries its own syntax errors. A `.wish` is judged, and when the genie it
// names cannot be read, the wish says so on its own `# genie:` line -- it never
// draws that error on the genie's behalf. Two files, two owners, no fighting
// over one line.

const vscode = require('vscode');
const path = require('path');
const { toDiagnostics, GENIE } = require('./verdict.js');
const assist = require('./assist.js');

/** Milliseconds of quiet before a keystroke turns into a judgment. */
const SETTLE = 250;

/** The compiler module, loaded once, lazily, and only if a file needs it. */
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
// means to `judge` -- and the built-in genie always parses, so a wish using it
// can never see a genie error.
// ---------------------------------------------------------------------------
const GENIE_LINE = /^[ \t]*#[ \t]*genie:[ \t]*(\S+)/m;

const openDoc = (fsPath) =>
  vscode.workspace.textDocuments.find((d) => d.uri.fsPath === fsPath);

async function genieFor(doc) {
  const text = doc.getText();
  const m = GENIE_LINE.exec(text);
  if (!m) return { text: '', uri: null };

  const directiveLine = doc.positionAt(m.index).line;
  const fsPath = path.resolve(path.dirname(doc.uri.fsPath), m[1]);
  // An open editor's unsaved buffer beats what is on disk. Editing a genie
  // should move the squiggles in the wish immediately -- reading the saved file
  // instead would leave the two panes disagreeing about the same moment.
  const open = openDoc(fsPath);
  if (open) return { text: open.getText(), uri: open.uri, directiveLine };
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
    return {
      text: Buffer.from(bytes).toString('utf8'),
      uri: vscode.Uri.file(fsPath), directiveLine,
    };
  } catch {
    return { missing: m[1], directiveLine };
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

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

function toVsDiagnostic(doc, d) {
  const v = new vscode.Diagnostic(
    rangeOf(doc, d), d.message, SEVERITY[d.severity] ?? SEVERITY.info);
  v.source = 'loophole';
  if (d.code) v.code = d.code;
  return v;
}

function activate(context) {
  const bag = vscode.languages.createDiagnosticCollection('loophole');
  context.subscriptions.push(bag);

  const timers = new Map();
  // Which genie each wish was judged by, so editing a genie re-judges the
  // wishes that actually depend on it rather than every open file.
  const dependsOn = new Map();
  // The last judgment of each document. Lenses, hovers and completions all
  // read this instead of judging again: three views of one verdict cannot
  // disagree with each other, and a hover is not a reason to run the compiler.
  const judged = new Map();
  // `--keywords` from the bundled compiler, so a hover shows the compiler's own
  // sentence. Read from the wasm rather than from `tools/keywords.json`, which
  // is a build input and is not shipped inside the package.
  let keywords = null;
  let announcedFailure = false;

  const lensChanged = new vscode.EventEmitter();
  context.subscriptions.push(lensChanged);

  async function loadOrWarn() {
    try {
      const M = await load(context);
      if (!keywords) {
        // Defensive: a package whose wasm predates 1.13.0 has `keywords()` but
        // no `docs` in it. Hover then finds nothing for a reserved word, which
        // is the correct degradation -- it must not take the extension down.
        try { keywords = JSON.parse(M.keywords()); }
        catch (e) { console.error('loophole: could not read --keywords', e); }
      }
      return M;
    } catch (err) {
      // Once, not once per keystroke. And loudly: silence here would look
      // exactly like a clean file, which is the worst possible lie to tell.
      console.error('loophole: could not load the compiler', err);
      if (!announcedFailure) {
        announcedFailure = true;
        vscode.window.showErrorMessage(
          'Loophole: the compiler failed to load, so diagnostics are off.');
      }
      return null;
    }
  }

  function judge(doc) {
    if (doc.languageId === 'genie') return judgeGenie(doc);
    if (doc.languageId === 'wish') return judgeWish(doc);
  }

  // A genie on its own. No wish is involved, so this is a syntax check and only
  // that -- exactly what the compiler's `--check-genie` reports. Its whole
  // reason to exist: a genie a person is still writing, that no wish has run yet,
  // used to be able to hold a plain syntax error in silence.
  async function judgeGenie(doc) {
    const M = await loadOrWarn();
    if (!M) return;

    let r;
    try { r = M.checkGenie(doc.getText()); }
    catch (err) { console.error('loophole: checkGenie threw', err); return; }

    let json = null;
    try { json = JSON.parse(r.json); } catch { /* nothing to report */ }

    // `checkGenie` answers with either an `error` object or an `ok` object;
    // `toDiagnostics` turns the first into one entry and the second into none.
    bag.set(doc.uri, toDiagnostics(json).map((d) => toVsDiagnostic(doc, d)));
    // No wishes were judged, so there is nothing for a lens to say. Recorded
    // anyway, so a hover in a genie still gets the keyword docs.
    judged.set(doc.uri.toString(), null);
  }

  async function judgeWish(doc) {
    const M = await loadOrWarn();
    if (!M) return;

    const genie = await genieFor(doc);
    dependsOn.set(doc.uri.toString(), genie.uri ? genie.uri.fsPath : null);

    if (genie.missing) {
      bag.set(doc.uri, [toVsDiagnostic(doc, {
        line: genie.directiveLine + 1, column: 1, span: 'line',
        message: `no such genie: ${genie.missing}`, severity: 'error',
        code: 'no-genie',
      })]);
      setJudgment(doc, null);
      return;
    }

    let r;
    try { r = M.judge(doc.getText(), genie.text, false, false, 0, 0); }
    catch (err) { console.error('loophole: judge threw', err); return; }

    let json = null;
    try { json = JSON.parse(r.json); } catch { /* nothing to report */ }

    const diags = [];
    for (const d of toDiagnostics(json)) {
      if (d.file === GENIE) {
        // The genie could not be read, so nothing could be judged. Point at this
        // wish's `# genie:` line -- not at its code, which is fine -- and leave
        // the precise error to the genie's own file, which shows it if open.
        diags.push(toVsDiagnostic(doc, {
          line: (genie.directiveLine ?? 0) + 1, column: 1, span: 'line',
          message: `cannot judge: the genie has an error (line ${d.line})`,
          severity: 'warning', code: 'genie-error',
        }));
        continue;
      }
      diags.push(toVsDiagnostic(doc, d));
    }
    bag.set(doc.uri, diags);
    setJudgment(doc, json);
  }

  /** Keep the judgment the other three features read, and refresh the lenses. */
  function setJudgment(doc, json) {
    judged.set(doc.uri.toString(), json);
    lensChanged.fire();
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

  // ---- the three read-only views of that judgment -------------------------
  const BOTH = [{ language: 'wish' }, { language: 'genie' }];

  context.subscriptions.push(vscode.languages.registerCodeLensProvider(
    { language: 'wish' }, {
      onDidChangeCodeLenses: lensChanged.event,
      provideCodeLenses(doc) {
        const json = judged.get(doc.uri.toString());
        return assist.lenses(json).map((l) => {
          const line = Math.max(0, Math.min(l.line - 1, doc.lineCount - 1));
          // A title-only lens: `command` is empty, so VS Code renders the text
          // and makes nothing clickable. There is nowhere useful to go -- the
          // detail is already one hover away.
          return new vscode.CodeLens(new vscode.Range(line, 0, line, 0),
                                     { title: l.title, command: '' });
        });
      },
    }));

  context.subscriptions.push(vscode.languages.registerHoverProvider(BOTH, {
    provideHover(doc, position) {
      const range = doc.getWordRangeAtPosition(position);
      if (!range) return null;
      const h = assist.hover({
        word: doc.getText(range), text: doc.getText(),
        keywords, json: judged.get(doc.uri.toString()) ?? null,
      });
      if (!h) return null;

      const md = new vscode.MarkdownString();
      if (h.kind === 'word') {
        md.appendCodeblock(h.syntax, doc.languageId);
        md.appendMarkdown(h.text);
      } else if (h.kind === 'wish') {
        md.appendMarkdown(h.body);
      } else {
        const w = h.width ? ` \`uint<${h.width}>\`` : '';
        md.appendMarkdown(`**${h.word}**${w}\n\n`);
        md.appendMarkdown(`after each wish: \`${h.trail.join(' → ')}\``);
      }
      return new vscode.Hover(md, range);
    },
  }));

  const COMPLETION_KIND = {
    keyword:   vscode.CompletionItemKind.Keyword,
    operation: vscode.CompletionItemKind.Function,
    constant:  vscode.CompletionItemKind.Constant,
    function:  vscode.CompletionItemKind.Operator,
    variable:  vscode.CompletionItemKind.Variable,
    alias:     vscode.CompletionItemKind.Reference,
  };

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
    BOTH, {
      provideCompletionItems(doc, position) {
        const linePrefix = doc.lineAt(position.line).text.slice(0, position.character);
        return assist.completions({
          linePrefix, languageId: doc.languageId, keywords,
          text: doc.getText(), json: judged.get(doc.uri.toString()) ?? null,
        }).map((c) => {
          const item = new vscode.CompletionItem(
            c.label, COMPLETION_KIND[c.kind] ?? COMPLETION_KIND.keyword);
          if (c.detail) item.detail = c.detail;
          if (c.doc) item.documentation = new vscode.MarkdownString(c.doc);
          return item;
        });
      },
    }));

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => judge(d)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'wish') schedule(e.document);
      else if (e.document.languageId === 'genie') {
        schedule(e.document);              // its own syntax
        scheduleDependants(e.document);    // the wishes that use it
      }
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
      judged.delete(d.uri.toString());
    }),
  );

  for (const d of vscode.workspace.textDocuments) judge(d);
}

function deactivate() {}

module.exports = { activate, deactivate };
