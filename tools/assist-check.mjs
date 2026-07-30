// CodeLens labels, hovers and completions, checked against the real compiler.
//
// Same discipline as `diagnostics-check.mjs`: the judgment and the keyword docs
// both come from the WebAssembly build that ships in the `.vsix`, so a change to
// either upstream shows up here rather than being absorbed by a fixture.
//
// Two properties are worth stating outright.
//
// **Nothing in `assist.js` may invent language knowledge.** Every sentence a
// hover shows has to be the compiler's sentence, and the checks below assert
// that by comparing against `--keywords` rather than against a string typed out
// here.
//
// **Nothing in `assist.js` may say less than the compiler distinguished.** See
// "lossless presentation" at the bottom -- it is the more important of the two,
// and it is the one that was missing.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const createLoophole = require('../wasm/loophole.js');
const { lenses, hover, completions, names } = require('../src/assist.js');

const M = await createLoophole();
const keywords = JSON.parse(M.keywords());

let failed = 0;
const check = (name, ok, saw) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) { failed = 1; if (saw !== undefined) console.log(`       saw: ${saw}`); }
};

const GENIE = [
  'counter wishes', 'toll    1', '',
  'rule NoMoreWishes {', '    layer   ast', '    forbid  add on wishes',
  '    because "no wishing for more wishes"', '}', '',
  'invariant I2 {', '    check wishes <= max(before(wishes) - toll, 0)',
  '    label "no net gain"', '}', '',
].join('\n');

const WISH = [
  'register wishes : uint<2> = 3',   // 1
  'attribute breathing : uint<1> = 1', // 2
  'people alice, bob',               // 3
  '',                                // 4
  'wish greedy {',                   // 5
  '    add wishes, 3',               // 6
  '}',                               // 7
  '',                                // 8
  'wish humble {',                   // 9
  '    sub wishes, 3',               // 10
  '}',                               // 11
  '',
].join('\n');

const judge = (wish = WISH, genie = GENIE) => {
  const r = M.judge(wish, genie, false, false, 0, 0);
  try { return JSON.parse(r.json); } catch { return null; }
};
const json = judge();

// --- CodeLens --------------------------------------------------------------
// One lens per wish, on the wish's own line, saying the one thing the reader
// wants to know.
{
  const l = lenses(json);
  check('lens: one per wish', l.length === 2, JSON.stringify(l));
  check('lens: the refused wish is on line 5', l[0]?.line === 5, l[0]?.line);
  check('lens: and names the rule', l[0]?.title === 'not granted · NoMoreWishes',
        l[0]?.title);
  check('lens: the exploit is on line 9', l[1]?.line === 9, l[1]?.line);
  check('lens: and says what it broke', l[1]?.title === 'EXPLOIT · broke I2',
        l[1]?.title);

  const clean = lenses(judge(
    'register wishes : uint<2> = 3\nwish shelf { widen wishes -> uint<64> }\n'));
  check('lens: a clean wish still gets one', clean.length === 1 &&
        clean[0].title === 'clean', JSON.stringify(clean));

  // Nothing was judged, so there is no verdict -- and a lens that said nothing
  // where a verdict goes would read as "clean".
  check('lens: an unparseable file gets none',
        lenses(judge('register wishes : uint<2> = 3\nwish x { sub wishes, 1; }\n'))
          .length === 0);
  check('lens: no judgment at all gets none', lenses(null).length === 0);
}

