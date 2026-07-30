// Generate the two TextMate grammars from the compiler's own keyword list.
//
// Nothing here decides WHICH words are reserved -- `loophole --keywords` does,
// and `keywords.json` beside this file is its output, fetched from a release.
// What this file decides is which TextMate scope each group of words gets, and
// that is deliberately the plugin's business rather than the compiler's: an
// editor's colour vocabulary is not something a language should know about, and
// putting it in the compiler would make every new editor a change over there.
//
// The grammars are committed, because that is what the editor loads. CI runs
// this and fails if the result differs from what was committed -- so a keyword
// added to the language cannot silently stop being coloured, which is the exact
// failure this whole arrangement exists to prevent.

import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const KW = JSON.parse(readFileSync(here + 'keywords.json', 'utf8'));

// Longest first. This is NOT what stops `in` matching inside `invariant` --
// the `\b` boundaries on every keyword pattern do that, and removing this sort
// leaves the tests green. It matters only if a pattern is ever written without
// boundaries, which the operator list below is: `<=` has to be tried before `<`.
const alt = (words) =>
  [...words].sort((a, b) => b.length - a.length).join('|');

// ── shared patterns ─────────────────────────────────────────────────
// A comment runs to end of line; a string cannot span one (spec §3).
const comment = (lang) => ({
  name: `comment.line.number-sign.${lang}`,
  begin: '#', end: '$',
});
const string = (lang) => ({
  name: `string.quoted.double.${lang}`,
  begin: '"', end: '"',
  patterns: [{ name: `constant.character.escape.${lang}`, match: '\\\\.' }],
});
const number = (lang) => ({
  name: `constant.numeric.integer.${lang}`,
  match: '\\b\\d+\\b',
});
// `uint<N>` is one idea, so it is one match with the width picked out: the
// width is the whole joke, and a reader scanning for it should find it lit.
const type = (lang) => ({
  match: '\\b(uint)\\s*(<)\\s*(\\d+)\\s*(>)',
  captures: {
    1: { name: `storage.type.${lang}` },
    2: { name: `punctuation.definition.type.begin.${lang}` },
    3: { name: `constant.numeric.width.${lang}` },
    4: { name: `punctuation.definition.type.end.${lang}` },
  },
});
const operators = (lang) => ({
  name: `keyword.operator.${lang}`,
  match: ':=|->|==|!=|<=|>=|[<>=+\\-]',
});
const logic = (lang) => ({
  name: `keyword.operator.logical.${lang}`,
  match: `\\b(?:${alt(['not', 'and', 'or', 'implies'])})\\b`,
});

// ── wish ────────────────────────────────────────────────────────────
const wish = {
  $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
  name: 'Wish',
  scopeName: 'source.wish',
  patterns: [
    { include: '#comment' }, { include: '#string' },
    // A declaration or a wish head, with the name it introduces. Matched
    // before the bare-keyword rule so the name gets its own scope.
    {
      match: `\\b(${alt(['register', 'attribute'])})\\s+([A-Za-z_][\\w]*)`,
      captures: {
        1: { name: 'keyword.control.declaration.wish' },
        2: { name: 'variable.other.register.wish' },
      },
    },
    {
      match: '\\b(wish)\\s+([A-Za-z_][\\w]*)',
      captures: {
        1: { name: 'keyword.control.wish.wish' },
        2: { name: 'entity.name.function.wish' },
      },
    },
    // `define name := target` -- the name becomes a verb, so it is scoped like
    // one. This is the aliasing axis, and an editor showing the alias in the
    // same colour as a real operation is telling the truth about it.
    {
      match: '\\b(define)\\s+([A-Za-z_\\u4e00-\\u9fff][\\w\\u4e00-\\u9fff]*)',
      captures: {
        1: { name: 'keyword.control.define.wish' },
        2: { name: 'support.function.alias.wish' },
      },
    },
    { include: '#type' },
    {
      name: 'keyword.control.wish',
      match: `\\b(?:${alt(KW.wish.filter((w) => w !== 'uint'))})\\b`,
    },
    { name: 'support.function.operation.wish', match: `\\b(?:${alt(KW.operations)})\\b` },
    { name: 'support.function.builtin.wish', match: `\\b(?:${alt(['granted', 'alive'])})\\b` },
    { name: 'constant.language.wish', match: `\\b(?:${alt(['self', 'true', 'false'])})\\b` },
    { include: '#logic' },
    { include: '#number' }, { include: '#operators' },
  ],
  repository: {
    comment: comment('wish'), string: string('wish'), number: number('wish'),
    type: type('wish'), operators: operators('wish'), logic: logic('wish'),
  },
};

// ── genie ───────────────────────────────────────────────────────────
const genie = {
  $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
  name: 'Genie',
  scopeName: 'source.genie',
  patterns: [
    { include: '#comment' }, { include: '#string' },
    // A rule, invariant or concept and the name it declares.
    {
      match: `\\b(${alt(['rule', 'invariant', 'concept'])})\\s+([A-Za-z_][\\w]*)`,
      captures: {
        1: { name: 'keyword.control.declaration.genie' },
        2: { name: 'entity.name.type.genie' },
      },
    },
    // `layer surface` / `layer ast`. The layer name is the whole aliasing
    // distinction in one word, so it is lit as a language constant rather than
    // left as a bare identifier.
    {
      match: `\\b(layer)\\s+(${alt(KW.layers)})\\b`,
      captures: {
        1: { name: 'keyword.other.genie' },
        2: { name: 'constant.language.layer.genie' },
      },
    },
    { include: '#type' },
    {
      name: 'keyword.control.genie',
      match: `\\b(?:${alt(['counter', 'toll', 'rule', 'invariant', 'concept'])})\\b`,
    },
    {
      name: 'keyword.other.genie',
      match: `\\b(?:${alt(['layer', 'forbid', 'on', 'because', 'check', 'label'])})\\b`,
    },
    // `written` and `real` are the two columns -- the heart of the language.
    // They get their own scope so a theme can make the pair stand out.
    { name: 'keyword.control.column.genie', match: `\\b(?:${alt(['written', 'real'])})\\b` },
    { name: 'support.function.operation.genie', match: `\\b(?:${alt(KW.operations)})\\b` },
    {
      name: 'support.function.builtin.genie',
      match: `\\b(?:${alt(['all', 'in', 'max', 'before', 'alive', 'granted', 'consistent'])})\\b`,
    },
    { name: 'constant.language.genie', match: `\\b(?:${alt(['self', 'true', 'false'])})\\b` },
    { include: '#logic' },
    { include: '#number' }, { include: '#operators' },
  ],
  repository: {
    comment: comment('genie'), string: string('genie'), number: number('genie'),
    type: type('genie'), operators: operators('genie'), logic: logic('genie'),
  },
};

const banner = (lang) =>
  `\n  GENERATED by tools/gen-grammars.mjs from tools/keywords.json.\n` +
  `  Do not edit: run \`npm run gen\`. The word list comes from\n` +
  `  \`loophole --keywords\` (${lang} language ${KW.languages[lang]}), so adding a\n` +
  `  keyword to the language cannot leave this file behind.\n`;

for (const [name, g, lang] of [['wish', wish, 'wish'], ['genie', genie, 'genie']]) {
  const out = { _generated: banner(lang), ...g };
  writeFileSync(here + `../syntaxes/${name}.tmLanguage.json`,
                JSON.stringify(out, null, 2) + '\n');
  console.log(`  syntaxes/${name}.tmLanguage.json  ${g.patterns.length} rules`);
}
