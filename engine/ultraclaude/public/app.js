/* global Terminal, FitAddon */
const TOKEN = new URLSearchParams(location.search).get('t') || '';
const $ = (id) => document.getElementById(id);
const VIEWS = ['overview', 'agents', 'tasks', 'memory', 'map'];
const STATE = { working: 'working', waiting: 'needs you', idle: 'idle', starting: 'starting', stopped: 'stopped' };
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

const S = { project: null, roles: [], agents: [], tasks: [], notes: [], noteCount: 0, sessions: [], allSessions: false, picked: new Set(), hidden: new Set(), only: null, tree: [], open: new Set(), openSeeded: false, projectRel: '', folder: null, editing: false, view: 'overview', sel: null, want: null, grid: false, note: null, role: 'bugfixer' };
let ws;
let halted = false;

// ---------- helpers ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

// Only touch the DOM when something changed, so hover, focus and clicks survive live updates.
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const setAttr = (el, name, value) => { if (el.getAttribute(name) !== String(value)) el.setAttribute(name, value); };

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-uc-token': TOKEN }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

function toast(text, kind = '', onclick) {
  const el = h('div', { class: 'toast', onclick: () => { el.remove(); onclick?.(); } }, kind ? h('i', { class: `dot ${kind}` }) : null, h('span', {}, text));
  $('toasts').append(el);
  setTimeout(() => el.remove(), 8000);
}

const guard = (fn) => async (...args) => { try { await fn(...args); } catch (err) { toast(err.message, 'error'); } };
const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const agentBy = (ref) => S.agents.find((a) => a.id === ref || a.name === ref);
const busy = (a) => a.state === 'working' || a.state === 'waiting';
const ago = (ts) => {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 60) return `${min}m`;
  if (min < 60 * 24) return `${Math.round(min / 60)}h`;
  if (min < 60 * 24 * 14) return `${Math.round(min / 1440)}d`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- navigation ----------

function setView(view) {
  S.view = view;
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  syncSide();
  if (view === 'overview') { syncGraph(); $('feed').scrollTop = $('feed').scrollHeight; }
  if (view === 'agents') layoutTerms();
  if (view === 'memory') loadNotes();
  if (view === 'map') loadChats();
}

// ---------- map of all chats ----------
// The drive in the middle, every folder on the way to a Claude Code chat on the rings around it
// (with all its sibling folders), and every chat as a dot in the folder it was opened in. Any
// folder can be opened to show its subfolders. Wheel zooms, dragging moves, Fit shows everything.

let chatData = null;
let chatPick = null; // { key, id } for a chat, { folder } for a folder
let mapRoot = null;
let mapView = null; // { x, y, k }: pan and zoom
let mapRadius = 0;
let mapDragged = false;
const RING = 150; // distance between two folder levels
const FEW = 12; // a folder with many other subfolders shows this many, then "+N more"

const kb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);
const stamp = (ts) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const keyOf = (name, sep) => (sep === '\\' ? name.toLowerCase() : name);
const samePath = (a, b) => !!a && !!b && a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
const folderNode = (name, p, sep) => ({ type: 'dir', name, path: p, sep, kids: new Map(), chats: [], onPath: false, open: false, loaded: false, showAll: false });

function childFolder(parent, name) {
  const k = keyOf(name, parent.sep);
  if (!parent.kids.has(k)) {
    const p = parent.path.endsWith(parent.sep) ? parent.path + name : parent.path + parent.sep + name;
    parent.kids.set(k, folderNode(name, p, parent.sep));
  }
  return parent.kids.get(k);
}

function buildFolderTree(projects) {
  const roots = new Map();
  for (const pr of projects) {
    if (!pr.dir) continue;
    const sep = pr.dir.includes('\\') ? '\\' : '/';
    const parts = pr.dir.split(/[\\/]+/);
    const rootName = sep === '\\' ? `${parts[0]}\\` : '/';
    if (!roots.has(rootName.toLowerCase())) roots.set(rootName.toLowerCase(), folderNode(rootName, rootName, sep));
    let n = roots.get(rootName.toLowerCase());
    n.onPath = n.open = true;
    for (const part of parts.slice(1).filter(Boolean)) { n = childFolder(n, part); n.onPath = n.open = true; }
    for (const s of pr.sessions) n.chats.push({ type: 'chat', s, pr });
  }
  if (roots.size === 1) return [...roots.values()][0];
  const top = Object.assign(folderNode('This computer', '', '\\'), { onPath: true, open: true, loaded: true, virtual: true });
  for (const [k, r] of roots) top.kids.set(k, r);
  return top;
}

async function loadDirs(n) {
  if (n.loaded || n.virtual) return;
  n.loaded = true;
  try {
    const { dirs, unreadable } = await api('GET', `/api/dirs?path=${encodeURIComponent(n.path)}`);
    for (const d of dirs) childFolder(n, d);
    n.unreadable = !!unreadable;
  } catch { n.unreadable = true; }
}

function findFolder(n, p) {
  if (!n) return null;
  if (n.path === p) return n;
  for (const c of n.kids.values()) { const hit = findFolder(c, p); if (hit) return hit; }
  return null;
}
const chatsBelow = (n) => n.chats.length + [...n.kids.values()].reduce((sum, c) => sum + chatsBelow(c), 0);

const loadChats = guard(async () => {
  try {
    chatData = (await api('GET', '/api/chats')).projects;
  } catch {
    setText($('mapSummary'), '');
    $('mapSvg').replaceChildren();
    $('mapDetail').replaceChildren();
    $('mapEmpty').hidden = false;
    setText($('mapEmpty'), 'The UltraClaude server behind this window is older than the window and cannot list chats yet. Run “ultraclaude” in this folder to update it.');
    return;
  }
  const openBefore = new Set();
  const remember = (n) => { if (n.open) openBefore.add(n.path); n.kids.forEach(remember); };
  if (mapRoot) remember(mapRoot);
  mapRoot = buildFolderTree(chatData);
  // every folder on the way to a chat shows all of its subfolders
  const onPath = [];
  const collect = (n) => { if (n.onPath) onPath.push(n); n.kids.forEach(collect); };
  collect(mapRoot);
  await Promise.all(onPath.map(loadDirs));
  for (const p of openBefore) { const n = findFolder(mapRoot, p); if (n && !n.onPath) { n.open = true; await loadDirs(n); } }
  if (!chatPick) {
    const newest = chatData.flatMap((pr) => pr.sessions.map((s) => ({ pr, s }))).sort((a, b) => b.s.updated - a.s.updated)[0];
    if (newest) chatPick = { key: newest.pr.key, id: newest.s.id };
  }
  mapView = null;
  renderMap();
});

/** What a node shows on the ring outside it: subfolders (when open) and its chats. */
function mapKids(n) {
  if (n.type !== 'dir') return [];
  let folders = [];
  let more = null;
  if (n.open) {
    const all = [...n.kids.values()];
    const others = all.filter((f) => !f.onPath);
    const shown = n.showAll || others.length <= FEW + 4 ? others : others.slice(0, FEW);
    folders = [...all.filter((f) => f.onPath), ...shown].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (shown.length < others.length) more = { type: 'more', parent: n, count: others.length - shown.length, path: `${n.path}\0more` };
  }
  return [...folders, ...(more ? [more] : []), ...n.chats];
}

