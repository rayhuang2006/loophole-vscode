// Formatting, against the real compiler.
//
// The formatter itself lives upstream (`loophole --format`, and `format()` in
// the bundled build), and upstream checks its two properties -- idempotence and
// that a formatted file judges exactly as the original did. What is checked here
// is the editor's side of it, which is small but has one decision in it worth
// pinning: **a file that does not parse is left exactly as it is.**
//
// Reformatting a half-written file would mean guessing at what the author was
// about to type, and an editor that reshuffles your code the moment you save it
// mid-thought is worse than one that does nothing.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const createLoophole = require('../wasm/loophole.js');

const M = await createLoophole();

let failed = 0;
const check = (name, ok, saw) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) { failed = 1; if (saw !== undefined) console.log(`       saw: ${saw}`); }
};

// The three shapes that were chosen, exercised on one file that violates all of
// them. Asserted as properties of the output rather than as one exact string, so
// the taste can be revisited without rewriting this file -- what must not change
// is that there IS one canonical answer.
{
  const messy = [
    '# a header',
    '',
    'register wishes : uint<2> = 3',
    'attribute breathing : uint<4> = 15',
    'people alice',
    'wish   tidy {   define mercy := kill',
    '   mercy alice   # why',
    ' }',
    '',
  ].join('\n');
  const out = M.format(messy, false);
  const lines = out.split('\n');

  check('the header comment survives', lines[0] === '# a header', lines[0]);
  check('and keeps the blank line the author put after it', lines[1] === '',
        JSON.stringify(lines[1]));

  const decls = lines.filter((l) => /^(register|attribute|people)/.test(l));
  const colons = decls.filter((l) => l.includes(':')).map((l) => l.indexOf(':'));
  check('declarations align their colons', new Set(colons).size === 1,
        JSON.stringify(decls));

  check('a one-line body is expanded',
        lines.includes('wish tidy {') && lines.includes('    define mercy := kill'),
        JSON.stringify(lines));
  check('and the closing brace is un-indented', lines.includes('}'),
        JSON.stringify(lines));
  check('the trailing comment stays with its statement',
        lines.some((l) => /^ {4}mercy alice\s+# why$/.test(l)),
        JSON.stringify(lines.filter((l) => l.includes('#'))));

  check('formatting is idempotent', M.format(out, false) === out);
}

// The decision this file exists for.
{
  const broken = 'register wishes : uint<2> = 3\nwish x { sub wishes, 1; }\n';
  check('a file that does not parse formats to nothing',
        M.format(broken, false) === '', JSON.stringify(M.format(broken, false)));
  const halfTyped = 'register wishes : uint<2> = 3\nwish x {\n    sub wish';
  check('and so does one that is merely half-typed',
        M.format(halfTyped, false) === '', JSON.stringify(M.format(halfTyped, false)));
}

// A trailing comment on a line the wish header shared with its first statement
// belongs to the statement. It used to be emitted on both, which neither
// idempotence nor verdict-preservation could see -- upstream 1.16.2.
{
  const shared = 'register wishes : uint<2> = 3\nwish w {  sub wishes, 3   # why\n }\n';
  const out = M.format(shared, false);
  const withComment = out.split('\n').filter((l) => l.includes('#'));
  check('a shared-line comment appears exactly once',
        withComment.length === 1, JSON.stringify(withComment));
  check('and stays with its statement',
        /sub wishes/.test(withComment[0] ?? ''), withComment[0]);
}

// A genie goes through the same entry with the other flag. Getting the flag
// backwards would format a genie as a wish, which cannot parse -- so it would
// silently do nothing, forever, and look exactly like "already formatted".
{
  const g = M.format(M.defaultGenie(), true);
  check('a genie formats', g.startsWith('counter wishes'), JSON.stringify(g.slice(0, 30)));
  check('a genie formatted as a wish gets nothing',
        M.format(M.defaultGenie(), false) === '');
  check('a wish formatted as a genie gets nothing',
        M.format('register wishes : uint<2> = 3\n', true) === '');
}

process.exit(failed);
