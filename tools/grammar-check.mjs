// Does the grammar actually colour the language?
//
// Two different questions get confused here, and only the second one matters:
//
//   1. is the JSON well-formed?          -- trivial, and not what breaks
//   2. does VS Code tokenise as intended? -- the real question
//
// So this runs `vscode-textmate` and `vscode-oniguruma`, which is the tokeniser
// VS Code itself uses. A grammar can be perfectly valid JSON and still leave
// every keyword uncoloured, or -- worse and much easier to do -- colour `in`
// inside `invariant`.
//
// The word list is not repeated here: every keyword in `keywords.json` must come
// out scoped as something other than plain source, so a word the compiler
// reserves and the grammar forgets is a failure with no fixture to update.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Both packages are CommonJS, and an ESM namespace import of a CommonJS module
// does not expose its functions -- `oniguruma.loadWASM` comes back undefined.
const require = createRequire(import.meta.url);
const oniguruma = require('vscode-oniguruma');
const vsctm = require('vscode-textmate');
const here = new URL('.', import.meta.url).pathname;
const KW = JSON.parse(readFileSync(here + 'keywords.json', 'utf8'));

const wasmBin = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
await oniguruma.loadWASM(wasmBin);

const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (s) => new oniguruma.OnigScanner(s),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }),
  loadGrammar: async (scope) => {
    const file = { 'source.wish': 'wish', 'source.genie': 'genie' }[scope];
    if (!file) return null;
    return vsctm.parseRawGrammar(
      readFileSync(here + `../syntaxes/${file}.tmLanguage.json`, 'utf8'),
      `${file}.tmLanguage.json`);
  },
});

let rc = 0;
const fail = (m) => { console.log('FAIL ' + m); console.log('::error::' + m); rc = 1; };

// Tokenise a source and return, for each line, [text, scopes] pairs.
async function tokenise(scope, src) {
  const grammar = await registry.loadGrammar(scope);
  let ruleStack = vsctm.INITIAL;
  const out = [];
  for (const line of src.split('\n')) {
    const r = grammar.tokenizeLine(line, ruleStack);
    ruleStack = r.ruleStack;
    for (const t of r.tokens)
      out.push([line.substring(t.startIndex, t.endIndex), t.scopes]);
  }
  return out;
}

// The scope of the first token whose text is exactly `word`. Exact match on
// purpose: a keyword must be its own token, and a helper that matched substrings
// would pass on the very thing test 2 is looking for.
const scopeOf = (toks, word) => {
  const t = toks.find(([txt]) => txt === word);
  return t ? t[1] : null;
};
const isPlain = (scopes) => !scopes || scopes.length <= 1;

// Whether ANY token carries a scope starting with `want`. Needed for spans the
// tokeniser splits: a comment comes back as `#` plus its text, so asking for a
// token equal to "# hello" would never find one.
const hasScope = (toks, want) =>
  toks.some(([, sc]) => sc.some((x) => x.startsWith(want)));

// ── 1. every reserved word must be coloured ──────────────────────────
// Each word is put in a context where it is legal, so the test is about the
// grammar and not about whether a snippet happens to parse.
const WISH_SRC = `# a comment
register wishes : uint<2> = 3
attribute heartbeat : uint<4> = 15
people alice, rival
wish w {
    define alias := sub
    sub wishes, 3
    add wishes, 1
    widen wishes -> uint<64>
    set alice.heartbeat, 0
    kill rival
    revive rival
    promise not granted(self) and alive(alice) or true
    promise false implies granted(w)
}
`;
const GENIE_SRC = `# a comment
counter wishes
toll 1
concept dead(p) := p.heartbeat == 0 and p.brainwave == 0
rule R {
    layer surface
    forbid sub, add, widen, set, kill, revive
    because "no"
}
rule S { layer ast  forbid add on wishes }
invariant I {
    label "x"
    written  all p in people: not dead(p)
    real     max(before(wishes) - toll, 0) >= 0
}
invariant A { check consistent }
`;

const wishToks  = await tokenise('source.wish',  WISH_SRC);
const genieToks = await tokenise('source.genie', GENIE_SRC);

for (const w of [...KW.wish, ...KW.operations, 'granted', 'alive', 'self',
                 'true', 'false', 'not', 'and', 'or', 'implies']) {
  const s = scopeOf(wishToks, w);
  if (s === null)       fail(`wish grammar: '${w}' produced no token — either the grammar does not know it, or WISH_SRC never uses it`);
  else if (isPlain(s))  fail(`wish grammar: '${w}' is not coloured`);
}
for (const w of [...KW.genie, ...KW.layers, ...KW.operations,
                 'all', 'in', 'max', 'before', 'consistent', 'not', 'and']) {
  const s = scopeOf(genieToks, w);
  if (s === null)       fail(`genie grammar: '${w}' produced no token — either the grammar does not know it, or GENIE_SRC never uses it`);
  else if (isPlain(s))  fail(`genie grammar: '${w}' is not coloured`);
}
if (rc === 0) console.log('ok   every reserved word is scoped');

// ── 2. a keyword must not be found inside a longer word ──────────────
// `in` inside `invariant`, `real` inside `really`, `or` inside `word`. This is
// the classic way a generated alternation goes wrong, and it looks fine until
// somebody names a register `format`.
const TRAPS = [
  ['source.wish',  'register invariant : uint<8> = 1',        'invariant'],
  ['source.wish',  'register format : uint<8> = 1',           'format'],
  ['source.wish',  'register android : uint<8> = 1',          'android'],
  ['source.genie', 'concept really(p) := p.x == 0',           'really'],
  ['source.genie', 'concept information(p) := p.x == 0',      'information'],
];
for (const [scope, src, word] of TRAPS) {
  const toks = await tokenise(scope, src);
  const s = scopeOf(toks, word);
  if (s === null)
    fail(`${scope}: '${word}' was split into pieces — a keyword matched inside it`);
  else if (!isPlain(s) && !s.some((x) => x.includes('variable') || x.includes('entity')))
    fail(`${scope}: '${word}' was coloured as ${s[s.length - 1]} — a keyword matched inside it`);
}
if (rc === 0) console.log('ok   no keyword matches inside a longer identifier');

// ── 3. the things a reader actually looks at ─────────────────────────
// A comment is a span, not a word, so it is checked by scope rather than text.
for (const [scope, src] of [['source.wish', '# hello'], ['source.genie', '# hi']]) {
  if (!hasScope(await tokenise(scope, src), 'comment'))
    fail(`${scope}: a '#' line is not a comment`);
}

const CHECKS = [
  ['source.wish',  'register w : uint<2> = 3',     '2',        'constant.numeric.width'],
  ['source.wish',  'wish experiment { }',          'experiment', 'entity.name.function'],
  ['source.wish',  'define mercy := kill',         'mercy',    'support.function.alias'],
  ['source.genie', 'because "that word"',          '"',        'string'],
  ['source.genie', 'rule NoKilling { }',           'NoKilling','entity.name.type'],
  ['source.genie', 'layer surface',                'surface',  'constant.language.layer'],
  ['source.genie', 'written all p in people: x',   'written',  'keyword.control.column'],
];
for (const [scope, src, word, want] of CHECKS) {
  const toks = await tokenise(scope, src);
  const s = scopeOf(toks, word);
  if (!s || !s.some((x) => x.startsWith(want)))
    fail(`${scope}: '${word}' should be ${want}, got ${s ? s[s.length - 1] : 'nothing'}`);
}
if (rc === 0) console.log('ok   comments, strings, names and widths are scoped as intended');

process.exit(rc);
