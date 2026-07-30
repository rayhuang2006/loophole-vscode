// CodeLens labels, hover contents, and completion candidates.
//
// Knows nothing about VS Code, for the same reason `verdict.js` does not: all
// three answers are decisions about the language, and a decision about the
// language should not need an editor running to check. `extension.js` turns what
// comes out of here into `CodeLens` / `Hover` / `CompletionItem`.
//
// All three read the same two inputs, which is why they live in one file rather
// than three:
//
//   json      the last `--json` judgment of this document, or null
//   keywords  the compiler's own `--keywords`, including the `docs` it added in
//             1.13.0 -- so the sentence shown on hover is the compiler's
//             sentence, not a second account of the semantics kept in an editor
//
// Lines are 1-based here, the way the compiler counts. `extension.js` subtracts.

// ---------------------------------------------------------------------------
// CodeLens: the verdict, written above the wish it belongs to.
//
// This is the question the language exists to answer -- "did this one work?" --
// so it belongs on the code, not folded into a panel the reader has to go and
// open. Note what is NOT here: no lens on a wish the compiler could not read,
// because there is no verdict to report, and a lens saying nothing in the place
// a verdict goes reads as "clean".
// ---------------------------------------------------------------------------
function lenses(json) {
  if (!json || !json.wishes) return [];
  return json.wishes.map((w) => {
    if (!w.legal) {
      const rule = (w.refused_by || {}).rule;
      return { line: w.line, kind: 'refused',
               title: rule ? `not granted · ${rule}` : 'not granted' };
    }
    if (!w.exploit) return { line: w.line, kind: 'clean', title: 'clean' };

    const broke = (w.invariants || []).filter((v) => v.verdict !== 'holds');
    const verb = broke.some((v) => v.verdict === 'fooled') ? 'fooled' : 'broke';
    const names = (w.breached || []).join('+');
    return { line: w.line, kind: 'exploit',
             title: `EXPLOIT · ${verb} ${names}` };
  });
}