function renderMap() {
  if (!chatData || !mapRoot) return;
  const all = chatData.flatMap((pr) => pr.sessions);
  setText($('mapSummary'), `${plural(all.length, 'chat')} in ${plural(chatData.length, 'folder')}`);
  $('mapEmpty').hidden = all.length > 0;
  if (!all.length) { setText($('mapEmpty'), 'No Claude Code chats on this computer yet.'); $('mapSvg').replaceChildren(); return renderChatDetail(); }

  // radial layout: each node gets a slice of the circle in proportion to what hangs below it
  const weigh = (n) => { n._kids = mapKids(n); n._w = n._kids.length ? n._kids.reduce((s, c) => s + weigh(c), 0) : 1; return n._w; };
  weigh(mapRoot);
  mapRadius = 0;
  const place = (n, a0, a1, depth) => {
    n._a = (a0 + a1) / 2;
    n._r = depth * RING;
    mapRadius = Math.max(mapRadius, n._r);
    let a = a0;
    for (const c of n._kids) { const span = ((a1 - a0) * c._w) / n._w; place(c, a, a + span, depth + 1); a += span; }
  };
  place(mapRoot, -Math.PI / 2, Math.PI * 1.5, 0);

  const q = $('mapFilter').value.trim().toLowerCase();
  const hit = (c) => !q || `${c.s.title} ${c.s.firstPrompt} ${c.pr.name}`.toLowerCase().includes(q);
  const hitsBelow = (n) => n.chats.some(hit) || [...n.kids.values()].some(hitsBelow);
  const biggest = Math.max(...all.map((s) => s.size));
  const pt = (a, r) => `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
  const links = [];
  const nodes = [];
  const walk = (n) => {
    for (const c of n._kids) {
      const mid = (n._r + c._r) / 2;
      const strong = c.type === 'chat' || c.onPath;
      links.push(svg('path', { class: `ml${strong ? ' strong' : ''}`, d: `M${pt(n._a, n._r)}C${pt(n._a, mid)} ${pt(c._a, mid)} ${pt(c._a, c._r)}` }));
      nodes.push(c);
      walk(c);
    }
  };
  walk(mapRoot);

  const label = (n, text, extra) => {
    const deg = (n._a * 180) / Math.PI;
    const flip = Math.cos(n._a) < 0;
    // the gap to the dot is in em, so it grows with the text when labels keep their size while zoomed out
    return svg('text', { dx: flip ? '-0.95em' : '0.95em', 'dominant-baseline': 'central', 'text-anchor': flip ? 'end' : 'start', transform: `rotate(${(flip ? deg + 180 : deg).toFixed(1)})` }, text, extra);
  };
  const nodeEl = (n) => {
    const at = `translate(${pt(n._a, n._r)})`;
    let g;
    if (n.type === 'chat') {
      const r = 3.5 + 4.5 * Math.sqrt(n.s.size / biggest);
      const sel = chatPick?.key === n.pr.key && chatPick?.id === n.s.id;
      g = svg('g', { class: `mnode chat${n.pr.current ? ' here' : ''}${hit(n) ? '' : ' dim'}`, transform: at, tabindex: 0, role: 'button', 'aria-label': `${n.s.title}, ${n.pr.name}` },
        svg('title', {}, `${n.s.title}\n${n.pr.dir || n.pr.name} · ${stamp(n.s.updated)}`),
        svg('circle', { class: 'hit', r: 12 }), svg('circle', { class: 'dot', r: r.toFixed(1) }), sel ? svg('circle', { class: 'ring', r: (r + 4).toFixed(1) }) : null,
        label(n, cut(n.s.title, 36)));
      g.addEventListener('click', () => { if (mapDragged) return; chatPick = { key: n.pr.key, id: n.s.id }; renderMap(); });
    } else if (n.type === 'more') {
      g = svg('g', { class: 'mnode more', transform: at, tabindex: 0, role: 'button' },
        svg('circle', { class: 'hit', r: 12 }), svg('circle', { class: 'dot', r: 4 }), label(n, `+${n.count} more folders`));
      g.addEventListener('click', () => { if (mapDragged) return; n.parent.showAll = true; renderMap(); });
    } else {
      const below = chatsBelow(n);
      const current = samePath(n.path, S.project?.dir);
      const sel = chatPick?.folder === n.path;
      g = svg('g', { class: `mnode dir${n.onPath ? ' path' : ''}${n.open ? ' open' : ''}${current ? ' current' : ''}${q && !hitsBelow(n) ? ' dim' : ''}`, transform: at, tabindex: 0, role: 'button', 'aria-label': n.path, 'aria-expanded': String(n.open) },
        svg('title', {}, n.path),
        svg('circle', { class: 'hit', r: 12 }), svg('circle', { class: 'dot', r: n.onPath ? 5 : 4 }), sel ? svg('circle', { class: 'ring', r: 9 }) : null,
        label(n, n.name, below ? svg('tspan', { class: 'cnt', dx: 6 }, current ? `${below} · this folder` : String(below)) : (current ? svg('tspan', { class: 'cnt', dx: 6 }, 'this folder') : null)));
      g.addEventListener('click', guard(async () => {
        if (mapDragged) return;
        const wasPicked = chatPick?.folder === n.path;
        chatPick = { folder: n.path };
        if (!n.open) { n.open = true; await loadDirs(n); } else if (wasPicked) n.open = false;
        renderMap();
      }));
    }
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); g.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
    return g;
  };

  const center = svg('g', { class: 'map-center', tabindex: 0, role: 'button', 'aria-label': mapRoot.virtual ? 'This computer' : mapRoot.path },
    svg('rect', { x: -58, y: -26, width: 116, height: 52, rx: 4 }),
    svg('text', { y: -3 }, mapRoot.virtual ? 'This computer' : mapRoot.name),
    svg('text', { class: 'count', y: 15 }, plural(all.length, 'chat')));
  center.addEventListener('click', () => { if (mapDragged) return; chatPick = { folder: mapRoot.path }; renderMap(); });

  const world = svg('g', { id: 'mapWorld' }, links, nodes.map(nodeEl), center);
  $('mapSvg').replaceChildren(world);
  applyView();
  renderChatDetail();
}

function applyView() {
  const stage = $('mapStage');
  if (!stage || !$('mapWorld')) return; // gone after Quit
  const w = stage.clientWidth;
  const ht = stage.clientHeight;
  if (!w || !ht) return;
  if (!mapView) {
    const reach = mapRadius + 120; // room for the outermost labels
    mapView = { x: w / 2, y: ht / 2, k: Math.min(1.2, Math.min(w, ht) / (2 * reach)) };
  }
  const world = $('mapWorld');
  world.setAttribute('transform', `translate(${mapView.x.toFixed(1)},${mapView.y.toFixed(1)}) scale(${mapView.k.toFixed(4)})`);
  // Zoomed out, the centre, the dots and the names of the folders that lead to chats keep their size
  // on screen, so the whole map stays readable; everything else is labelled once you zoom in.
  const far = mapView.k < 0.6;
  $('mapSvg').classList.toggle('far', far);
  world.style.setProperty('--inv', far ? String(0.6 / mapView.k) : '1');
  world.style.setProperty('--dot', far ? String(Math.min(2.2, 0.6 / mapView.k)) : '1');
}

function zoomAt(x, y, factor) {
  if (!mapView) return;
  const k = Math.min(4, Math.max(0.05, mapView.k * factor));
  mapView.x = x - ((x - mapView.x) * k) / mapView.k;
  mapView.y = y - ((y - mapView.y) * k) / mapView.k;
  mapView.k = k;
  applyView();
}

function renderChatDetail() {
  if (chatPick && 'folder' in chatPick) return renderFolderDetail(findFolder(mapRoot, chatPick.folder));
  const pr = chatData?.find((p) => p.key === chatPick?.key);
  const s = pr?.sessions.find((x) => x.id === chatPick.id);
  if (!s) return $('mapDetail').replaceChildren(h('p', { class: 'none' }, 'Pick a dot to see that chat or folder.'));
  const agent = S.agents.find((a) => a.sessionId === s.id);
  let action = null;
  if (pr.current && agent) action = h('button', { type: 'button', class: 'btn primary', onclick: () => openAgent(agent.id) }, 'Open its terminal');
  else if (pr.current) action = h('button', { type: 'button', class: 'btn primary', onclick: () => createAgent({ sessionId: s.id }) }, 'Continue here');
  else if (pr.dir) action = openFolderButton(pr.dir, pr.name);
  $('mapDetail').replaceChildren(...[
    h('h2', {}, s.title),
    h('dl', {}, h('dt', {}, 'Folder'), h('dd', { class: 'mono' }, pr.dir || pr.name), h('dt', {}, 'Last active'), h('dd', {}, stamp(s.updated)), h('dt', {}, 'Length'), h('dd', {}, kb(s.size))),
    s.firstPrompt && s.firstPrompt !== s.title ? h('div', {}, h('h3', {}, 'Began with'), h('p', { class: 'quote' }, s.firstPrompt)) : null,
    action,
    pr.current ? null : h('p', { class: 'none' }, 'Chats from other folders continue in that folder’s own UltraClaude window.'),
  ].filter(Boolean));
}

function openFolderButton(dir, name) {
  return h('button', { type: 'button', class: 'btn primary', onclick: guard(async () => {
    await api('POST', '/api/open-project', { dir });
    toast(`Opening ${name} in a new UltraClaude window`);
  }) }, 'Open folder in UltraClaude');
}

function renderFolderDetail(n) {
  if (!n) return $('mapDetail').replaceChildren(h('p', { class: 'none' }, 'Pick a dot to see that chat or folder.'));
  const below = chatsBelow(n);
  const here = samePath(n.path, S.project?.dir);
  $('mapDetail').replaceChildren(...[
    h('h2', {}, n.virtual ? 'This computer' : n.name),
    n.virtual ? null : h('dl', {}, h('dt', {}, 'Folder'), h('dd', { class: 'mono' }, n.path), h('dt', {}, 'Chats'), h('dd', {}, below ? `${below} in here and below` : 'none'), h('dt', {}, 'Subfolders'), h('dd', {}, n.loaded ? String(n.kids.size) : 'not opened yet')),
    n.chats.length ? h('div', {}, h('h3', {}, 'Chats in this folder'), h('ul', { class: 'map-list' }, n.chats.map((c) => h('li', {}, h('a', { onclick: () => { chatPick = { key: c.pr.key, id: c.s.id }; renderMap(); } }, c.s.title))))) : null,
    n.unreadable ? h('p', { class: 'none' }, 'Windows does not allow reading this folder.') : null,
    n.virtual ? null : here ? h('p', { class: 'none' }, 'This window already belongs to this folder.') : openFolderButton(n.path, n.name),
  ].filter(Boolean));
}

function openAgent(id) {
  S.sel = id;
  S.grid = false;
  setView('agents');
  terms.get(id)?.term.focus();
}

// ---------- sidebar ----------

const rows = new Map(); // agent id -> roster row

function syncSide() {
  for (const b of $('nav').children) b.classList.toggle('active', b.dataset.view === S.view);
  $('mapBtn').classList.toggle('active', S.view === 'map');
  setText($('navTasks'), String(S.tasks.filter((t) => t.status !== 'done').length || ''));
  setText($('navNotes'), String(S.noteCount || ''));
  for (const [id, r] of rows) if (!agentBy(id)) { r.wrap.remove(); rows.delete(id); }
  for (const a of S.agents) {
    let r = rows.get(a.id);
    if (!r) {
      r = { dot: h('i'), nm: h('span', { class: 'nm' }), st: h('span', { class: 'st' }), act: h('span', { class: 'act' }) };
      r.el = h('button', { type: 'button', onclick: () => openAgent(a.id) }, r.dot, r.nm, r.st, r.act);
      r.pick = h('input', { type: 'checkbox', class: 'pick', 'aria-label': `Select ${a.name}`, onchange: (ev) => togglePick(a.id, ev.target.checked) });
      r.wrap = h('div', { class: 'arow' }, r.pick, r.el);
      rows.set(a.id, r);
      $('roster').append(r.wrap);
    }
    setAttr(r.el, 'class', `agent ${a.state}${S.view === 'agents' && !S.grid && S.sel === a.id ? ' active' : ''}`);
    setAttr(r.el, 'title', [a.roleName !== a.name ? a.roleName : '', busy(a) ? a.statusText : '', a.activity].filter(Boolean).join(' · ') || a.name);
    setAttr(r.dot, 'class', `dot ${a.state}`);
    setText(r.nm, a.name);
    setText(r.st, STATE[a.state]);
    setText(r.act, busy(a) ? a.activity || a.statusText : '');
  }
  $('rosterEmpty').hidden = S.agents.length > 0;
  $('gridBtn').hidden = S.agents.length < 2;
  $('gridBtn').classList.toggle('active', S.view === 'agents' && S.grid);
  syncSelBar();
}

// ---------- choosing agents ----------

/** Whether an agent's terminal is part of the "All terminals" view right now. */
const inGrid = (a) => (S.only ? S.only.has(a.id) : !S.hidden.has(a.id));
const pickedAgents = () => S.agents.filter((a) => S.picked.has(a.id));

function syncSelBar() {
  const n = S.picked.size;
  $('selBar').hidden = n === 0;
  $('roster').classList.toggle('picking', n > 0);
  setText($('selCount'), `${n} selected`);
  for (const [id, r] of rows) {
    const on = S.picked.has(id);
    if (r.pick.checked !== on) r.pick.checked = on;
    r.wrap.classList.toggle('picked', on);
  }
}

function togglePick(id, on) {
  if (on) S.picked.add(id); else S.picked.delete(id);
  syncSelBar();
}

function openTogether() {
  const list = pickedAgents();
  if (list.length === 1) return openAgent(list[0].id);
  S.only = new Set(list.map((a) => a.id));
  S.grid = true;
  setView('agents');
}

const stopPicked = guard(async () => {
  await Promise.all(pickedAgents().filter((a) => a.state !== 'stopped').map((a) => api('POST', `/api/agents/${a.id}/stop`, {})));
});

const removePicked = guard(async () => {
  const list = pickedAgents();
  if (!list.length) return;
  const what = list.length === 1 ? `agent “${list[0].name}”` : `${list.length} agents`;
  if (!confirm(`Remove ${what}? Their sessions will be ended.`)) return;
  S.picked.clear();
  await Promise.all(list.map((a) => api('DELETE', `/api/agents/${a.id}`)));
});

/** The "−" button in All terminals: takes one terminal out of that view without stopping the agent. */
function hideFromGrid(id) {
  if (S.only) S.only.delete(id); else S.hidden.add(id);
  layoutTerms();
}

function syncGridBar() {
  const shown = S.agents.filter(inGrid).length;
  const partial = S.view === 'agents' && S.grid && shown < S.agents.length;
  $('gridBar').hidden = !partial;
  if (partial) setText($('gridBarText'), shown ? `Showing ${shown} of ${S.agents.length} terminals` : 'All terminals are hidden');
}

/** Earlier Claude Code sessions of this folder; a click continues one as an agent. */
function renderSessions() {
  const shown = S.allSessions ? S.sessions : S.sessions.slice(0, 5);
  $('sessionsBox').hidden = !S.sessions.length;
  $('startSessions').hidden = !S.sessions.length;
  $('sessions').replaceChildren(...shown.map((s) => h('button', {
    type: 'button', class: 'session', title: `${s.firstPrompt || s.title}\n\nClick to continue this session here.`, onclick: () => createAgent({ sessionId: s.id }),
  }, h('span', { class: 'nm' }, s.title), h('span', { class: 'when' }, ago(s.updated)))));
  $('sessionsMore').hidden = S.sessions.length <= 5;
  setText($('sessionsMore'), S.allSessions ? 'Show fewer' : `Show all ${S.sessions.length}`);
}

function syncSummary() {
  const count = (state) => S.agents.filter((a) => a.state === state).length;
  const waiting = count('waiting');
  const parts = [[count('working'), 'working'], [waiting, 'needs you', 'warn'], [count('idle'), 'idle'], [count('starting'), 'starting'], [count('stopped'), 'stopped']]
    .filter(([n]) => n).map(([n, label, cls]) => h('span', { class: cls || '' }, `${n} ${label}`));
  const out = S.agents.length ? [plural(S.agents.length, 'agent')] : [];
  for (const p of parts) out.push(' · ', p);
  $('summary').replaceChildren(...out);
  document.title = `${waiting ? `(${waiting}) ` : ''}${S.project?.name || ''} · UltraClaude`;
}

// ---------- overview graph ----------

const pos = new Map(); // agent id -> { x, y }
const gnodes = new Map(); // agent id -> svg parts
let hub = { x: 0, y: 0 };
let hubCount;
let graphSig = '';

function syncGraph() {
  const any = S.agents.length > 0;
  $('start').hidden = any;
  $('graph').style.visibility = any ? 'visible' : 'hidden';
  if (S.view !== 'overview' || !any) return;
  const w = $('stage').clientWidth;
  const ht = $('stage').clientHeight;
  if (!w || !ht) return;
  const sig = `${w}x${ht}:${S.agents.map((a) => a.id).join()}`;
  if (sig !== graphSig) { buildGraph(w, ht); graphSig = sig; }
  for (const a of S.agents) updateNode(a);
  setText(hubCount, plural(S.noteCount, 'note'));
}

function buildGraph(w, ht) {
  const compact = w < 640;
  const n = S.agents.length;
  hub = { x: Math.round(w / 2), y: Math.round(ht / 2) };
  const rx = Math.max(70, Math.min(w / 2 - (compact ? 120 : 225), 330));
  const ry = Math.max(70, Math.min(ht / 2 - 90, 200, rx * 1.2)); // never much taller than wide
  pos.clear();
  gnodes.clear();
  const links = [];
  const nodes = [];
  S.agents.forEach((a, i) => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const p = { x: Math.round(hub.x + cos * rx), y: Math.round(hub.y + sin * ry) };
    pos.set(a.id, p);
    links.push(svg('line', { class: 'g-link', x1: p.x, y1: p.y, x2: hub.x, y2: hub.y }));
    // labels sit on the outer side of the node so they never cross a link
    const side = Math.abs(cos) > 0.4 ? (cos > 0 ? 'right' : 'left') : sin > 0 ? 'bottom' : 'top';
    const anchor = side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle';
    const nd = { side, compact, title: svg('title'), nm: svg('text', { class: 'nm', 'text-anchor': anchor }), what: svg('text', { class: 'what', 'text-anchor': anchor }), now: svg('text', { class: 'now', 'text-anchor': anchor }) };
    nd.g = svg('g', { transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button' }, nd.title, svg('circle', { class: 'hit', r: 18 }), svg('circle', { class: 'mark', r: 6 }), nd.nm, nd.what, nd.now);
    nd.g.addEventListener('click', () => openAgent(a.id));
    nd.g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openAgent(a.id); } });
    gnodes.set(a.id, nd);
    nodes.push(nd.g);
  });
  hubCount = svg('text', { class: 'count', y: 14 });
  const hubG = svg('g', { class: 'g-hub', transform: `translate(${hub.x},${hub.y})`, tabindex: 0, role: 'button' },
    svg('title', {}, 'Shared memory'), svg('rect', { x: -50, y: -22, width: 100, height: 44, rx: 4 }), svg('text', { class: 'nm', y: -3 }, 'Memory'), hubCount);
  hubG.addEventListener('click', () => setView('memory'));
  hubG.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setView('memory'); } });
  const g = $('graph');
  g.setAttribute('viewBox', `0 0 ${w} ${ht}`);
  g.replaceChildren(...links, svg('g', { id: 'pulses' }), hubG, ...nodes);
}

function updateNode(a) {
  const nd = gnodes.get(a.id);
  if (!nd) return;
  setAttr(nd.g, 'class', `g-node ${a.state}`);
  const lines = [[nd.nm, cut(a.name, 26)]];
  if (!nd.compact) {
    if (busy(a) && a.statusText) lines.push([nd.what, cut(a.statusText, 36)]);
    lines.push([nd.now, a.state === 'working' ? cut(a.activity || 'working', 30) : STATE[a.state]]);
  }
  for (const el of [nd.what, nd.now]) if (!lines.some(([used]) => used === el)) setText(el, '');
  const lineHeight = 17;
  lines.forEach(([el, text], i) => {
    let x = 0;
    let y;
    if (nd.side === 'right' || nd.side === 'left') { x = nd.side === 'right' ? 16 : -16; y = (i - (lines.length - 1) / 2) * lineHeight + 4; }
    else if (nd.side === 'bottom') y = 27 + i * lineHeight;
    else y = -17 - (lines.length - 1 - i) * lineHeight;
    setText(el, text);
    setAttr(el, 'x', x);
    setAttr(el, 'y', y);
  });
  setText(nd.title, [a.name, a.roleName !== a.name ? a.roleName : '', STATE[a.state], a.activity].filter(Boolean).join(' · '));
}

function fly(from, to, trace) {
  const layer = $('pulses');
  if (!layer) return;
  const done = (el) => () => el.remove();
  if (trace) {
    const line = svg('line', { class: 'g-trace', x1: from.x, y1: from.y, x2: to.x, y2: to.y });
    layer.append(line);
    line.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 1500 }).finished.then(done(line), done(line));
  }
  const dot = svg('circle', { class: 'g-pulse', r: 3.5 });
  layer.append(dot);
  dot.animate([{ transform: `translate(${from.x}px,${from.y}px)` }, { transform: `translate(${to.x}px,${to.y}px)` }],
    { duration: 750, easing: 'cubic-bezier(.4,0,.2,1)' }).finished.then(done(dot), done(dot));
}

function ping(at, cls = '') {
  const layer = $('pulses');
  if (!layer) return;
  const ring = svg('circle', { class: `g-ping ${cls}`, r: 6 });
  layer.append(ring);
  const move = `translate(${at.x}px,${at.y}px)`;
  ring.animate([{ transform: `${move} scale(1)`, opacity: 1 }, { transform: `${move} scale(3.4)`, opacity: 0 }],
    { duration: 900, easing: 'ease-out' }).finished.then(() => ring.remove(), () => ring.remove());
}

/** Shows an event in the graph: memory access runs along the spoke, messages between the two agents. */
function animate(e) {
  if (S.view !== 'overview' || calm || document.hidden) return;
  const at = (name) => pos.get(agentBy(name)?.id);
  const me = at(e.agent);
  if (e.type === 'memory' && me) return e.op === 'write' ? fly(me, hub) : fly(hub, me);
  if ((e.type === 'notify' || e.type === 'waiting') && me) return ping(me, 'warn');
  if (e.type !== 'message') return;
  const targets = e.to === 'all' ? S.agents.filter((a) => a.name !== e.agent).map((a) => pos.get(a.id)) : [at(e.to)];
  for (const t of targets.filter(Boolean)) { if (me) fly(me, t, true); else ping(t); }
}

// ---------- activity feed ----------

function feedItem(e) {
  const who = h('b', {}, e.agent === 'user' ? 'You' : e.agent);
  if (e.type === 'message' || e.type === 'notify') {
    const to = e.to === 'all' ? 'everyone' : e.to === 'user' ? 'you' : e.to;
    return h('li', { class: `ev-${e.type}` }, h('time', {}, clock(e.ts)), h('div', {}, who, ' → ', h('b', {}, to), h('p', {}, e.text)));
  }
  return h('li', { class: `ev-${e.type}` }, h('time', {}, clock(e.ts)), h('div', {}, who, ' ', e.text));
}

function addEvent(e) {
  const feed = $('feed');
  const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  feed.append(feedItem(e));
  while (feed.children.length > 300) feed.firstChild.remove();
  if (stick) feed.scrollTop = feed.scrollHeight;
}

function syncSelects() {
  const fill = (el, first) => {
    const keep = el.value;
    el.replaceChildren(h('option', { value: first[0] }, first[1]), ...S.agents.map((a) => h('option', { value: a.name }, a.name)));
    if ([...el.options].some((o) => o.value === keep)) el.value = keep;
  };
  fill($('msgTo'), ['all', 'Everyone']);
  fill($('taskAssignee'), ['', 'Unassigned']);
}

// ---------- terminals ----------

const terms = new Map(); // agent id -> { term, fit, pane, ... }
const pendingReplay = new Map(); // terminal output that arrived before we knew the agent

function ensureTerm(a) {
  if (terms.has(a.id)) return terms.get(a.id);
  const term = new Terminal({
    fontFamily: '"Cascadia Mono", Consolas, "IBM Plex Mono", monospace', fontSize: 13, cursorBlink: true, scrollback: 5000, allowProposedApi: true,
    theme: { background: '#0a0b0d', foreground: '#e7e9eb', cursor: '#e7e9eb', selectionBackground: '#373d44' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.onData((d) => ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'in', id: a.id, d })));
  term.attachCustomKeyEventHandler((ev) => terminalKeys(ev, term, a.id));
  term.onResize(({ cols, rows: r }) => ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'resize', id: a.id, cols, rows: r })));
  const t = { term, fit, opened: false, dot: h('i'), nm: h('span', { class: 'nm' }), meta: h('span', { class: 'meta' }) };
  t.toggle = h('button', { type: 'button', class: 'link', onclick: guard(() => {
    const now = agentBy(a.id);
    return api('POST', `/api/agents/${a.id}/${now.state === 'stopped' ? 'start' : 'stop'}`, { cols: term.cols, rows: term.rows });
  }) });
  const remove = h('button', { type: 'button', class: 'link', onclick: guard(async () => {
    if (confirm(`Remove agent “${agentBy(a.id)?.name}”? Its session will be ended.`)) await api('DELETE', `/api/agents/${a.id}`);
  }) }, 'Remove');
  t.off = h('div', { class: 'pane-off' }, 'Stopped. Start it to continue its session.');
  t.host = h('div', { class: 'term-host' });
  t.body = h('div', { class: 'pane-body' }, t.host, t.off);
  t.hide = h('button', { type: 'button', class: 'link hide', title: 'Hide from All terminals', 'aria-label': 'Hide from All terminals', onclick: () => hideFromGrid(a.id) }, '−');
  t.pane = h('div', { class: 'pane' }, h('div', { class: 'pane-head' }, t.dot, t.nm, t.meta, t.toggle, t.hide, remove), t.body);
  t.body.addEventListener('paste', (ev) => pasteImage(ev, a.id), true); // Ctrl+V with an image on the clipboard
  new ResizeObserver(() => fitTerm(t)).observe(t.host);
  $('terms').append(t.pane);
  terms.set(a.id, t);
  return t;
}

/**
 * Keys that should behave like in Windows Terminal rather than how xterm.js handles them by default.
 * Returning false hands the key back to the browser (so paste and copy happen natively); returning
 * true lets the terminal send it to Claude Code as usual.
 */
function terminalKeys(ev, term, id) {
  if (ev.type !== 'keydown') return true;
  const key = ev.key.toLowerCase();
  const ctrl = ev.ctrlKey && !ev.altKey && !ev.metaKey;
  // Ctrl+V / Ctrl+Shift+V: paste. xterm.js would send ^V and swallow the paste, so neither text nor
  // images arrived. Text now goes in as a normal paste, images through pasteImage().
  if (ctrl && key === 'v') return false;
  // Ctrl+C copies when something is selected, otherwise it interrupts Claude as usual. Ctrl+Shift+C always copies.
  if (ctrl && key === 'c' && (ev.shiftKey || term.hasSelection())) {
    setTimeout(() => term.clearSelection(), 0);
    return false;
  }
  // Shift+Enter / Ctrl+Enter: a new line in the prompt instead of sending it (Claude Code reads ESC CR as that)
  if (ev.key === 'Enter' && (ev.shiftKey || ev.ctrlKey) && !ev.altKey && !ev.metaKey) {
    ev.preventDefault();
    if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'in', id, d: '\x1b\r' }));
    return false;
  }
  return true;
}

/**
 * Ctrl+V with an image (a screenshot, a copied picture) hands it to the agent right away. The image is
 * saved by the server and its path typed into the prompt, which Claude Code shows as "[Image #1]".
 * Text, even next to an image, is pasted as usual.
 */
function pasteImage(ev, id) {
  const data = ev.clipboardData;
  const item = data && [...data.items].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  if (!item || data.types.includes('text/plain')) return;
  const file = item.getAsFile();
  if (!file) return;
  ev.preventDefault();
  ev.stopPropagation();
  fetch(`/api/agents/${id}/paste-image`, { method: 'POST', headers: { 'x-uc-token': TOKEN, 'content-type': file.type }, body: file })
    .then(async (res) => { if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText); })
    .catch((err) => toast(`Could not paste the image: ${err.message}`, 'error'));
}

// Fits are bundled and only run once the box has settled, so a terminal keeps its size
// instead of being resized again and again while the layout is still moving.
function fitTerm(t) {
  clearTimeout(t.fitTimer);
  t.fitTimer = setTimeout(() => {
    if (!t.opened || !t.host.clientWidth || !t.host.clientHeight) return;
    try { t.fit.fit(); } catch { /* not measurable yet */ }
  }, 120);
}

function layoutTerms() {
  $('terms').classList.toggle('grid', S.grid);
  syncGridBar();
  for (const a of S.agents) {
    const t = ensureTerm(a);
    const show = S.grid ? inGrid(a) : S.sel === a.id;
    t.pane.hidden = !show;
    t.hide.hidden = !S.grid;
    if (show && S.view === 'agents') {
      if (!t.opened) { t.term.open(t.host); t.opened = true; }
      requestAnimationFrame(() => fitTerm(t));
    }
  }
}

function syncPanes() {
  for (const a of S.agents) {
    const t = ensureTerm(a);
    setAttr(t.pane, 'class', `pane ${a.state}`);
    setAttr(t.dot, 'class', `dot ${a.state}`);
    setText(t.nm, a.name);
    setText(t.meta, [a.roleName !== a.name ? a.roleName : '', STATE[a.state], busy(a) ? a.activity || a.statusText : ''].filter(Boolean).join(' · '));
    setText(t.toggle, a.state === 'stopped' ? 'Start' : 'Stop');
    t.off.hidden = a.state !== 'stopped';
  }
}

function flushReplay() {
  for (const a of S.agents) {
    const d = pendingReplay.get(a.id);
    if (d) { ensureTerm(a).term.write(d); pendingReplay.delete(a.id); }
  }
}

// ---------- tasks ----------

const COLUMNS = [['todo', 'Open'], ['in_progress', 'In progress'], ['done', 'Done']];

function renderTasks() {
  $('board').replaceChildren(...COLUMNS.map(([status, label]) => {
    const items = S.tasks.filter((t) => t.status === status);
    const col = h('div', { class: 'col' }, h('header', {}, h('h2', {}, label), h('span', { class: 'num' }, String(items.length))),
      h('div', { class: 'list' }, items.length ? items.map((t) => {
        const assign = h('select', { 'aria-label': 'Assigned to', onchange: guard((ev) => api('PATCH', `/api/tasks/${t.id}`, { assignee: ev.target.value })) },
          h('option', { value: '' }, 'Unassigned'), S.agents.map((a) => h('option', { value: a.name }, a.name)));
        assign.value = agentBy(t.assignee) ? t.assignee : '';
        const move = h('select', { 'aria-label': 'Status', onchange: guard((ev) => api('PATCH', `/api/tasks/${t.id}`, { status: ev.target.value })) },
          COLUMNS.map(([value, text]) => h('option', { value }, text)));
        move.value = t.status;
        return h('div', { class: 'task', draggable: 'true', ondragstart: (ev) => ev.dataTransfer.setData('text/plain', String(t.id)) },
          h('div', { class: 't' }, h('span', { class: 'id' }, `#${t.id}`), t.title),
          t.description ? h('div', { class: 'd' }, t.description) : null,
          h('footer', {}, assign, move, h('button', { type: 'button', class: 'link', onclick: guard(() => api('DELETE', `/api/tasks/${t.id}`)) }, 'Delete')));
      }) : h('p', { class: 'none' }, status === 'todo' ? 'Nothing open.' : '—')));
    col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', (ev) => { if (!col.contains(ev.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', guard(async (ev) => {
      ev.preventDefault();
      col.classList.remove('over');
      const id = ev.dataTransfer.getData('text/plain');
      if (id) await api('PATCH', `/api/tasks/${id}`, { status });
    }));
    return col;
  }));
}

