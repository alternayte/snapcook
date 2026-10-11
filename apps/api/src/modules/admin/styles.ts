/* Direction: a cookbook galley proof — serif text on warm paper, hairline rules, and one red proofreader's mark for anything that needs a decision. */
export const styles = `
:root {
  --paper: #f7f3ea;
  --ink: #1f1b16;
  --ink-soft: #6b6257;
  --rule: #d6cdbd;
  --mark: #b3261e;
  --ok: #2f6b3a;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --mono: ui-monospace, "SF Mono", Menlo, monospace;
  --step: 1.25;
  --text: 1.0625rem;
  --small: calc(var(--text) / var(--step));
  --h2: calc(var(--text) * var(--step));
  --h1: calc(var(--h2) * var(--step) * var(--step));
  --unit: 0.5rem;
  --measure: 44rem;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: calc(var(--unit) * 4) calc(var(--unit) * 3);
  background: var(--paper);
  color: var(--ink);
  font: var(--text)/1.55 var(--serif);
}
main { max-width: var(--measure); margin: 0 auto; }
h1 { font-size: var(--h1); line-height: 1.15; font-weight: 600; margin: 0 0 var(--unit); letter-spacing: -0.01em; }
h2 {
  font-size: var(--small); font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em;
  margin: calc(var(--unit) * 5) 0 calc(var(--unit) * 1.5);
  padding-bottom: var(--unit); border-bottom: 1px solid var(--rule);
}
a { color: inherit; text-decoration-color: var(--rule); text-underline-offset: 0.2em; }
a:hover { text-decoration-color: var(--mark); }
p { margin: 0 0 calc(var(--unit) * 2); }
.meta { color: var(--ink-soft); font-size: var(--small); }
.mark { color: var(--mark); }
.ok { color: var(--ok); }
table { width: 100%; border-collapse: collapse; }
th {
  text-align: left; font-size: var(--small); font-weight: 600; color: var(--ink-soft);
  border-bottom: 1px solid var(--ink); padding: var(--unit) calc(var(--unit) * 1.5) var(--unit) 0;
}
td { border-bottom: 1px solid var(--rule); padding: var(--unit) calc(var(--unit) * 1.5) var(--unit) 0; vertical-align: top; }
td.num { font-family: var(--mono); font-size: var(--small); white-space: nowrap; }
ol.steps { margin: 0; padding: 0; list-style: none; counter-reset: step; }
ol.steps li {
  counter-increment: step; display: grid; grid-template-columns: calc(var(--unit) * 5) 1fr;
  padding: calc(var(--unit) * 1.5) 0; border-bottom: 1px solid var(--rule);
}
ol.steps li::before { content: counter(step); font-family: var(--mono); font-size: var(--small); color: var(--ink-soft); }
.where { font-size: var(--small); font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-soft); }
.settings { font-family: var(--mono); font-size: var(--small); margin-top: calc(var(--unit) / 2); }
nav.filters { display: flex; flex-wrap: wrap; gap: calc(var(--unit) * 2); margin: calc(var(--unit) * 2) 0 calc(var(--unit) * 3); font-size: var(--small); }
nav.filters a[aria-current] { text-decoration-color: var(--mark); text-decoration-thickness: 2px; }
form.promote { display: flex; flex-wrap: wrap; gap: var(--unit); margin-top: calc(var(--unit) * 2); }
button {
  font: 600 var(--small) var(--serif); letter-spacing: 0.04em; color: var(--ink); background: transparent;
  border: 1px solid var(--ink); padding: var(--unit) calc(var(--unit) * 2); cursor: pointer;
}
button:hover { background: var(--ink); color: var(--paper); }
button.mark { border-color: var(--mark); }
button.mark:hover { background: var(--mark); color: var(--paper); }
@media (max-width: 40rem) {
  body { padding: calc(var(--unit) * 2); }
  th.wide, td.wide { display: none; }
}
`;
