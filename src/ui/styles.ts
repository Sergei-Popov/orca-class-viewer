// The page's CSS, built on the `--orca-*` theme variables so it follows Orca's light and dark
// themes; Orca updates the variables in place and toggles `light`/`dark` on <html>. Orca has no
// syntax colour variables, so the code palette is a fixed set of hues for each scheme, mixed
// with the theme's foreground so it sits with any accent.

export const css = String.raw`
:root {
  --bg: var(--orca-background, #ffffff);
  --fg: var(--orca-foreground, #0a0a0a);
  --card: var(--orca-card, #ffffff);
  --muted: var(--orca-muted, #f5f5f5);
  --muted-fg: var(--orca-muted-foreground, #737373);
  --accent: var(--orca-accent, #f5f5f5);
  --accent-fg: var(--orca-accent-foreground, #171717);
  --border: var(--orca-border, #e5e5e5);
  --input: var(--orca-input, #e5e5e5);
  --primary: var(--orca-primary, #171717);
  --primary-fg: var(--orca-primary-foreground, #fafafa);
  --ring: var(--orca-ring, #a3a3a3);
  --destructive: var(--orca-destructive, #dc2626);
  --popover: var(--orca-popover, #ffffff);
  --popover-fg: var(--orca-popover-foreground, #0a0a0a);
  --radius: var(--orca-radius, 6px);
  --select: color-mix(in srgb, var(--primary) 10%, transparent);
  --select-strong: color-mix(in srgb, var(--primary) 17%, transparent);
  --warn: #b7791f;
  --ok: #2f8f62;
  --c-kw: color-mix(in oklab, #a626a4 82%, var(--fg));
  --c-type: color-mix(in oklab, #0f7f8f 85%, var(--fg));
  --c-str: color-mix(in oklab, #3d8a1f 85%, var(--fg));
  --c-num: color-mix(in oklab, #b35a00 85%, var(--fg));
  --c-ann: color-mix(in oklab, #9a6a00 85%, var(--fg));
  --c-com: color-mix(in oklab, var(--muted-fg) 92%, var(--fg));
  --c-op: color-mix(in oklab, #2156c7 85%, var(--fg));
  --c-label: color-mix(in oklab, #c2410c 80%, var(--fg));
  --c-cp: color-mix(in oklab, #7c3aed 80%, var(--fg));
  --c-key: color-mix(in oklab, var(--fg) 70%, var(--muted-fg));
  --i-package: #b8862b;
  --i-class: #2e7fd1;
  --i-inner: #6f8fb8;
  --i-archive: #7c5cc4;
  --i-root: #2f8f62;
  --mark: color-mix(in srgb, #f5c400 38%, transparent);
  --mark-cur: color-mix(in srgb, #ff8a00 55%, transparent);
  --flash: color-mix(in srgb, #2e7fd1 16%, transparent);
  --ui-font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono-font: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --row: 24px;
  color-scheme: light;
}
:root.dark {
  --bg: var(--orca-background, #0a0a0a);
  --fg: var(--orca-foreground, #fafafa);
  --card: var(--orca-card, #0a0a0a);
  --muted: var(--orca-muted, #262626);
  --muted-fg: var(--orca-muted-foreground, #a3a3a3);
  --accent: var(--orca-accent, #262626);
  --accent-fg: var(--orca-accent-foreground, #fafafa);
  --border: var(--orca-border, #2e2e2e);
  --input: var(--orca-input, #2e2e2e);
  --primary: var(--orca-primary, #fafafa);
  --primary-fg: var(--orca-primary-foreground, #171717);
  --ring: var(--orca-ring, #737373);
  --destructive: var(--orca-destructive, #f87171);
  --popover: var(--orca-popover, #171717);
  --popover-fg: var(--orca-popover-foreground, #fafafa);
  --warn: #e0a84a;
  --ok: #5cc28f;
  --c-kw: color-mix(in oklab, #d58df0 85%, var(--fg));
  --c-type: color-mix(in oklab, #4fc6d3 85%, var(--fg));
  --c-str: color-mix(in oklab, #9bd67a 85%, var(--fg));
  --c-num: color-mix(in oklab, #f0a35e 85%, var(--fg));
  --c-ann: color-mix(in oklab, #e6c46b 85%, var(--fg));
  --c-com: color-mix(in oklab, var(--muted-fg) 90%, var(--bg));
  --c-op: color-mix(in oklab, #7aa7ff 85%, var(--fg));
  --c-label: color-mix(in oklab, #ff9d6b 85%, var(--fg));
  --c-cp: color-mix(in oklab, #b69cff 85%, var(--fg));
  --i-package: #dcae55;
  --i-class: #6aaef0;
  --i-inner: #8fa7c7;
  --i-archive: #a68cf0;
  --i-root: #5cc28f;
  --mark: color-mix(in srgb, #f5c400 30%, transparent);
  --mark-cur: color-mix(in srgb, #ff8a00 50%, transparent);
  --flash: color-mix(in srgb, #6aaef0 18%, transparent);
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg); color: var(--fg);
  font: 12px/1.4 var(--ui-font); overflow: hidden; -webkit-font-smoothing: antialiased;
}
button, select, input { font: inherit; color: inherit; }
[hidden] { display: none !important; }
.cv-icon { width: 14px; height: 14px; display: block; flex: none; }
.cv-app { display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative; }

/* Toolbars */
.cv-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 10px; border-bottom: 1px solid var(--border); background: var(--bg); min-height: 38px;
}
.cv-spacer { flex: 1; }
.cv-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cv-title .cv-icon { width: 16px; height: 16px; color: var(--i-class); }
.cv-title h1 { margin: 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--mono-font); }
.cv-title .cv-pkg { color: var(--muted-fg); font-weight: 400; }
.cv-badge {
  font-size: 10.5px; font-weight: 600; letter-spacing: .02em; padding: 1px 7px; border-radius: 999px; white-space: nowrap;
  background: var(--muted); color: var(--fg); border: 1px solid var(--border); cursor: default;
}
.cv-badge.cv-java { background: color-mix(in srgb, var(--i-class) 14%, transparent); border-color: color-mix(in srgb, var(--i-class) 40%, var(--border)); color: color-mix(in oklab, var(--i-class) 60%, var(--fg)); }
.cv-badge.cv-warn { background: color-mix(in srgb, var(--warn) 12%, transparent); border-color: color-mix(in srgb, var(--warn) 45%, var(--border)); color: color-mix(in oklab, var(--warn) 70%, var(--fg)); }
.cv-badge.cv-bad { background: color-mix(in srgb, var(--destructive) 10%, transparent); border-color: color-mix(in srgb, var(--destructive) 45%, var(--border)); color: color-mix(in oklab, var(--destructive) 75%, var(--fg)); }
.cv-tabs { display: flex; align-items: stretch; gap: 2px; padding: 0 8px; min-height: 40px; border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; }
.cv-tab {
  border: 0; background: none; padding: 0 10px; display: flex; align-items: center; cursor: pointer; color: var(--muted-fg); white-space: nowrap;
  border-bottom: 2px solid transparent; margin-bottom: -1px; font-weight: 500;
}
.cv-tab:hover { color: var(--fg); }
.cv-tab[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--fg); }
.cv-tab:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; border-radius: 4px; }
.cv-tab .cv-count { color: var(--muted-fg); font-weight: 400; margin-left: 4px; font-variant-numeric: tabular-nums; }
.cv-tools { display: flex; align-items: center; gap: 6px; margin-left: auto; padding: 4px 0; }
.cv-select, .cv-search input {
  height: 26px; border: 1px solid var(--input); border-radius: var(--radius); background: var(--bg); color: var(--fg);
}
.cv-select { padding: 0 6px; max-width: 260px; }
.cv-search { position: relative; display: flex; align-items: center; }
.cv-search > .cv-icon { position: absolute; left: 7px; color: var(--muted-fg); pointer-events: none; }
.cv-search input { width: 180px; padding: 0 8px 0 26px; }
.cv-search input::placeholder { color: var(--muted-fg); }
.cv-find-count { color: var(--muted-fg); font-variant-numeric: tabular-nums; min-width: 56px; text-align: right; white-space: nowrap; }
.cv-select:focus-visible, .cv-search input:focus-visible, .cv-btn:focus-visible, .cv-crumb:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.cv-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px;
  border: 1px solid var(--input); border-radius: var(--radius); background: var(--bg); color: var(--fg); cursor: pointer; white-space: nowrap;
}
.cv-btn:hover:not(:disabled) { background: var(--accent); color: var(--accent-fg); }
.cv-btn:disabled { opacity: .5; cursor: default; }
.cv-btn.cv-square { width: 26px; padding: 0; justify-content: center; }
.cv-btn.cv-primary { background: var(--primary); color: var(--primary-fg); border-color: var(--primary); }
.cv-seg { display: inline-flex; border: 1px solid var(--input); border-radius: var(--radius); overflow: hidden; }
.cv-seg button { border: 0; background: var(--bg); padding: 0 8px; height: 24px; cursor: pointer; color: var(--muted-fg); white-space: nowrap; }
.cv-seg button + button { border-left: 1px solid var(--input); }
.cv-seg button[aria-pressed="true"] { background: var(--select-strong); color: var(--fg); }

.cv-notices { display: flex; flex-direction: column; }
.cv-notice {
  display: flex; align-items: flex-start; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--border);
  color: var(--fg); background: color-mix(in srgb, var(--warn) 9%, transparent);
}
.cv-notice .cv-icon { color: var(--warn); margin-top: 1px; }
.cv-notice.cv-bad { background: color-mix(in srgb, var(--destructive) 8%, transparent); }
.cv-notice.cv-bad .cv-icon { color: var(--destructive); }
.cv-notice.cv-info { background: var(--muted); }
.cv-notice.cv-info .cv-icon { color: var(--muted-fg); }
.cv-notice strong { font-weight: 600; margin-right: 4px; }

.cv-panes { flex: 1; min-height: 0; position: relative; }
.cv-pane { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }

/* Code */
.cv-code { position: relative; flex: 1; min-height: 0; overflow: auto; outline: none; font: 12px/18px var(--mono-font); tab-size: 4; }
.cv-code:focus-visible { box-shadow: inset 0 0 0 1px var(--ring); }
.cv-sizer { position: relative; min-width: 100%; }
.cv-rows { position: absolute; inset: 0; }
.cv-line { position: absolute; left: 0; right: 0; height: 18px; display: flex; white-space: pre; }
.cv-line.cv-flash { background: var(--flash); }
.cv-ln {
  position: sticky; left: 0; flex: none; width: calc(var(--digits, 2) * 1ch + 24px); padding: 0 10px 0 6px; text-align: right;
  color: var(--muted-fg); opacity: .6; background: var(--bg); user-select: none; border-right: 1px solid var(--border); z-index: 1;
}
.cv-text { padding: 0 16px 0 12px; user-select: text; }
.cv-no-gutter .cv-text { padding-left: 14px; }
.cv-probe { position: absolute; visibility: hidden; white-space: pre; }
.cv-more { color: var(--muted-fg); font-style: italic; }
.cv-code mark { background: var(--mark); color: inherit; border-radius: 2px; }
.cv-code mark.cv-cur { background: var(--mark-cur); box-shadow: 0 0 0 1px color-mix(in srgb, #ff8a00 70%, transparent); }
.t-kw { color: var(--c-kw); }
.t-type { color: var(--c-type); }
.t-str { color: var(--c-str); }
.t-num { color: var(--c-num); }
.t-ann { color: var(--c-ann); }
.t-com { color: var(--c-com); font-style: italic; }
.t-op { color: var(--c-op); }
.t-offset { color: var(--muted-fg); }
.t-label { color: var(--c-label); font-weight: 600; }
.t-cp { color: var(--c-cp); }
.t-key { color: var(--c-key); font-weight: 600; }
.t-bad { color: var(--destructive); }
.cv-link { cursor: pointer; text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 35%, transparent); text-underline-offset: 2px; }
.cv-link:hover { text-decoration-color: currentColor; background: var(--select); border-radius: 2px; }

/* Constant pool */
.cv-pool { flex: 1; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.cv-table-scroll { position: relative; overflow: auto; min-height: 0; outline: none; }
.cv-table-scroll:focus-visible { box-shadow: inset 0 0 0 1px var(--ring); }
.cv-thead, .cv-trow {
  display: grid; grid-template-columns: 64px 128px minmax(140px, 200px) minmax(320px, 1fr) 48px; gap: 0 10px; align-items: center;
  padding: 0 12px; white-space: nowrap;
}
.cv-thead { position: sticky; top: 0; z-index: 2; height: 26px; background: var(--bg); border-bottom: 1px solid var(--border); color: var(--muted-fg); font-size: 11px; font-weight: 500; }
.cv-tbody { position: relative; }
.cv-trow { position: absolute; left: 0; right: 0; height: var(--row); font: 12px var(--mono-font); cursor: default; }
.cv-trow:hover { background: var(--accent); }
.cv-trow[aria-selected="true"] { background: var(--select-strong); }
.cv-trow.cv-flash { background: var(--flash); }
.cv-trow > span { overflow: hidden; text-overflow: ellipsis; }
.cv-trow .cv-idx { color: var(--muted-fg); text-align: right; font-variant-numeric: tabular-nums; }
.cv-trow .cv-tag { color: var(--c-kw); font-family: var(--ui-font); }
.cv-trow .cv-uses { color: var(--muted-fg); text-align: right; font-variant-numeric: tabular-nums; }
.cv-trow .cv-empty-slot { color: var(--muted-fg); font-style: italic; font-family: var(--ui-font); }
.cv-trow mark { background: var(--mark); color: inherit; border-radius: 2px; }
.cv-detail { border-top: 1px solid var(--border); padding: 8px 12px 10px; max-height: 40%; overflow: auto; min-height: 44px; }
.cv-detail h3 { margin: 6px 0 3px; font-size: 11px; font-weight: 600; color: var(--muted-fg); text-transform: none; }
.cv-detail h3:first-child { margin-top: 0; }
.cv-detail .cv-dvalue { font: 12px/1.5 var(--mono-font); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.cv-detail ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 3px 6px; font: 12px var(--mono-font); }
.cv-detail li { white-space: nowrap; }
.cv-hint { color: var(--muted-fg); }
.cv-chip { border: 1px solid var(--border); background: var(--muted); border-radius: 4px; padding: 0 5px; cursor: pointer; font: inherit; color: inherit; }
.cv-chip:hover { background: var(--accent); }

/* Structure */
.cv-doc { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px 24px; }
.cv-doc details { border: 1px solid var(--border); border-radius: var(--radius); margin: 0 0 10px; background: var(--card); }
.cv-doc summary { padding: 7px 10px; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px; list-style: none; user-select: none; }
.cv-doc summary::-webkit-details-marker { display: none; }
.cv-doc summary::before { content: ""; width: 6px; height: 6px; border-right: 1.5px solid var(--muted-fg); border-bottom: 1.5px solid var(--muted-fg); transform: rotate(-45deg); transition: transform .12s; margin-right: 2px; }
.cv-doc details[open] > summary::before { transform: rotate(45deg); }
.cv-doc summary .cv-count { color: var(--muted-fg); font-weight: 400; }
.cv-doc .cv-sec { padding: 2px 12px 10px; overflow-x: auto; }
.cv-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 16px; margin: 0; }
.cv-kv dt { color: var(--muted-fg); }
.cv-kv dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.cv-mono { font-family: var(--mono-font); font-size: 11.5px; }
.cv-grid { border-collapse: collapse; width: 100%; font-size: 12px; }
.cv-grid th { text-align: left; font-weight: 500; color: var(--muted-fg); font-size: 11px; padding: 4px 10px 4px 0; border-bottom: 1px solid var(--border); white-space: nowrap; }
.cv-grid td { padding: 3px 10px 3px 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); vertical-align: top; }
.cv-grid td.cv-mono { white-space: pre-wrap; overflow-wrap: anywhere; }
.cv-attr { margin: 6px 0 0; padding: 6px 0 0; border-top: 1px dashed var(--border); }
.cv-attr:first-child { border-top: 0; margin-top: 0; }
.cv-attr-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.cv-attr-head strong { font-family: var(--mono-font); font-size: 12px; }
.cv-attr-body { margin-top: 4px; }
.cv-pre { margin: 0; font: 11.5px/1.5 var(--mono-font); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.cv-hex { margin: 0; font: 11.5px/1.5 var(--mono-font); white-space: pre; user-select: text; color: var(--fg); }
.cv-a { color: inherit; cursor: pointer; text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 35%, transparent); text-underline-offset: 2px; background: none; border: 0; padding: 0; font: inherit; }
.cv-a:hover { text-decoration-color: currentColor; }

/* Jar */
.cv-crumbs { display: flex; align-items: center; gap: 2px; min-width: 0; flex-wrap: wrap; }
.cv-crumb { border: 0; background: none; padding: 2px 6px; border-radius: 4px; cursor: pointer; color: var(--muted-fg); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-crumb:hover { background: var(--accent); color: var(--accent-fg); }
.cv-crumb[aria-current="true"] { color: var(--fg); font-weight: 600; cursor: default; background: none; }
.cv-crumb-sep .cv-icon { width: 12px; height: 12px; color: var(--muted-fg); opacity: .6; }
.cv-summary { color: var(--muted-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.cv-main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(220px, var(--tree, 320px)) 5px minmax(0, 1fr); }
.cv-split { cursor: col-resize; background: var(--border); background-clip: content-box; padding: 0 2px; }
.cv-split:hover, .cv-split.cv-dragging { background-color: var(--ring); }
@media (max-width: 720px) {
  .cv-main { grid-template-columns: 1fr; grid-template-rows: minmax(160px, 40%) 1px minmax(0, 1fr); }
  .cv-split { cursor: default; padding: 0; pointer-events: none; }
  .cv-search input { width: 130px; }
}
.cv-alone > .cv-main { display: flex; }
.cv-alone > .cv-main > .cv-detailpane { flex: 1; min-width: 0; }
.cv-alone .cv-tree, .cv-alone .cv-split, .cv-alone .cv-bar .cv-square { display: none; }
.cv-tree { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.cv-tree-bar { display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.cv-tree-bar .cv-search { flex: 1; min-width: 0; }
.cv-tree-bar .cv-search input { width: 100%; }
.cv-scroll { position: relative; flex: 1; min-height: 0; overflow: auto; outline: none; }
.cv-scroll:focus-visible { box-shadow: inset 0 0 0 1px var(--ring); }
.cv-trows { position: absolute; left: 0; right: 0; top: 0; }
.cv-node { position: absolute; left: 0; right: 0; height: var(--row); display: flex; align-items: center; gap: 4px; padding-right: 10px; white-space: nowrap; user-select: none; cursor: default; }
.cv-node:hover { background: var(--accent); }
.cv-node[aria-selected="true"] { background: var(--select); }
.cv-scroll:focus .cv-node[aria-selected="true"] { background: var(--select-strong); }
.cv-twisty { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; color: var(--muted-fg); flex: none; }
.cv-twisty .cv-icon { width: 12px; height: 12px; transition: transform .12s; }
.cv-twisty[data-open="true"] .cv-icon { transform: rotate(90deg); }
.cv-kind { display: flex; color: var(--muted-fg); flex: none; }
.cv-kind.k-package { color: var(--i-package); }
.cv-kind.k-class { color: var(--i-class); }
.cv-kind.k-inner { color: var(--i-inner); }
.cv-kind.k-archive { color: var(--i-archive); }
.cv-kind.k-root { color: var(--i-root); }
.cv-kind.k-folder { color: var(--i-package); opacity: .85; }
.cv-label { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.cv-label mark { background: var(--mark); color: inherit; border-radius: 2px; }
.cv-node .cv-note { color: var(--muted-fg); margin-left: auto; padding-left: 8px; font-variant-numeric: tabular-nums; font-size: 11px; }
.cv-node .cv-mr { font-size: 10px; color: var(--muted-fg); border: 1px solid var(--border); border-radius: 3px; padding: 0 3px; margin-left: 4px; }
.cv-detailpane { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.cv-subbar { display: flex; align-items: center; gap: 8px; padding: 5px 12px; border-bottom: 1px solid var(--border); min-height: 34px; flex-wrap: wrap; }
.cv-path { color: var(--muted-fg); font-family: var(--mono-font); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.cv-overview { padding: 24px; display: flex; flex-direction: column; gap: 16px; max-width: 720px; overflow: auto; }
.cv-overview h2 { margin: 0; font-size: 15px; display: flex; align-items: center; gap: 10px; }
.cv-overview h2 .cv-icon { width: 22px; height: 22px; color: var(--i-archive); }
.cv-overview p { margin: 0; color: var(--muted-fg); }
.cv-stats { display: flex; gap: 8px; flex-wrap: wrap; }
.cv-stat { border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 12px; min-width: 110px; background: var(--card); }
.cv-stat b { display: block; font-size: 16px; font-variant-numeric: tabular-nums; }
.cv-stat span { color: var(--muted-fg); }
.cv-bars { display: flex; flex-direction: column; gap: 4px; }
.cv-barrow { display: grid; grid-template-columns: 90px minmax(0, 1fr) 70px; gap: 8px; align-items: center; }
.cv-bartrack { height: 8px; border-radius: 4px; background: var(--muted); overflow: hidden; }
.cv-barfill { height: 100%; background: color-mix(in srgb, var(--i-class) 70%, transparent); border-radius: 4px; }
.cv-barrow .cv-n { text-align: right; color: var(--muted-fg); font-variant-numeric: tabular-nums; }
.cv-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center; color: var(--muted-fg); overflow: auto; }
.cv-center h2 { margin: 0; font-size: 14px; color: var(--fg); }
.cv-center p { margin: 0; max-width: 520px; }
.cv-center > .cv-icon { width: 32px; height: 32px; stroke-width: 1; }
.cv-center .cv-hex { text-align: left; margin-top: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--muted); max-width: 100%; overflow: auto; }
.cv-image { flex: 1; min-height: 160px; display: flex; align-items: center; justify-content: center; padding: 16px; background: repeating-conic-gradient(var(--muted) 0% 25%, var(--bg) 0% 50%) 50% / 16px 16px; }
.cv-image img { max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 0 0 1px var(--border); }
.cv-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--fg); animation: cv-spin .8s linear infinite; }
@keyframes cv-spin { to { transform: rotate(360deg); } }
.cv-toast {
  position: absolute; right: 14px; bottom: 14px; padding: 6px 10px; border-radius: var(--radius); z-index: 10;
  background: var(--popover); color: var(--popover-fg); border: 1px solid var(--border);
  box-shadow: 0 4px 16px rgb(0 0 0 / .18); opacity: 0; transform: translateY(4px); transition: opacity .15s, transform .15s; pointer-events: none;
}
.cv-toast.cv-show { opacity: 1; transform: none; }
`

export function installStyles(): void {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
}