// ---------- memory ----------

// The vault's real folder structure on the left; on the right a note to read and edit, a folder,
// or the editor for a new note.
let vaultInfo;
const nodeAt = (nodes, p) => { for (const n of nodes) { if (n.path === p) return n; const hit = n.children && nodeAt(n.children, p); if (hit) return hit; } return null; };
const filesIn = (nodes) => nodes.flatMap((n) => (n.type === 'dir' ? filesIn(n.children) : [n]));
const foldersIn = (nodes) => nodes.flatMap((n) => (n.type === 'dir' ? [n, ...foldersIn(n.children)] : []));
const parentOf = (p) => p.split('/').slice(0, -1).join('/');
const baseName = (p) => p.split('/').pop().replace(/\.md$/i, '');

async function loadNotes() {
  try {
    const [t, notes] = await Promise.all([api('GET', '/api/tree'), api('GET', '/api/notes')]);
    Object.assign(S, { tree: t.tree, projectRel: t.project, notes });
  } catch { return; }
  if (!S.openSeeded) {
    S.openSeeded = true;
    for (const p of ['Projects', S.projectRel, `${S.projectRel}/Memory`, 'Global']) S.open.add(p);
  }
  S.noteCount = S.notes.filter((n) => ['Memory', 'Global', 'Claude Code'].includes(n.kind)).length;
  renderNotes();
  syncSide();
  // what is shown on the right may have been moved or deleted meanwhile, by you or an agent
  if (!S.editing && ((S.note && !nodeAt(S.tree, S.note)) || (S.folder && !nodeAt(S.tree, S.folder)))) showVaultInfo();
}