// --- Hover -----------------------------------------------------------------
{
  // Every reserved word must be explained, and explained with the COMPILER's
  // text. Comparing against `keywords.docs` rather than against a sentence typed
  // here is the point: this cannot pass while `assist.js` carries its own prose.
  const all = ['wish', 'genie', 'operations', 'layers', 'expressions']
    .flatMap((g) => keywords[g]);
  const missing = all.filter((w) => !hover({ word: w, keywords }));
  check(`hover: all ${all.length} reserved words are explained`,
        missing.length === 0, missing.join(', '));
  const wrong = all.filter((w) => {
    const h = hover({ word: w, keywords });
    return h.text !== keywords.docs[w].text || h.syntax !== keywords.docs[w].syntax;
  });
  check('hover: the text is the compiler\'s, not a copy', wrong.length === 0,
        wrong.join(', '));

  const sub = hover({ word: 'sub', keywords });
  check('hover: an operation shows its operands',
        sub.syntax === 'sub <register>, <n>', sub.syntax);

  // A register shows the value after each wish. `greedy` was refused, so it ran
  // nothing and contributes no step -- a repeated value there would suggest
  // something happened.
  const reg = hover({ word: 'wishes', text: WISH, keywords, json });
  check('hover: a register shows a trail', reg?.kind === 'register',
        JSON.stringify(reg));
  check('hover: with its width', reg?.width === 2, reg?.width);
  check('hover: one step per wish that ran, not per wish',
        reg?.trail.length === 1, JSON.stringify(reg?.trail));
  check('hover: and the step shows the underflow', reg?.trail[0] === '3',
        JSON.stringify(reg?.trail));

  // The original joke, and the two things that were wrong here before 1.14.0.
  // The exact digits: `Number()` on this value gives ...552000, so a hover that
  // ever converts it is displaying a falsehood about the one number this
  // language exists to produce. And the width must be the WIDENED 64 -- read off
  // the `register` declaration it would still say 2.
  {
    const src = 'register wishes : uint<2> = 3\n' +
                'wish experiment      { sub   wishes, 3          }\n' +
                'wish bigger_shelf    { widen wishes -> uint<64> }\n' +
                'wish experiment_again{ sub   wishes, 2          }\n';
    const h = hover({ word: 'wishes', text: src, keywords, json: judge(src, '') });
    check('hover: the trail has a step per wish', h?.trail.length === 3,
          JSON.stringify(h?.trail));
    check('hover: the underflow is exact, not rounded',
          h?.trail[2] === '18446744073709551615', h?.trail[2]);
    check('hover: every step is a string, never a Number',
          h?.trail.every((v) => typeof v === 'string'),
          JSON.stringify(h?.trail.map((v) => typeof v)));
    check('hover: the width follows `widen`, it is not the declared one',
          h?.width === 64, h?.width);
  }

  const w = hover({ word: 'humble', text: WISH, keywords, json });
  check('hover: a wish name shows its verdict', w?.kind === 'wish', JSON.stringify(w));
  check('hover: naming what it broke', /broke I2/.test(w?.body ?? ''), w?.body);

  const g = hover({ word: 'greedy', text: WISH, keywords, json });
  check('hover: a refused wish says so', /not granted/.test(g?.body ?? ''), g?.body);

  check('hover: an unknown word gets nothing',
        hover({ word: 'zzz', text: WISH, keywords, json }) === null);
}

// --- Completion ------------------------------------------------------------
{
  const labels = (o) => completions(o).map((c) => c.label);

  const stmt = labels({ linePrefix: '    ', languageId: 'wish', keywords,
                        text: WISH, json });
  for (const w of keywords.operations) {
    check(`completion: a statement offers ${w}`, stmt.includes(w), stmt.join(','));
  }
  check('completion: and offers define', stmt.includes('define'));

  // After a verb, the candidates are that verb's operands. This is the whole
  // value over a flat keyword dump.
  const afterSub = labels({ linePrefix: '    sub ', languageId: 'wish',
                            keywords, text: WISH, json });
  check('completion: after `sub`, registers', afterSub.includes('wishes'),
        afterSub.join(','));
  check('completion: after `sub`, not people', !afterSub.includes('alice'),
        afterSub.join(','));

  const afterKill = labels({ linePrefix: '    kill ', languageId: 'wish',
                             keywords, text: WISH, json });
  check('completion: after `kill`, people', afterKill.includes('alice') &&
        afterKill.includes('bob'), afterKill.join(','));
  check('completion: after `kill`, not registers', !afterKill.includes('wishes'),
        afterKill.join(','));

  const inGenie = labels({ linePrefix: '    ', languageId: 'genie', keywords,
                           text: GENIE, json: null });
  check('completion: a genie offers its own words', inGenie.includes('invariant') &&
        inGenie.includes('forbid'), inGenie.join(','));
  check('completion: and the layer words', inGenie.includes('surface'),
        inGenie.join(','));
  check('completion: and verbs, because a genie forbids them',
        inGenie.includes('kill'), inGenie.join(','));
  check('completion: a genie does not offer `register`',
        !inGenie.includes('register'), inGenie.join(','));

  const carries = completions({ linePrefix: '  ', languageId: 'wish', keywords,
                               text: WISH, json }).find((c) => c.label === 'sub');
  check('completion: an entry carries the compiler\'s doc',
        carries?.doc === keywords.docs.sub.text, carries?.doc);

  // Names must still be offered while the file does not parse -- which is
  // exactly when somebody is typing.
  const broken = WISH.replace('sub wishes, 3', 'sub wishes, 3;');
  const stillThere = labels({ linePrefix: '    sub ', languageId: 'wish',
                             keywords, text: broken, json: judge(broken) });
  check('completion: registers survive an unparseable file',
        stillThere.includes('wishes'), stillThere.join(','));
}

