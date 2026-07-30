// Building the command line that actually runs.
//
// Knows nothing about VS Code, like `verdict.js` and `assist.js`, and for the
// same reason: the one decision in here is not obvious and should not need an
// editor running to check.
//
// ## Why the command is visible, and why it is a terminal
//
// The editor already judges the file as you type. This is the other thing --
// the moment you stop editing and say "run it" -- and it goes to a terminal
// because that is where both the Python and the C/C++ extensions put it, and
// because seeing `loophole --genie mine.genie w.wish` scroll past is how anybody
// learns that the flag exists. An output panel would hide the command; a
// terminal makes it re-runnable with the up arrow.

/**
 * `# genie: path` is a convention of the language's examples and of `make run`.
 *
 * The compiler itself does NOT read it -- verified, and it matters: a wish
 * declaring `# genie: mortal.genie` judged as bare `loophole w.wish` reports
 * `broke I3` under the built-in genie, and `broke Life` under the one the file
 * asked for. Without adding the flag here, pressing Run would contradict the
 * squiggles in the same window.
 */
const GENIE_LINE = /^[ \t]*#[ \t]*genie:[ \t]*(\S+)/m;

function genieNameIn(text) {
  const m = GENIE_LINE.exec(text ?? '');
  return m ? m[1] : null;
}

/**
 * POSIX single-quote quoting. Everything inside single quotes is literal except
 * a single quote itself, which has to leave the quoting to be written.
 *
 * Only skipped for arguments that cannot need it, so the common case stays
 * readable -- `loophole w.wish` rather than `loophole 'w.wish'`, since the whole
 * point is that a person reads this line.
 */
function quote(arg) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The argument vector, before quoting. Paths are relative to `cwd` when the
 * caller resolved them that way; this function does no path work of its own.
 *
 * @param {object} o
 * @param {string} o.file      the wish file, as it should appear on the line
 * @param {string} [o.genie]   the genie file, if the source named one
 * @returns {string[]}
 */
function argsFor({ file, genie = null }) {
  const args = [];
  if (genie) args.push('--genie', genie);
  args.push(file);
  return args;
}

/**
 * The whole line, quoted, ready to be typed into a shell.
 *
 * @param {object} o
 * @param {string} o.exe       the executable, from the `loophole.path` setting
 */
function commandFor({ exe = 'loophole', file, genie = null }) {
  return [exe, ...argsFor({ file, genie })].map(quote).join(' ');
}

module.exports = { commandFor, argsFor, genieNameIn, quote, GENIE_LINE };