function renderNotes() {
  const q = $('noteFilter').value.trim().toLowerCase();
  if (q) {
    const text = new Map(S.notes.map((n) => [n.path, `${n.excerpt} ${n.tags.join(' ')}`.toLowerCase()]));
    const hits = filesIn(S.tree).filter((f) => f.path.toLowerCase().includes(q) || text.get(f.path)?.includes(q));
    $('noteList').replaceChildren(...(hits.length ? hits.map((f) => fileRow(f, 0, true)) : [h('p', { class: 'none' }, 'No matches.')]));
    return;
  }
  const rows = treeRows(S.tree, 0);
  $('noteList').replaceChildren(...(rows.length ? rows : [h('p', { class: 'none' }, 'The vault is empty.')]));
}

const indent = (depth) => `padding-left:${8 + depth * 14}px`;
const treeRows = (nodes, depth) => nodes.flatMap((n) => (n.type === 'dir'
  ? [dirRow(n, depth), ...(S.open.has(n.path) ? treeRows(n.children, depth + 1) : [])]
  : [fileRow(n, depth)]));

function dirRow(n, depth) {
  const open = S.open.has(n.path);
  const count = filesIn(n.children).length;
  return h('button', {
    type: 'button', class: `tnode dir${S.folder === n.path ? ' active' : ''}`, style: indent(depth), title: n.path, 'aria-expanded': String(open),
    onclick: () => { if (open && S.folder === n.path) S.open.delete(n.path); else S.open.add(n.path); showFolder(n.path); },
  }, h('span', { class: 'caret' }, open ? '▾' : '▸'), h('span', { class: 'nm' }, n.name), h('span', { class: 'cnt' }, count ? String(count) : ''));
}