// --- name harvesting -------------------------------------------------------
{
  const n = names(WISH, json);
  check('names: registers from the judgment', n.registers.includes('wishes'),
        JSON.stringify(n.registers));
  check('names: people from the source', n.people.join(',') === 'alice,bob',
        JSON.stringify(n.people));
  check('names: attributes from the source',
        n.attributes.includes('breathing'), JSON.stringify(n.attributes));
  check('names: wishes from the judgment',
        n.wishes.join(',') === 'greedy,humble', JSON.stringify(n.wishes));

  // A comment must not become a person.
  const withComment = 'people alice   # bob is dead\n';
  check('names: a comment is not a person',
        names(withComment, null).people.join(',') === 'alice',
        JSON.stringify(names(withComment, null).people));
}

// --- lossless presentation -------------------------------------------------
//
// The editor may reword a verdict. It may not merge two of them.
//
// This is the failure the rest of this file cannot see, and it is quiet: the
// compiler goes on computing `fooled` and `violated` perfectly, the JSON goes on
// carrying both, and the reader -- who by then only ever looks at the lens --
// stops being told there is a difference. `fooled` versus `violated` IS the
// two-column design, which is the argument of the whole project. Losing it in
// the last three inches would be losing it.
//
// So the property is injectivity, not equality: for any two programs the
// COMPILER judged differently, the presentation must differ too. Nothing below
// asserts what a label says, only that two different things do not end up
// looking like one -- so rewording stays free, and collapsing does not.
{
  const G = M.defaultGenie();
  const WORLD = 'register wishes : uint<2> = 3\n' +
                'attribute breathing : uint<1> = 1\n' +
                'people alice\n';

  // One program per outcome the compiler can reach. `R2` of the built-in genie
  // forbids `kill` at the `surface` layer, so an alias defeats it -- and adding
  // an empty `everyone` turns that same exploit from violated into fooled,
  // because the genie's universal is then vacuously true over nobody while
  // alice is just as dead.
  const corpus = {
    refused:  `${WORLD}wish greedy { add wishes, 3 }\n`,
    clean:    `${WORLD}wish shelf { widen wishes -> uint<64> }\n`,
    violated: `${WORLD}wish tidy {\n    define mercy := kill\n    mercy alice\n}\n`,
    fooled:   `${WORLD}wish tidy {\n    define mercy := kill\n` +
              `    define everyone := { }\n    mercy alice\n}\n`,
  };

  // What the compiler distinguished, read off the judgment rather than assumed.
  const compilerSignature = (j) => {
    const w = (j?.wishes ?? [])[0];
    if (!w) return 'nothing';
    if (!w.legal) return 'refused';
    const verdicts = [...new Set((w.invariants ?? [])
      .map((v) => v.verdict).filter((v) => v !== 'holds'))].sort();
    return verdicts.length ? `exploit:${verdicts.join(',')}` : 'clean';
  };

  const seen = new Map();   // compiler signature -> what the editor shows
  for (const src of Object.values(corpus)) {
    const j = judge(src, G);
    const h = hover({ word: j?.wishes?.[0]?.wish, text: src, keywords, json: j });
    seen.set(compilerSignature(j), {
      lens: lenses(j).map((l) => l.title).join(' | '),
      hover: h?.body ?? '',
    });
  }

  // If a fixture stops producing what it is named after, this check quietly
  // shrinks to three cases and still passes. Assert the corpus first, so the
  // failure reads "you stopped exercising fooled" rather than saying nothing.
  for (const sig of ['refused', 'clean', 'exploit:violated', 'exploit:fooled']) {
    check(`corpus still reaches ${sig}`, seen.has(sig), [...seen.keys()].join(' / '));
  }

  const collide = (pick) => {
    const byText = new Map();
    for (const [sig, v] of seen) {
      const text = pick(v);
      if (byText.has(text)) {
        return `${byText.get(text)} and ${sig} both look like "${text}"`;
      }
      byText.set(text, sig);
    }
    return null;
  };

  const lensCollision = collide((v) => v.lens);
  check('a CodeLens never merges two verdicts', lensCollision === null, lensCollision);
  const hoverCollision = collide((v) => v.hover);
  check('a hover never merges two verdicts', hoverCollision === null, hoverCollision);

  // And the distinction that is the argument of the project, named outright --
  // "they differ somehow" would still be satisfied by two labels differing only
  // in an invariant name the reader has no reason to be reading.
  const vio = seen.get('exploit:violated');
  const foo = seen.get('exploit:fooled');
  if (vio && foo) {
    const words = (s) => new Set(s.toLowerCase().match(/[a-z]+/g) ?? []);
    const onlyInFooled = [...words(foo.lens)].filter((w) => !words(vio.lens).has(w));
    check('and they differ in words, not just in an invariant name',
          onlyInFooled.length > 0, `${vio.lens}   vs   ${foo.lens}`);
  }
}

process.exit(failed);
