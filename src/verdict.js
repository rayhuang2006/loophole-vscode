// A judgment, turned into a list of things to underline.
//
// Deliberately knows nothing about VS Code. Everything worth arguing about is in
// here -- what counts as a problem, which file gets blamed, what the message
// says -- and none of it should need an editor running to check. `extension.js`
// turns these into `vscode.Diagnostic`s and does nothing else.
//
// ## What counts as a problem
//
// This language inverts the usual meaning of the Problems panel. A wish that
// breaks an invariant is not a mistake; it is the entire point of the project,
// the thing you sat down to write. Reporting it as a warning would be the editor
// lying to you about what you achieved.
//
//   could not be parsed   error   nothing was judged. The only real problem here
//   the genie refused     info    a legitimate outcome. The rules worked. Not
//                                 your bug, and not the genie's either
//   EXPLOIT               info    you won. Shown because you want to see it;
//                                 `info` because it must not add to the error
//                                 count -- an exploit is not damage
//   clean                 --      the genie kept what it meant to keep
//
// So the error badge counts exactly one thing: files the compiler could not
// read.

/** Where to blame. `'wish'` or `'genie'`; the caller owns the two documents. */
const WISH = 'wish';
const GENIE = 'genie';

/**
 * @param {object|null} json  a parsed `--json` judgment, or its error form
 * @returns {Array<{file, line, column, span, message, severity, code}>}
 *   `span` is `'token'` (underline the identifier that starts there),
 *   `'line'` (the whole line) -- the caller has the text, this file does not.
 */
function toDiagnostics(json) {
  if (!json) return [];

  // A run that produced no judgment. §10.1 lets the prose report be reworded at
  // will, so the position has to come from here or it cannot be relied on.
  if (json.error) {
    const e = json.error;
    return [{
      // Which of the two files. Without this a typo in a genie is underlined at
      // the same line number of the wish -- pointing confidently at code that
      // is perfectly fine. The name is at the top level, not inside `error`:
      // it is the file being judged, and on a failed run that is the file that
      // failed.
      file: /\.genie$/.test(json.file || '') ? GENIE : WISH,
      line: e.line, column: e.column, span: 'token',
      message: e.help ? `${e.message}\n\nhelp: ${e.help}` : e.message,
      severity: 'error',
      code: 'unparseable',
    }];
  }

  const out = [];
  for (const w of json.wishes || []) {
    if (!w.legal) {
      const by = w.refused_by || {};
      out.push({
        // `refused_by.line` is the statement the rule objected to; `w.line` is
        // the wish itself, used when the refusal is not about any one statement.
        file: WISH, line: by.line || w.line, column: 1, span: 'line',
        message: `not granted. ${w.refused}`,
        severity: 'info',
        code: by.rule || 'refused',
      });
      continue;
    }
    if (!w.exploit) continue;

    const broke = (w.invariants || []).filter((v) => v.verdict !== 'holds');
    // `fooled` and `violated` are different failures and the report says so:
    // violated means the genie's own formula came out false, fooled means the
    // formula still holds and the thing it was meant to protect is gone.
    const fooled = broke.some((v) => v.verdict === 'fooled');
    const detail = broke.map((v) =>
      `  ${v.name}  ${v.verdict.toUpperCase()}  ${v.statement}  ${v.detail}` +
      (v.reality ? `\n        really: ${v.reality}` : '')).join('\n');

    out.push({
      file: WISH, line: w.line, column: 1, span: 'line',
      message: `EXPLOIT. legal, yet it ${fooled ? 'fooled' : 'broke'} ` +
               `${(w.breached || []).join('+')}.\n${detail}`,
      severity: 'info',
      code: 'exploit',
    });
  }
  return out;
}

module.exports = { toDiagnostics, WISH, GENIE };