function fileRow(n, depth, withFolder = false) {
  return h('button', { type: 'button', class: `tnode note${S.note === n.path ? ' active' : ''}`, style: indent(depth), title: n.path, onclick: () => openNote(n.path) },
    h('span', { class: 'caret' }), h('span', { class: 'fn' }, h('b', {}, n.name), withFolder ? h('span', { class: 'sub' }, parentOf(n.path) || 'Vault') : null));
}

function showVaultInfo() {
  Object.assign(S, { note: null, folder: null, editing: false });
  $('noteView').replaceChildren(vaultInfo);
  renderNotes();
}

async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast(`Could not copy the ${what.toLowerCase()}`, 'error'); }
}
const fullPath = (rel) => {
  const root = S.project.vault;
  const sep = root.includes('\\') ? '\\' : '/';
  return rel ? `${root}${sep}${rel.split('/').join(sep)}` : root;
};

/** Lets the person type a new path for a note or folder: rename and move in one. */
function renameForm(item, isFile) {
  const input = h('input', { value: isFile ? item.replace(/\.md$/i, '') : item, 'aria-label': 'New name and folder', spellcheck: 'false' });
  const save = guard(async () => {
    const r = await api('POST', '/api/file/move', { from: item, to: input.value.trim() });
    await loadNotes();
    if (isFile) openNote(r.path); else { S.open.add(r.path); showFolder(r.path); }
  });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); if (ev.key === 'Escape') form.replaceWith(form.backup); });
  const form = h('div', { class: 'inline-form' }, input, h('button', { type: 'button', class: 'btn', onclick: save }, 'Save'),
    h('button', { type: 'button', class: 'link', onclick: () => form.replaceWith(form.backup) }, 'Cancel'));
  return form;
}