// ---------------------------------------------------------------------------
// Names in the document.
//
// Two sources, and the order matters. Register and wish names come from the
// judgment, because the compiler resolved them; a regex only sees text. The rest
// -- people, attributes, definitions -- are not in `--json`, so they are scraped
// from the source.
//
// Scraping is acceptable *here* and nowhere else in this extension, and the
// reason is the blast radius: a name harvested wrongly produces a wrong
// suggestion in a dropdown, which the reader ignores. A judgment harvested
// wrongly produces a lie about whether their exploit worked. Those are not the
// same risk, and only the second is what "never reimplement the compiler" is
// protecting. The scrape is also the only thing that works while the file does
// not parse, which is exactly when somebody is typing.
// ---------------------------------------------------------------------------
const DECL = {
  register:  /^[ \t]*register[ \t]+([A-Za-z_]\w*)/gm,
  attribute: /^[ \t]*attribute[ \t]+([A-Za-z_]\w*)/gm,
  wish:      /^[ \t]*wish[ \t]+([A-Za-z_]\w*)/gm,
  define:    /^[ \t]*define[ \t]+([A-Za-z_]\w*)/gm,
};
const PEOPLE = /^[ \t]*people[ \t]+([^\n#]+)/gm;

function scrape(text, re) {
  const out = [];
  for (const m of text.matchAll(re)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function names(text, json) {
  // `registers` is per wish; any wish carries the whole set, so the first one
  // that has it is enough. A refused wish has none -- nothing ran.
  let registers = [];
  for (const w of json?.wishes ?? []) {
    if (w.registers) { registers = Object.keys(w.registers); break; }
  }
  // Nothing ran -- every wish was refused, or the file does not parse. The
  // source is the only thing left, and it is also the only thing that works
  // while somebody is mid-keystroke.
  if (!registers.length) registers = scrape(text, DECL.register);

  const wishes = (json?.wishes ?? []).map((w) => w.wish);

  const people = [];
  for (const m of text.matchAll(PEOPLE)) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim();
      if (/^[A-Za-z_]\w*$/.test(n) && !people.includes(n)) people.push(n);
    }
  }

  return {
    registers,
    wishes: wishes.length ? wishes : scrape(text, DECL.wish),
    people,
    attributes: scrape(text, DECL.attribute),
    definitions: scrape(text, DECL.define),
  };
}

// ---------------------------------------------------------------------------
// Hover.
//
// Two kinds of thing can be under the cursor, and they answer differently:
//
//   a reserved word   what it means -- straight from the compiler's `docs`
//   a name you wrote  what the compiler made of it. A register shows the value
//                     it held after each wish, which is the underflow becoming
//                     visible: `3 → 2 → 3` says more about this language than a
//                     paragraph would.
// ---------------------------------------------------------------------------
function hover({ word, text = '', keywords = null, json = null }) {
  if (!word) return null;

  const doc = keywords?.docs?.[word];
  if (doc) {
    return { kind: 'word', word, syntax: doc.syntax, text: doc.text };
  }

  const wish = (json?.wishes ?? []).find((w) => w.wish === word);
  if (wish) {
    const lines = [];
    if (!wish.legal) {
      lines.push(`**not granted.** ${wish.refused}`);
    } else if (wish.exploit) {
      const broke = (wish.invariants || []).filter((v) => v.verdict !== 'holds');
      lines.push(`**EXPLOIT.** legal, yet it broke ${(wish.breached || []).join('+')}.`);
      for (const v of broke) {
        lines.push(`- \`${v.name}\` ${v.verdict.toUpperCase()} — ${v.statement} ${v.detail}`);
      }
    } else {
      lines.push('**clean.** the genie kept what it meant to keep.');
    }
    return { kind: 'wish', word, body: lines.join('\n') };
  }

  // A register: the trail of values, one per wish, in the order they were
  // granted. Wishes that were refused ran nothing, so they contribute no step
  // rather than a repeated one -- showing `3 → 3 → 2` for a refusal would
  // suggest something happened.
  //
  // The values stay strings all the way to the screen. They are uint64 and the
  // interesting one is 18446744073709551615, which `Number()` would round to
  // ...552000 -- displaying a wrong number in the one place this language is
  // about. The width comes from the same record because `widen` changes it: read
  // off the `register` declaration instead, it would say `uint<2>` about a
  // register that has been 64 bits wide for two wishes.
  const trail = [];
  let width = null;
  for (const w of json?.wishes ?? []) {
    const r = w.registers?.[word];
    if (r) { trail.push(r.value); width = r.width; }
  }
  if (trail.length) return { kind: 'register', word, trail, width };
  return null;
}

// ---------------------------------------------------------------------------
// Completion.
//
// The context comes from the current line and nothing else. That is a heuristic,
// stated plainly rather than dressed up: a real one would need the parser, the
// parser is in the compiler, and the compiler cannot parse the half-written line
// under the cursor anyway. What the heuristic buys is the difference between
// "here are 42 words" and "you are naming a target, here are your registers".
//
// Getting it wrong costs a dropdown entry nobody picks.
// ---------------------------------------------------------------------------
const KIND = {
  wish: 'keyword', genie: 'keyword', operations: 'operation',
  layers: 'constant', expressions: 'function',
};

function candidate(word, group, keywords) {
  const doc = keywords?.docs?.[word];
  return {
    label: word,
    kind: KIND[group] ?? 'keyword',
    detail: doc?.syntax ?? '',
    doc: doc?.text ?? '',
  };
}

function completions({ linePrefix = '', languageId = 'wish',
                       keywords = null, text = '', json = null }) {
  if (!keywords) return [];
  const ops = keywords.operations ?? [];
  const known = names(text, json);

  const named = (list, kind, detail) =>
    list.map((label) => ({ label, kind, detail, doc: '' }));

  // Naming a target: the line already has a verb on it. Offer what that verb can
  // take -- `kill` wants a person, `sub` wants a register -- rather than every
  // name in the file.
  const verb = /^[ \t]*([A-Za-z_]\w*)[ \t]+[A-Za-z_]*$/.exec(linePrefix);
  if (verb && ops.includes(verb[1])) {
    const v = verb[1];
    if (v === 'kill' || v === 'revive') {
      return [...named(known.people, 'variable', 'person'),
              ...named(known.definitions, 'alias', 'definition')];
    }
    if (v === 'set') {
      return [...named(known.people, 'variable', 'person'),
              ...named(known.definitions, 'alias', 'definition')];
    }
    return [...named(known.registers, 'variable', 'register'),
            ...named(known.definitions, 'alias', 'definition')];
  }

  if (languageId === 'genie') {
    const out = [];
    for (const g of ['genie', 'expressions', 'layers']) {
      for (const w of keywords[g] ?? []) out.push(candidate(w, g, keywords));
    }
    // A genie forbids verbs and counts a register, so both belong here.
    out.push(...named(ops, 'operation', 'operation'));
    out.push(...named(known.registers, 'variable', 'register'));
    return out;
  }

  // A wish file. At statement position -- the line is bare, or holds one
  // half-typed word -- everything that can start a statement is a candidate.
  const out = [];
  for (const w of keywords.wish ?? []) out.push(candidate(w, 'wish', keywords));
  for (const w of ops) out.push(candidate(w, 'operations', keywords));
  out.push(...named(known.definitions, 'alias', 'definition'));
  return out;
}

module.exports = { lenses, hover, completions, names };
