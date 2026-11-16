// Shared memory: a plain Obsidian vault (markdown files with frontmatter and [[wikilinks]]).
// The server is the only writer, so parallel agents never clobber each other's notes.
import fs from 'node:fs';
import path from 'node:path';

const BAD = /[\\/:*?"<>|#^[\]]/g;
const pad = (n) => String(n).padStart(2, '0');

export const safeName = (s) =>
  String(s ?? '').replace(BAD, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/, '').slice(0, 80) || 'Untitled';
export const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const clock = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const stamp = (d = new Date()) => `${day(d)} ${clock(d)}`;

export function parseNote(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const meta = {};
  if (!m) return { meta, body: raw };
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length).replace(/^\r?\n/, '') };
}

const parseList = (v) => String(v ?? '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
const cleanTags = (tags) =>
  [...new Set((Array.isArray(tags) ? tags : parseList(tags)).map((t) => String(t).replace(/^#/, '').trim().replace(/[\s,[\]]+/g, '-')).filter(Boolean))];
const front = (meta) =>
  '---\n' + Object.entries(meta).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join('\n') + '\n---\n\n';

/** Folders UltraClaude rewrites on its own: the agent notes, the board and the mirror of Claude Code's memory. */
const READ_ONLY = /^Projects\/[^/]+\/(Agents|Tasks|Claude Code)(\/|$)/;

/** The kinds of notes that count as knowledge: what agents search and what the note counter shows. */
export const KNOWLEDGE = ['Memory', 'Global', 'Claude Code'];
const SESSIONS_NOTE = 'Earlier sessions.md';

export class Vault {
  constructor(root, project) {
    this.root = path.resolve(root);
    this.project = safeName(project);
    this.projectDir = path.join(this.root, 'Projects', this.project);
    this.memoryDir = path.join(this.projectDir, 'Memory');
    this.globalDir = path.join(this.root, 'Global');
    this.importDir = path.join(this.projectDir, 'Claude Code'); // mirror of what Claude Code saved itself
  }

  /**
   * Mirrors Claude Code's own memory notes for this folder into the vault, plus a list of the
   * sessions that ran here. One way only: the folder is rewritten from the source every time.
   * Returns true when something changed.
   */
  mirror(files, sessions) {
    let changed = false;
    const keep = new Set(files.map((f) => f.name));
    if (sessions.length) keep.add(SESSIONS_NOTE);
    if (fs.existsSync(this.importDir)) {
      for (const name of fs.readdirSync(this.importDir)) {
        if (!keep.has(name)) { fs.rmSync(path.join(this.importDir, name), { force: true }); changed = true; }
      }
    }
    if (!keep.size) return changed;
    fs.mkdirSync(this.importDir, { recursive: true });
    for (const f of files) {
      const dest = path.join(this.importDir, f.name);
      if (!fs.existsSync(dest) || fs.statSync(dest).mtimeMs < f.mtimeMs) { fs.copyFileSync(f.file, dest); changed = true; }
    }
    if (sessions.length) {
      const dest = path.join(this.importDir, SESSIONS_NOTE);
      const lines = sessions.slice(0, 40).map((s) => `- ${day(new Date(s.updated))} · **${s.title}**${s.firstPrompt && s.firstPrompt !== s.title ? ` — began with: “${s.firstPrompt}”` : ''}`);
      const text = `# Earlier sessions\n\nClaude Code sessions that ran in this folder before or next to UltraClaude. Open one from the UltraClaude sidebar to continue it.\n\n${lines.join('\n')}\n`;
      if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== text) { fs.writeFileSync(dest, text); changed = true; }
    }
    return changed;
  }

  ensure(projectPath = '') {
    for (const d of [this.memoryDir, this.globalDir, path.join(this.projectDir, 'Agents'), path.join(this.projectDir, 'Log'), path.join(this.projectDir, 'Tasks'), path.join(this.root, '.obsidian')]) {
      fs.mkdirSync(d, { recursive: true });
    }
    const home = path.join(this.root, 'Home.md');
    if (!fs.existsSync(home)) {
      fs.writeFileSync(home, '# UltraClaude Vault\n\nShared memory of all UltraClaude agents.\n\n- `Projects/<name>/Memory` — knowledge per project\n- `Global` — knowledge that applies to every project\n- `Projects/<name>/Log` — what the agents did, day by day\n');
    }
    const hub = path.join(this.projectDir, `${this.project}.md`);
    if (!fs.existsSync(hub)) {
      fs.writeFileSync(hub, `# ${this.project}\n\nProject folder: \`${projectPath}\`\n\n- Tasks: [[${this.project} Board]]\n- Knowledge: \`Memory/\`\n- Team: \`Agents/\`\n- Journal: \`Log/\`\n`);
    }
  }

  rel(abs) { return path.relative(this.root, abs).split(path.sep).join('/'); }

  abs(rel) {
    const p = path.resolve(this.root, String(rel));
    if (p !== this.root && !p.startsWith(this.root + path.sep)) throw new Error('Path is outside the vault');
    return p;
  }

  // ---------- files and folders, as the person sees them in the Memory view ----------

  /** A vault-relative path the person typed, checked and normalised. Notes always end in .md. */
  #clean(ref, file = false) {
    let rel = String(ref ?? '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
    const bad = (s) => !s || s !== s.trim() || s === '.' || s === '..' || s.startsWith('.') || /[<>:"|?*\x00-\x1f]/.test(s);
    if (!rel || rel.split('/').some(bad)) throw new Error('That name cannot be used. Leave out < > : " | ? * and do not start a name with a dot.');
    if (file && !/\.md$/i.test(rel)) rel += '.md';
    this.abs(rel); // throws when the path leads outside the vault
    return rel;
  }

  #writable(rel) {
    if (READ_ONLY.test(rel)) throw new Error('UltraClaude keeps this folder up to date itself, so changes here would be overwritten. Duplicate the note into another folder to change it.');
  }

  /** The whole vault as folders and notes, folders first. Hidden folders (like .obsidian) are left out. */
  tree() {
    const walk = (abs, rel) => fs.readdirSync(abs, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) return { type: 'dir', name: e.name, path: p, readOnly: READ_ONLY.test(p), children: walk(path.join(abs, e.name), p) };
        if (e.name.toLowerCase().endsWith('.md')) return { type: 'file', name: e.name.slice(0, -3), path: p, readOnly: READ_ONLY.test(p) };
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1));
    return walk(this.root, '');
  }

  readRaw(ref) {
    const rel = this.#clean(ref, true);
    const abs = this.abs(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('That note does not exist any more.');
    return { path: rel, content: fs.readFileSync(abs, 'utf8'), readOnly: READ_ONLY.test(rel) };
  }

  /** Creates (create: true) or overwrites a note with exactly the text given, keeping its frontmatter current. */
  saveRaw(ref, content, { create = false, author = 'user' } = {}) {
    const rel = this.#clean(ref, true);
    this.#writable(rel);
    const abs = this.abs(rel);
    const exists = fs.existsSync(abs);
    if (create && exists) throw new Error(`There is already a note called “${path.basename(rel, '.md')}” in that folder.`);
    if (!create && !exists) throw new Error('That note does not exist any more.');
    let text = String(content ?? '');
    const now = stamp();
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (m) {
      const lines = m[1].split(/\r?\n/).map((l) => (l.startsWith('updated:') ? `updated: ${now}` : l));
      text = `---\n${lines.join('\n')}\n---\n${text.slice(m[0].length)}`;
    } else if (create) {
      text = front({ created: now, updated: now, authors: [author] }) + text.replace(/^\s+/, '');
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    return { path: rel };
  }

  makeFolder(ref) {
    const rel = this.#clean(ref);
    this.#writable(rel);
    if (fs.existsSync(this.abs(rel))) throw new Error('A folder or note with that name already exists.');
    fs.mkdirSync(this.abs(rel), { recursive: true });
    return { path: rel };
  }

  /** Renames or moves a note or a folder. */
  move(from, to) {
    const src = this.#clean(from);
    const isFile = fs.existsSync(this.abs(src)) && fs.statSync(this.abs(src)).isFile();
    if (!fs.existsSync(this.abs(src))) throw new Error('That note or folder does not exist any more.');
    const dest = this.#clean(to, isFile);
    this.#writable(src);
    this.#writable(dest);
    if (src === dest) return { path: dest };
    if (!isFile && (dest + '/').startsWith(src + '/')) throw new Error('A folder cannot be moved into itself.');
    if (fs.existsSync(this.abs(dest)) && src.toLowerCase() !== dest.toLowerCase()) throw new Error('Something with that name already exists there.');
    fs.mkdirSync(path.dirname(this.abs(dest)), { recursive: true });
    fs.renameSync(this.abs(src), this.abs(dest));
    return { path: dest };
  }

  /** Copies a note. Without a target it goes next to the original as "<name> copy". */
  copy(from, to) {
    const src = this.#clean(from, true);
    if (!fs.existsSync(this.abs(src))) throw new Error('That note does not exist any more.');
    let dest = to ? this.#clean(to, true) : null;
    if (!dest) {
      const base = src.slice(0, -3);
      dest = `${base} copy.md`;
      for (let i = 2; fs.existsSync(this.abs(dest)); i++) dest = `${base} copy ${i}.md`;
    }
    this.#writable(dest);
    if (fs.existsSync(this.abs(dest))) throw new Error('Something with that name already exists there.');
    fs.mkdirSync(path.dirname(this.abs(dest)), { recursive: true });
    fs.copyFileSync(this.abs(src), this.abs(dest));
    return { path: dest };
  }

  /** Deletes a note, or a folder once it is empty. */
  remove(ref) {
    const rel = this.#clean(ref);
    this.#writable(rel);
    let abs = this.abs(rel);
    if (!fs.existsSync(abs) && fs.existsSync(`${abs}.md`)) abs = `${abs}.md`;
    if (!fs.existsSync(abs)) throw new Error('That note or folder does not exist any more.');
    if (fs.statSync(abs).isDirectory()) {
      if (fs.readdirSync(abs).length) throw new Error('Only empty folders can be deleted. Move or delete what is inside first.');
      fs.rmdirSync(abs);
    } else {
      fs.rmSync(abs);
    }
    return { path: rel };
  }

  write({ title, content = '', tags = [], scope = 'project', author = 'user', mode = 'replace' }) {
    if (!String(title ?? '').trim()) throw new Error('title is required');
    const dir = scope === 'global' ? this.globalDir : this.memoryDir;
    const file = path.join(dir, `${safeName(title)}.md`);
    const now = stamp();
    let meta = { created: now, updated: now, project: scope === 'global' ? 'global' : this.project, authors: [author], tags: cleanTags(tags) };
    let body = String(content).trim() + '\n';
    if (fs.existsSync(file)) {
      const old = parseNote(fs.readFileSync(file, 'utf8'));
      meta = {
        ...meta,
        created: old.meta.created || now,
        authors: [...new Set([...parseList(old.meta.authors), author])],
        tags: cleanTags([...parseList(old.meta.tags), ...cleanTags(tags)]),
      };
      if (mode === 'append') body = `${old.body.trimEnd()}\n\n### ${now} · ${author}\n\n${String(content).trim()}\n`;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, front(meta) + body);
    return { path: this.rel(file), title: safeName(title) };
  }

  #walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) this.#walk(p, out);
      else if (e.name.toLowerCase().endsWith('.md')) out.push(p);
    }
    return out;
  }

  #info(file, withBody = false) {
    const raw = fs.readFileSync(file, 'utf8');
    const { meta, body } = parseNote(raw);
    const rel = this.rel(file);
    const inProject = path.relative(this.projectDir, file);
    let kind = 'Vault';
    if (rel.startsWith('Global/')) kind = 'Global';
    else if (!inProject.startsWith('..')) kind = inProject.includes(path.sep) ? inProject.split(path.sep)[0] : 'Project';
    const info = {
      path: rel,
      title: path.basename(file, '.md'),
      kind,
      tags: parseList(meta.tags),
      authors: parseList(meta.authors),
      updated: meta.updated || stamp(fs.statSync(file).mtime),
      excerpt: body.replace(/\s+/g, ' ').trim().slice(0, 160),
    };
    if (withBody) info.body = body;
    return info;
  }

  /** Notes of this project plus the global ones. `kinds` filters, e.g. ['Memory', 'Global']. */
  list(kinds) {
    const files = [...this.#walk(this.projectDir), ...this.#walk(this.globalDir)];
    const notes = files.map((f) => this.#info(f));
    return (kinds ? notes.filter((n) => kinds.includes(n.kind)) : notes).sort((a, b) => b.updated.localeCompare(a.updated));
  }

  /** Accepts a vault-relative path or a note title. */
  read(ref) {
    const name = String(ref ?? '').trim();
    if (!name) return null;
    const candidates = [];
    try { candidates.push(this.abs(name.endsWith('.md') ? name : `${name}.md`)); } catch { /* outside vault */ }
    const base = safeName(name.replace(/\.md$/i, '').split('/').pop());
    candidates.push(path.join(this.memoryDir, `${base}.md`), path.join(this.globalDir, `${base}.md`), path.join(this.importDir, `${base}.md`));
    let file = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
    if (!file) {
      const hit = this.list().find((n) => n.title.toLowerCase() === base.toLowerCase());
      if (hit) file = this.abs(hit.path);
    }
    return file ? this.#info(file, true) : null;
  }

  search(query, limit = 8) {
    const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits = [];
    for (const file of [...this.#walk(this.memoryDir), ...this.#walk(this.globalDir), ...this.#walk(this.importDir)]) {
      const n = this.#info(file, true);
      const title = n.title.toLowerCase();
      const text = `${n.tags.join(' ')} ${n.body}`.toLowerCase();
      let score = 0;
      let first = -1;
      for (const t of terms) {
        if (title.includes(t)) score += 5;
        if (text.includes(t)) score += Math.min(5, text.split(t).length - 1);
        const i = n.body.toLowerCase().indexOf(t);
        if (i >= 0 && first < 0) first = i;
      }
      if (!score) continue;
      const from = Math.max(0, first - 80);
      hits.push({ path: n.path, title: n.title, kind: n.kind, tags: n.tags, updated: n.updated, score, excerpt: n.body.slice(from, from + 260).replace(/\s+/g, ' ').trim() });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  log(actor, text) {
    const file = path.join(this.projectDir, 'Log', `${day()}.md`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${this.project} — ${day()}\n\n`);
    fs.appendFileSync(file, `- **${clock()}** · ${actor} — ${String(text).replace(/\s+/g, ' ').trim()}\n`);
  }

  writeAgentNote(a) {
    const file = path.join(this.projectDir, 'Agents', `${safeName(a.name)}.md`);
    fs.writeFileSync(file, front({ role: a.roleName, state: a.state, updated: stamp(), project: this.project }) +
      `# ${a.name}\n\n**Role:** ${a.roleName}\n\n**Working on:** ${a.statusText || '—'}\n\n**State:** ${a.state}\n\nProject: [[${this.project}]]\n`);
  }

  removeAgentNote(name) {
    fs.rmSync(path.join(this.projectDir, 'Agents', `${safeName(name)}.md`), { force: true });
  }

  writeBoard(tasks) {
    const col = (status, label) => {
      const items = tasks.filter((t) => t.status === status);
      const lines = items.map((t) => `- [${status === 'done' ? 'x' : ' '}] **#${t.id}** ${t.title}${t.assignee ? ` — [[${safeName(t.assignee)}]]` : ''}${t.description ? `\n  ${t.description.replace(/\s+/g, ' ')}` : ''}`);
      return `## ${label} (${items.length})\n\n${lines.join('\n') || '_empty_'}\n`;
    };
    fs.writeFileSync(path.join(this.projectDir, 'Tasks', `${this.project} Board.md`),
      `# ${this.project} — Board\n\n${col('todo', 'Open')}\n${col('in_progress', 'In progress')}\n${col('done', 'Done')}`);
  }
}