function showFolder(p) {
  const n = nodeAt(S.tree, p);
  if (!n) return showVaultInfo();
  Object.assign(S, { folder: p, note: null, editing: false });
  const files = n.children.filter((c) => c.type === 'file');
  const actions = h('div', { class: 'note-actions' },
    n.readOnly ? null : h('button', { type: 'button', class: 'link', onclick: () => newNote(p) }, 'New note here'),
    n.readOnly ? null : h('button', { type: 'button', class: 'link', onclick: () => newFolder(p) }, 'New folder here'),
    n.readOnly ? null : h('button', { type: 'button', class: 'link', onclick: () => { const f = renameForm(p, false); f.backup = actions; actions.replaceWith(f); f.querySelector('input').focus(); } }, 'Rename or move'),
    h('button', { type: 'button', class: 'link', onclick: () => copyText(fullPath(p), 'Path') }, 'Copy path'),
    n.readOnly || n.children.length ? null : h('button', { type: 'button', class: 'link danger', onclick: guard(async () => {
      if (!confirm(`Delete the empty folder “${n.name}”?`)) return;
      await api('DELETE', `/api/file?path=${encodeURIComponent(p)}`);
      await loadNotes();
      p.includes('/') ? showFolder(parentOf(p)) : showVaultInfo();
    }) }, 'Delete'));
  $('noteView').replaceChildren(
    h('div', { class: 'note-meta' }, h('button', { type: 'button', class: 'link', onclick: showVaultInfo }, '← Memory'), h('span', {}, p)),
    actions,
    h('div', { class: 'doc' },
      h('h1', {}, n.name),
      n.readOnly ? h('p', { class: 'hint' }, 'UltraClaude keeps this folder up to date itself. You can read and copy what is here.') : null,
      h('p', {}, `${plural(files.length, 'note')}, ${plural(n.children.length - files.length, 'folder')}.`),
      files.length ? h('ul', {}, files.map((f) => h('li', {}, h('a', { onclick: () => openNote(f.path) }, f.name)))) : null));
  $('noteView').scrollTop = 0;
  renderNotes();
}

/** The editor, for a new note (folder given) or an existing one (path and its current text given). */
function showEditor({ folder = null, path = null, content = '' }) {
  S.editing = true;
  const isNew = !path;
  const folders = foldersIn(S.tree).filter((d) => !d.readOnly);
  const where = isNew ? h('select', { 'aria-label': 'Folder' }, h('option', { value: '' }, 'Vault (top level)'), folders.map((d) => h('option', { value: d.path }, d.path))) : null;
  if (where) where.value = folders.some((d) => d.path === folder) ? folder : '';
  const name = isNew ? h('input', { placeholder: 'Name of the note', 'aria-label': 'Name of the note', spellcheck: 'false' }) : null;
  const text = h('textarea', { spellcheck: 'false', 'aria-label': 'Note text', placeholder: 'What should every agent know? Markdown works, and [[Note name]] links to another note.' });
  text.value = content;
  const original = content;
  const close = () => { S.editing = false; if (isNew) (folder ? showFolder(folder) : showVaultInfo()); else openNote(path); };
  const save = guard(async () => {
    if (isNew) {
      const title = name.value.trim();
      if (!title) { name.focus(); return toast('Give the note a name.', 'waiting'); }
      const r = await api('POST', '/api/file', { path: where.value ? `${where.value}/${title}` : title, content: text.value.trim() ? text.value : `# ${title}\n` });
      S.editing = false;
      S.open.add(parentOf(r.path));
      await loadNotes();
      return openNote(r.path);
    }
    await api('PUT', '/api/file', { path, content: text.value });
    S.editing = false;
    await loadNotes();
    openNote(path);
  });
  const cancel = () => { if (text.value !== original && !confirm('Discard your changes?')) return; close(); };
  text.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); }
    if (ev.key === 'Escape') cancel();
  });
  $('noteView').replaceChildren(h('div', { class: 'editor' },
    h('div', { class: 'note-meta' }, h('span', {}, isNew ? 'New note' : `Editing ${path}`), h('span', {}, 'Ctrl+S saves · Esc cancels')),
    isNew ? h('div', { class: 'row' }, where, name) : null,
    text,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: save }, 'Save'), h('button', { type: 'button', class: 'btn', onclick: cancel }, 'Cancel'))));
  (isNew ? name : text).focus();
  renderNotes();
}

