// Pull the compiler itself -- the WebAssembly build -- from the latest release.
//
// Same reasoning as `fetch-keywords.mjs`, one step further. The diagnostics are
// not a reimplementation of the compiler's rules; they are the compiler's own
// verdict, reported where you are typing. So the extension has to carry a
// compiler, and this is it.
//
// Committed, and shipped inside the `.vsix`, for two reasons. It has to work on
// a plane, and it has to be the *same* judgment the terminal gives -- a version
// fetched at runtime could drift from the grammar in the same package and start
// underlining words the bundled highlighter thinks are fine.
//
// A release rather than a local `make wasm`: building it needs emsdk, and the
// released artifact is the one CI has already proved judges identically to the
// native compiler.
import { writeFileSync, readFileSync } from 'node:fs';

const BASE = 'https://github.com/rayhuang2006/Loophole/releases/latest/download';
const here = (name) => new URL('../wasm/' + name, import.meta.url);

const get = async (name) => {
  const res = await fetch(`${BASE}/${name}`, { redirect: 'follow' });
  if (!res.ok) {
    console.error(`could not fetch ${name}: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  return Buffer.from(await res.arrayBuffer());
};

const glue = await get('loophole.js');
const binary = await get('loophole.wasm');

// The glue resolves the `.wasm` beside itself, which is where it is going, so
// nothing needs rewriting. Sanity-check that this is the module build and not
// the command-line one -- they are both called `loophole.js` upstream, and the
// command-line build runs `main()` on load and calls `exit()`, which in an
// extension host means killing the host.
if (!glue.includes('createLoophole')) {
  console.error('loophole.js is not the modularised build (no createLoophole)');
  process.exit(1);
}

writeFileSync(here('loophole.js'), glue);
writeFileSync(here('loophole.wasm'), binary);

// Ask it, rather than reading version numbers out of a binary. Scanning the data
// section does not work anyway -- "loophole " and the version are separate string
// literals in the compiler, so they are not next to each other in there -- and
// running the thing proves something scanning never could: that what just landed
// on disk actually instantiates.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = await require('../wasm/loophole.js')();
const [compiler, wish, genie] = M.versions().split('|');

console.log(`  wasm/  ${(binary.length / 1024).toFixed(0)} KB, ` +
            `compiler ${compiler} (wish ${wish}, genie ${genie})`);

// The grammar and the compiler in the same package must describe the same
// language. Left unchecked, the highlighter would colour one dialect while the
// diagnostics judged another -- words underlined as errors while sitting there
// in keyword blue.
const kw = JSON.parse(
  readFileSync(new URL('keywords.json', import.meta.url), 'utf8'));
if (kw.languages.wish !== wish || kw.languages.genie !== genie) {
  console.error(
    `  the grammar is built for wish ${kw.languages.wish}/genie ` +
    `${kw.languages.genie}, but this compiler judges wish ${wish}/genie ` +
    `${genie}. Run \`npm run keywords && npm run gen\` too.`);
  process.exit(1);
}
