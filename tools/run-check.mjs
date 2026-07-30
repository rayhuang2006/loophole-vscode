// The command line, and the problem matcher that reads what comes back.
//
// Two things here that nothing else can catch.
//
// **The `--genie` flag is not optional.** The compiler does not read the
// `# genie:` comment -- that is a convention of `make run` and of this
// extension, not of the language. A wish naming `mortal.genie` and run as bare
// `loophole w.wish` reports `broke I3` under the built-in genie and `broke Life`
// under the one it asked for. Forget the flag and pressing Run contradicts the
// squiggles in the same window.
//
// **The problem matcher is a regex against prose.** §10.1 says the prose report
// may be reworded freely, which makes this the one place in the extension that
// is *allowed* to read it -- a terminal emits text and there is nothing else to
// parse. So it is checked against output the real compiler produced just now,
// never against a fixture, because a fixture would keep passing after the
// diagnostics were reformatted and the Problems panel had quietly gone empty.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const createLoophole = require('../wasm/loophole.js');
const { commandFor, argsFor, genieNameIn, quote } = require('../src/run.js');

const M = await createLoophole();
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

let failed = 0;
const check = (name, ok, saw) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) { failed = 1; if (saw !== undefined) console.log(`       saw: ${saw}`); }
};

// --- the command line ------------------------------------------------------
{
  check('a bare wish runs bare',
        commandFor({ file: 'w.wish' }) === 'loophole w.wish',
        commandFor({ file: 'w.wish' }));

  check('a named genie becomes --genie',
        commandFor({ file: 'w.wish', genie: 'mortal.genie' }) ===
        'loophole --genie mortal.genie w.wish',
        commandFor({ file: 'w.wish', genie: 'mortal.genie' }));

  check('the configured executable is used',
        commandFor({ exe: '/opt/lh/loophole', file: 'w.wish' }) ===
        '/opt/lh/loophole w.wish');

  // A path with a space, or a quote, must survive being typed into a shell.
  check('spaces are quoted',
        commandFor({ file: 'my wish.wish' }) === "loophole 'my wish.wish'",
        commandFor({ file: 'my wish.wish' }));
  check('single quotes are escaped',
        quote("it's.wish") === `'it'\\''s.wish'`, quote("it's.wish"));

  check('`# genie:` is found', genieNameIn('# genie: a.genie\nregister x : uint<2> = 1\n')
        === 'a.genie');
  check('and absent when not written', genieNameIn('register x : uint<2> = 1\n') === null);
  // A `# genie:` inside a wish body is still a comment, and the compiler's own
  // examples put the line at the top; taking the first match keeps one answer.
  check('the first one wins',
        genieNameIn('# genie: a.genie\n# genie: b.genie\n') === 'a.genie');

  check('argsFor puts the file last, where the compiler wants it',
        argsFor({ file: 'w.wish', genie: 'g.genie' }).join(' ') ===
        '--genie g.genie w.wish');
}

// --- the flag actually changes the verdict ---------------------------------
// Not a fact about string building: a fact about the language, and the reason
// the flag has to be there at all.
{
  const src = 'register wishes : uint<2> = 3\n' +
              'attribute breathing : uint<1> = 1\n' +
              'people alice\n' +
              'wish tidy {\n    define mercy := kill\n    mercy alice\n}\n';
  const mortal = [
    'counter wishes', 'toll 1', '',
    'concept dead(p) := p.breathing == 0', '',
    'invariant Life {', '    check all p in everyone: not dead(p)',
    '    label "nobody dies"', '}', '',
  ].join('\n');

  const withBuiltIn = JSON.parse(M.judge(src, '', false, false, 0, 0).json);
  const withNamed = JSON.parse(M.judge(src, mortal, false, false, 0, 0).json);
  const breached = (j) => (j.wishes?.[0]?.breached ?? []).join(',');

  check('a different genie really does give a different verdict',
        breached(withBuiltIn) !== breached(withNamed),
        `${breached(withBuiltIn)} vs ${breached(withNamed)}`);
  check('so omitting --genie would contradict the editor',
        breached(withNamed) === 'Life', breached(withNamed));
}

// --- the problem matcher ---------------------------------------------------
{
  const matcher = pkg.contributes.problemMatchers.find((m) => m.name === 'loophole');
  check('the package declares a `loophole` matcher', !!matcher);

  // Real diagnostics, produced now, in the plain form a task sees (NO_COLOR is
  // set on the ShellExecution, and the embedded build never colours).
  const cases = {
    'a lexical error': ['register wishes : uint<2> = 3\nwish x { sub wishes, 1; }\n', ''],
    'a parse error':   ['register wishes : uint<2> = 3\nwish x { sub wishes\n', ''],
    'a bad width':     ['register wishes : uint<99> = 3\nwish x { sub wishes, 1 }\n', ''],
    'an unknown verb': ['register wishes : uint<2> = 3\nwish x { sube wishes, 1 }\n', ''],
    'a broken genie':  ['register wishes : uint<2> = 3\nwish x { sub wishes, 1 }\n',
                        'counter wishes\ntoll 1\nrule R\n  layer ast\n'],
  };

  const [msgPat, locPat] = matcher.pattern;
  const msgRe = new RegExp(msgPat.regexp);
  const locRe = new RegExp(locPat.regexp);

  for (const [name, [wish, genie]] of Object.entries(cases)) {
    const out = M.judge(wish, genie, false, false, 0, 0).output;
    const lines = out.split('\n');

    let matched = null;
    for (let i = 0; i < lines.length - 1; i++) {
      const m = msgRe.exec(lines[i]);
      if (!m) continue;
      const l = locRe.exec(lines[i + 1]);
      if (!l) continue;
      matched = { message: m[msgPat.message], file: l[locPat.file],
                  line: Number(l[locPat.line]), column: Number(l[locPat.column]) };
      break;
    }
    check(`matcher: ${name} is matched`, matched !== null,
          JSON.stringify(lines.slice(0, 3)));
    if (matched) {
      check(`matcher: ${name} yields a message`, matched.message.length > 0,
            matched.message);
      check(`matcher: ${name} yields a position`,
            matched.line > 0 && matched.column > 0, JSON.stringify(matched));
      check(`matcher: ${name} yields a file`, /\.(wish|genie)$/.test(matched.file),
            matched.file);
    }
  }

  // The other direction: a clean run must produce NOTHING for the matcher, or
  // every successful judgment would drop a phantom entry into the Problems
  // panel. `EXPLOIT` is a success here, which is exactly the case a matcher
  // written for an ordinary compiler would get wrong.
  const clean = M.judge('register wishes : uint<2> = 3\n' +
                        'wish humble { sub wishes, 3 }\n', '', false, false, 0, 0);
  const falsePositives = clean.output.split('\n').filter((l) => msgRe.test(l));
  check('matcher: an EXPLOIT is not reported as a problem',
        falsePositives.length === 0, JSON.stringify(falsePositives));
}

// --- the manifest wiring ---------------------------------------------------
{
  const c = pkg.contributes;
  check('a run command is contributed',
        c.commands?.some((x) => x.command === 'loophole.run'));
  check('and it is the play button in the editor title',
        c.menus?.['editor/title/run']?.some((x) => x.command === 'loophole.run'),
        JSON.stringify(c.menus?.['editor/title/run']));
  check('a `loophole` task type is contributed',
        c.taskDefinitions?.some((t) => t.type === 'loophole'));
  check('the executable is configurable',
        !!c.configuration?.properties?.['loophole.path']);
}

process.exit(failed);