const newNote = (folder) => showEditor({ folder: folder ?? S.folder ?? (S.note ? parentOf(S.note) : `${S.projectRel}/Memory`) });

function newFolder(inFolder) {
  const parent = inFolder ?? S.folder ?? (S.note ? parentOf(S.note) : `${S.projectRel}/Memory`);
  const input = h('input', { placeholder: 'Name of the new folder', 'aria-label': 'Name of the new folder', spellcheck: 'false' });
  const save = guard(async () => {
    const r = await api('POST', '/api/folder', { path: parent ? `${parent}/${input.value.trim()}` : input.value.trim() });
    S.open.add(parent);
    S.open.add(r.path);
    await loadNotes();
    showFolder(r.path);
  });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); if (ev.key === 'Escape') showFolder(parent); });
  Object.assign(S, { folder: parent, note: null, editing: false });
  $('noteView').replaceChildren(h('div', { class: 'editor' },
    h('div', { class: 'note-meta' }, h('span', {}, `New folder in ${parent || 'the vault'}`)),
    h('div', { class: 'row' }, input, h('button', { type: 'button', class: 'btn primary', onclick: save }, 'Create'), h('button', { type: 'button', class: 'link', onclick: () => (parent ? showFolder(parent) : showVaultInfo()) }, 'Cancel'))));
  input.focus();
  renderNotes();
}

function inline(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|`([^`]+)`/g)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(m[3] ? h('code', {}, m[3]) : h('a', { onclick: () => openNote(m[1]) }, m[2] || m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function markdown(src) {
  const out = [];
  let list = null;
  let code = null;
  for (const line of src.split(/\r?\n/)) {
    if (line.trimStart().startsWith('```')) {
      if (code) { out.push(h('pre', {}, code.join('\n'))); code = null; } else code = [];
      list = null;
      continue;
    }
    if (code) { code.push(line); continue; }
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (head) { out.push(h(`h${Math.min(3, head[1].length + 1)}`, {}, inline(head[2]))); list = null; }
    else if (item || num) {
      const tag = item ? 'ul' : 'ol';
      if (list?.tagName.toLowerCase() !== tag) { list = h(tag); out.push(list); }
      list.append(h('li', {}, inline((item || num)[1])));
    }
    else if (line.trim()) { out.push(h('p', {}, inline(line))); list = null; }
    else list = null;
  }
  if (code) out.push(h('pre', {}, code.join('\n')));
  return out;
}

const openNote = guard(async (ref) => {
  const n = await api('GET', `/api/note?path=${encodeURIComponent(ref)}`);
  Object.assign(S, { note: n.path, folder: null, editing: false });
  for (let p = parentOf(n.path); p; p = parentOf(p)) S.open.add(p); // show where it lives
  const readOnly = nodeAt(S.tree, n.path)?.readOnly;
  const actions = h('div', { class: 'note-actions' },
    readOnly ? null : h('button', { type: 'button', class: 'link', onclick: guard(async () => showEditor({ path: n.path, content: (await api('GET', `/api/file?path=${encodeURIComponent(n.path)}`)).content })) }, 'Edit'),
    readOnly ? null : h('button', { type: 'button', class: 'link', onclick: () => { const f = renameForm(n.path, true); f.backup = actions; actions.replaceWith(f); f.querySelector('input').focus(); } }, 'Rename or move'),
    h('button', { type: 'button', class: 'link', onclick: guard(async () => {
      const r = await api('POST', '/api/file/copy', readOnly ? { from: n.path, to: `${S.projectRel}/Memory/${baseName(n.path)}` } : { from: n.path });
      await loadNotes();
      openNote(r.path);
    }) }, readOnly ? 'Copy into Memory' : 'Duplicate'),
    h('button', { type: 'button', class: 'link', onclick: () => copyText(n.body, 'Text') }, 'Copy text'),
    h('button', { type: 'button', class: 'link', onclick: () => copyText(fullPath(n.path), 'Path') }, 'Copy path'),
    h('button', { type: 'button', class: 'link', onclick: () => openInObsidian(n.path) }, 'Open in Obsidian'),
    readOnly ? null : h('button', { type: 'button', class: 'link danger', onclick: guard(async () => {
      if (!confirm(`Delete “${n.title}”? This cannot be undone.`)) return;
      await api('DELETE', `/api/file?path=${encodeURIComponent(n.path)}`);
      await loadNotes();
      showFolder(parentOf(n.path));
    }) }, 'Delete'));
  $('noteView').replaceChildren(...[
    h('div', { class: 'note-meta' },
      h('button', { type: 'button', class: 'link', onclick: showVaultInfo }, '← Memory'),
      h('span', {}, n.path), h('span', {}, `updated ${n.updated}`),
      n.authors.length ? h('span', {}, `by ${n.authors.join(', ')}`) : null,
      n.tags.length ? h('span', {}, n.tags.map((t) => `#${t}`).join(' ')) : null),
    actions,
    readOnly ? h('p', { class: 'hint' }, 'UltraClaude keeps this note up to date itself. To change it, copy it into Memory first.') : null,
    h('div', { class: 'doc' }, h('h1', {}, n.title), markdown(n.body)),
  ].filter(Boolean));
  $('noteView').scrollTop = 0;
  renderNotes();
});

const openInObsidian = guard(async (path) => {
  const { known } = await api('POST', '/api/open-obsidian', path ? { path } : {});
  if (!known) toast('Obsidian does not know this vault yet. In Obsidian choose “Open folder as vault” and pick the folder that just opened.', 'waiting');
});

// ---------- new agent ----------

function roleButton(r, onclick) {
  return h('button', { type: 'button', class: 'role', 'data-role': r.id, onclick }, h('b', {}, r.name), h('span', {}, r.blurb));
}

function selectRole(id) {
  const before = S.roles.find((r) => r.id === S.role);
  const role = S.roles.find((r) => r.id === id);
  S.role = id;
  for (const b of $('roleGrid').children) b.classList.toggle('selected', b.dataset.role === id);
  const name = $('fName');
  name.setCustomValidity('');
  if (!name.value || name.value === before?.name) name.value = id === 'custom' ? '' : role.name;
  name.placeholder = id === 'custom' ? 'e.g. Database expert' : role.name;
  $('fInstructions').placeholder = id === 'custom' ? 'Describe what this agent should do.' : 'e.g. Only work on the frontend.';
}

const createAgent = guard(async (body) => {
  const a = await api('POST', '/api/agents', body);
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  // Show its terminal right away: a first start may ask to trust the folder there.
  if (agentBy(a.id)) openAgent(a.id); else S.want = a.id;
});

// ---------- live updates ----------

let agentSig = null;

function onAgents(agents) {
  S.agents = agents;
  const alive = new Set(agents.map((a) => a.id));
  for (const set of [S.picked, S.hidden, S.only]) if (set) for (const id of set) if (!alive.has(id)) set.delete(id);
  const sig = agents.map((a) => `${a.id}:${a.name}`).join('|');
  if (!agentBy(S.sel)) S.sel = agents[0]?.id || null;
  if (sig !== agentSig) {
    agentSig = sig;
    for (const [id, t] of terms) if (!agentBy(id)) { t.term.dispose(); t.pane.remove(); terms.delete(id); }
    syncSelects();
    renderTasks();
    flushReplay();
    if (S.view === 'agents') { if (agents.length) layoutTerms(); else setView('overview'); }
  }
  syncPanes();
  syncSide();
  syncSummary();
  syncGraph();
  if (S.want && agentBy(S.want)) { const id = S.want; S.want = null; openAgent(id); }
}

