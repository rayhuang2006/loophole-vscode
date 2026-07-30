// What the editor will underline, checked against the real compiler.
//
// Not a mock. This loads the same WebAssembly build that ships in the `.vsix`
// and feeds `--json` through the same `verdict.js` the extension uses, so the
// only thing not covered is VS Code drawing the range. A fixture of canned JSON
// would pass forever after the compiler changed its output.
//
// Every case below is a property the severity policy claims, and the policy is
// the whole argument of this feature: in this language a broken invariant is the
// goal, so it must never be counted as an error.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const createLoophole = require('../wasm/loophole.js');
const { toDiagnostics } = require('../src/verdict.js');

const M = await createLoophole();

let failed = 0;
const check = (name, ok, saw) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) { failed = 1; if (saw !== undefined) console.log(`       saw: ${saw}`); }
};

const WORLD = 'register wishes : uint<2> = 3\n';
const run = (wish, genie = '') => {
  const r = M.judge(wish, genie, false, false, 0, 0);
  let json = null;
  try { json = JSON.parse(r.json); } catch { /* as the extension does */ }
  return { code: r.code, diags: toDiagnostics(json) };
};

// 1. A file that cannot be parsed is the one real error, and it points at the
//    character the compiler named -- not at line 1, not at the whole file.
{
  const { diags } = run(WORLD + 'wish x { sub wishes, 1; }\n');
  check('unparseable: exactly one diagnostic', diags.length === 1, diags.length);
  const d = diags[0];
  check('unparseable: severity error', d?.severity === 'error', d?.severity);
  check('unparseable: line 2', d?.line === 2, d?.line);
  check('unparseable: column 23', d?.column === 23, d?.column);
  check('unparseable: carries the help text', /help:/.test(d?.message ?? ''), d?.message);
}

// 2. An exploit is reported, at the wish, and never as an error. This is the
//    inversion the whole feature rests on.
{
  const { code, diags } = run(WORLD + 'wish humble { sub wishes, 3 }\n');
  check('exploit: compiler agrees it is one', code === 1, code);
  check('exploit: one diagnostic', diags.length === 1, diags.length);
  check('exploit: NOT an error', diags[0]?.severity === 'info', diags[0]?.severity);
  check('exploit: on the wish line', diags[0]?.line === 2, diags[0]?.line);
  check('exploit: names what broke', /broke I2/.test(diags[0]?.message ?? ''),
        diags[0]?.message);
  check('exploit: quotes the invariant', /no net gain/.test(diags[0]?.message ?? ''),
        diags[0]?.message);
}

// 3. A wish with an empty body still has somewhere to put the verdict. Four
//    empty wishes underflow the toll without asking for anything, so this is a
//    real exploit with no statement to blame -- the case that made the compiler
//    grow a `line` on the wish itself.
{
  const { diags } = run(WORLD + 'wish w1 { }\nwish w2 { }\nwish w3 { }\nwish w4 { }\n');
  check('empty wishes: the fourth is the exploit', diags.length === 1, diags.length);
  check('empty wishes: placed on wish w4 (line 5)', diags[0]?.line === 5, diags[0]?.line);
}

// 4. A refusal is not a problem with your file. The rules worked.
{
  const { code, diags } = run(WORLD + 'wish greedy { add wishes, 3 }\n');
  check('refused: compiler judged it clean', code === 0, code);
  check('refused: NOT an error', diags[0]?.severity === 'info', diags[0]?.severity);
  check('refused: coded with the rule that refused', diags[0]?.code === 'R1',
        diags[0]?.code);
  check('refused: points at the statement, not the wish',
        diags[0]?.line === 2, diags[0]?.line);
}

// 5. A clean wish is silent. An editor that annotated every line would make the
//    ones that matter invisible.
{
  const { diags } = run(WORLD + 'wish shelf { widen wishes -> uint<64> }\n');
  check('clean: nothing to say', diags.length === 0, JSON.stringify(diags));
}

// 6. An error in the genie is blamed on the genie. Without this the wish gets
//    underlined at the genie's line number -- pointing confidently at code that
//    is fine, which is worse than reporting nothing.
{
  const { diags } = run(WORLD + 'wish humble { sub wishes, 3 }\n',
                        'counter wishes\ntoll 1\nrule ???\n');
  check('genie error: blamed on the genie', diags[0]?.file === 'genie',
        `${diags[0]?.file} ${diags[0]?.message}`);
  check('genie error: severity error', diags[0]?.severity === 'error', diags[0]?.severity);
}

// 7. `fooled` and `violated` are different words in the report because they are
//    different failures: violated means the genie's formula came out false,
//    fooled means it still holds and the thing it protected is gone. An editor
//    that flattened them would erase the point of the two-column design.
{
  const genie = M.defaultGenie();
  const { diags } = run(
    'register wishes : uint<2> = 3\n' +
    'attribute breathing : bool = true\n' +
    'people alice\n' +
    'wish sleep { set alice.breathing, false }\n', genie);
  const msg = diags.map((d) => d.message).join('\n');
  check('a judgment with people still produces a placed diagnostic',
        diags.every((d) => d.line > 0), JSON.stringify(diags));
  if (/FOOLED/.test(msg)) check('fooled says "fooled", not "broke"',
                               /fooled I/.test(msg), msg);
}

// 8. A genie checked on its own, the same path `judgeGenie` takes -- `checkGenie`
//    through the same `verdict.js`. A well-formed genie says nothing; a malformed
//    one is the one real error, placed where the compiler pointed. This is the
//    silent case the whole `--check-genie` change was for.
const checkG = (genie) => {
  const r = M.checkGenie(genie);
  let json = null;
  try { json = JSON.parse(r.json); } catch { /* as the extension does */ }
  return { code: r.code, diags: toDiagnostics(json) };
};
{
  const ok = checkG(M.defaultGenie());
  check('genie check: a good genie exits 0', ok.code === 0, ok.code);
  check('genie check: and has nothing to underline', ok.diags.length === 0,
        JSON.stringify(ok.diags));

  const bad = checkG('counter wishes\ntoll 1\nrule R\n  layer ast\n');
  check('genie check: a broken genie exits 2', bad.code === 2, bad.code);
  check('genie check: exactly one diagnostic', bad.diags.length === 1, bad.diags.length);
  check('genie check: it is an error', bad.diags[0]?.severity === 'error',
        bad.diags[0]?.severity);
  check('genie check: on the line the brace was missing from',
        bad.diags[0]?.line === 4, bad.diags[0]?.line);
}

process.exit(failed);