function onEvent(e) {
  addEvent(e);
  animate(e);
  const jump = () => { const a = agentBy(e.agent); if (a) openAgent(a.id); };
  const notify = (title) => {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body: e.text });
  };
  if (e.type === 'waiting') { toast(`${e.agent} ${e.text}`, 'waiting', jump); notify(`${e.agent} needs you`); }
  else if (e.type === 'notify') { toast(`${e.agent}: ${e.text}`, 'waiting', jump); notify(`Message from ${e.agent}`); }
  else if (e.type === 'error') toast(`${e.agent} ${e.text}`, 'error');
}

async function loadState() {
  const st = await api('GET', '/api/state');
  Object.assign(S, { project: st.project, roles: st.roles, tasks: st.tasks, noteCount: st.notes, sessions: st.sessions });
  // The window always loads the newest interface, the server keeps the code it started with.
  const outdated = !st.version || st.version !== st.latest;
  $('updateBar').hidden = !outdated;
  $('updateBtn').hidden = !st.version;
  setText($('updateText'), st.version
    ? 'UltraClaude was updated. Restart to use the new version. Running agents continue their sessions.'
    : 'The UltraClaude server for this folder is older than this window. Run “ultraclaude” in this folder to update it.');
  renderSessions();
  setText($('projectName'), S.project.name);
  $('projectName').title = S.project.dir;
  setText($('vaultPath'), S.project.vault);
  $('vaultPath').title = S.project.vault;
  $('obsidianHint').hidden = S.project.inObsidian;
  $('quickRoles').replaceChildren(...S.roles.filter((r) => r.id !== 'custom').map((r) => roleButton(r, () => createAgent({ roleId: r.id }))));
  $('roleGrid').replaceChildren(...S.roles.map((r) => roleButton(r, () => selectRole(r.id))));
  $('feed').replaceChildren();
  for (const e of st.events) addEvent(e);
  agentSig = null;
  onAgents(st.agents);
}

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws?t=${TOKEN}`);
  ws.onopen = guard(async () => {
    $('conn').classList.add('on');
    setText($('connText'), 'connected');
    await loadState();
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'out') terms.get(m.id)?.term.write(m.d);
    else if (m.t === 'replay') {
      const t = terms.get(m.id);
      if (t) { t.term.reset(); t.term.write(m.d); } else pendingReplay.set(m.id, m.d);
    } else if (m.t === 'agents') onAgents(m.agents);
    else if (m.t === 'tasks') { S.tasks = m.tasks; renderTasks(); syncSide(); }
    else if (m.t === 'event') onEvent(m.e);
    else if (m.t === 'sessions') { S.sessions = m.sessions; renderSessions(); }
    else if (m.t === 'notes') { S.noteCount = m.count; syncSide(); syncGraph(); if (S.view === 'memory') loadNotes(); } // keeps an open editor as it is
  };
  ws.onclose = () => {
    if (halted) return;
    $('conn').classList.remove('on');
    setText($('connText'), 'reconnecting');
    setTimeout(connect, 1500);
  };
}

function halt(title, text) {
  halted = true;
  stageObserver.disconnect();
  if (ws) { ws.onmessage = null; ws.close(); }
  document.body.replaceChildren(h('div', { class: 'halt' }, h('h1', {}, title), h('p', {}, text)));
}

// ---------- wiring ----------

$('nav').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
$('showTools').addEventListener('change', (ev) => $('feed').classList.toggle('hide-tools', !ev.target.checked));
$('gridBtn').addEventListener('click', () => {
  S.grid = !(S.view === 'agents' && S.grid);
  if (S.grid) S.only = null; // "All terminals" means all, except the ones hidden with "−"
  setView('agents');
});
$('gridShowAll').addEventListener('click', () => { S.only = null; S.hidden.clear(); layoutTerms(); });
$('selOpen').addEventListener('click', openTogether);
$('selStop').addEventListener('click', stopPicked);
$('selRemove').addEventListener('click', removePicked);
$('selClear').addEventListener('click', () => { S.picked.clear(); syncSelBar(); });
$('mapBtn').addEventListener('click', () => setView('map'));
$('updateBtn').addEventListener('click', guard(async () => {
  await api('POST', '/api/restart', {});
  halt('Restarting UltraClaude', 'The new version opens in a new window in a moment. You can close this one.');
}));
$('mapFilter').addEventListener('input', renderMap);
{
  // map: the wheel zooms around the pointer, dragging moves the map (a drag never counts as a click)
  const stage = $('mapStage');
  let drag = null;
  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0015));
  }, { passive: false });
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !mapView || ev.target.closest('.map-zoom')) return;
    drag = { x: ev.clientX, y: ev.clientY, vx: mapView.x, vy: mapView.y };
    mapDragged = false;
  });
  window.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!mapDragged && Math.hypot(dx, dy) < 4) return;
    mapDragged = true;
    stage.classList.add('dragging');
    mapView.x = drag.vx + dx;
    mapView.y = drag.vy + dy;
    applyView();
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    stage.classList.remove('dragging');
    setTimeout(() => { mapDragged = false; }, 0);
  });
  const middle = () => [stage.clientWidth / 2, stage.clientHeight / 2];
  $('mapZoomIn').addEventListener('click', () => zoomAt(...middle(), 1.4));
  $('mapZoomOut').addEventListener('click', () => zoomAt(...middle(), 1 / 1.4));
  $('mapFit').addEventListener('click', () => { mapView = null; applyView(); });
  new ResizeObserver(() => { if (S.view === 'map') applyView(); }).observe(stage);
}
$('noteFilter').addEventListener('input', renderNotes);
$('sessionsMore').addEventListener('click', () => { S.allSessions = !S.allSessions; renderSessions(); });
$('openObsidian').addEventListener('click', () => openInObsidian(S.note)); // the open note, or the project folder
$('openFolder').addEventListener('click', guard(() => api('POST', '/api/open-vault-folder', {})));
$('newNote').addEventListener('click', () => newNote());
$('newFolder').addEventListener('click', () => newFolder());
$('addAgent').addEventListener('click', () => {
  $('agentForm').reset();
  $('fName').setCustomValidity('');
  selectRole(S.role);
  $('agentDialog').showModal();
});
$('agentCancel').addEventListener('click', () => $('agentDialog').close());
$('fName').addEventListener('input', () => $('fName').setCustomValidity(''));
$('agentForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (S.role === 'custom' && !$('fName').value.trim()) {
    $('fName').setCustomValidity('Give the custom role a name.');
    $('fName').reportValidity();
    return;
  }
  $('agentDialog').close();
  createAgent({
    roleId: S.role, name: $('fName').value.trim(), instructions: $('fInstructions').value, prompt: $('fPrompt').value.trim(),
    model: $('fModel').value, permissionMode: $('fPerm').value, worktree: $('fWorktree').checked,
  });
});
$('msgForm').addEventListener('submit', guard(async (ev) => {
  ev.preventDefault();
  const text = $('msgText').value.trim();
  if (!text) return;
  await api('POST', '/api/message', { to: $('msgTo').value, text });
  $('msgText').value = '';
}));
$('taskForm').addEventListener('submit', guard(async (ev) => {
  ev.preventDefault();
  await api('POST', '/api/tasks', { title: $('taskTitle').value, assignee: $('taskAssignee').value });
  $('taskTitle').value = '';
}));
$('quit').addEventListener('click', guard(async () => {
  if (!confirm('Stop all agents and quit UltraClaude for this project?')) return;
  await api('POST', '/api/shutdown', {});
  halt('UltraClaude has stopped', 'Run “ultraclaude” in your project folder to start it again. You can close this window.');
}));
const stageObserver = new ResizeObserver(() => syncGraph());
stageObserver.observe($('stage'));

vaultInfo = $('vaultInfo');
if (TOKEN) connect();
else halt('Start UltraClaude from your terminal', 'Go to your project folder and run “ultraclaude”.');
