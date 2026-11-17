// The one DOM helper every dashboard component is built with:
//   h("div", { class: "card", onclick: fn }, "text", childNode)
// Children are appended as text nodes, never parsed as HTML, so names coming
// from agents or Home Assistant cannot inject markup. Only the `html` prop
// parses HTML, and it is used for our own static SVG icons only.
//
// mount() does not rebuild: it patches what is on screen to match the new
// tree, so live refreshes never flash, replay animations, lose scroll
// position or steal focus from the field you are typing in.

export type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;
type Handlers = Record<string, (e: Event) => void>;
type WithHandlers = Element & { __on?: Handlers };

// One real listener per event type; the handler itself lives in el.__on, so a
// patch can swap it for the fresh one from the new render.
function dispatch(this: WithHandlers, e: Event) {
  this.__on?.[e.type]?.call(this, e);
}

function listen(el: WithHandlers, type: string, fn: (e: Event) => void) {
  const map = (el.__on ??= {});
  if (!map[type]) el.addEventListener(type, dispatch);
  map[type] = fn;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      listen(el, key.slice(2), value as (e: Event) => void);
    } else if (key === "html") {
      el.innerHTML = String(value);
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
      // reflect form state on the property too (attributes stop applying once a field was used)
      if (key === "checked") (el as HTMLInputElement).checked = true;
      if (key === "value") (el as HTMLInputElement).value = String(value);
    }
  }
  append(el, children);
  return el;
}

/** Make `root` show `children`, changing only what differs. */
export function mount(root: HTMLElement, ...children: Child[]): void {
  const fresh: Node[] = [];
  for (const c of children) {
    if (c == null || c === false) continue;
    fresh.push(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  patchChildren(root, fresh);
}

function append(el: HTMLElement, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== Node.ELEMENT_NODE) return true;
  const x = a as Element, y = b as Element;
  // data-id marks list items: a different id means a different thing, not an edit
  return x.tagName === y.tagName && x.getAttribute("data-id") === y.getAttribute("data-id");
}

function patchChildren(parent: Node, fresh: Node[]) {
  for (let i = 0; i < fresh.length; i++) {
    const want = fresh[i];
    const have = parent.childNodes[i];
    if (have === want) continue;            // a node kept across renders (e.g. a canvas)
    if (!have) parent.appendChild(want);
    else if (sameKind(have, want)) patchNode(have, want);
    else parent.replaceChild(want, have);
  }
  while (parent.childNodes.length > fresh.length) parent.removeChild(parent.lastChild!);
}

function patchNode(have: Node, want: Node) {
  if (have.nodeType !== Node.ELEMENT_NODE) {
    if (have.nodeValue !== want.nodeValue) have.nodeValue = want.nodeValue;
    return;
  }
  const a = have as WithHandlers, b = want as WithHandlers;
  // an armed confirm button keeps its "click again" state until it times out
  if (a.classList.contains("armed")) return;
  for (const { name, value } of [...b.attributes]) {
    if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  }
  for (const { name } of [...a.attributes]) {
    if (!b.hasAttribute(name)) a.removeAttribute(name);
  }
  const field = a as Element;
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
    const typing = field === document.activeElement;
    // sync data-bound values (an explicit value, or a select); never what you are typing
    const bound = b.hasAttribute("value") || want instanceof HTMLSelectElement;
    if (!typing && bound && field.value !== (b as HTMLInputElement).value) field.value = (b as HTMLInputElement).value;
    if (field instanceof HTMLInputElement) field.checked = (b as HTMLInputElement).checked;
    field.disabled = (b as HTMLInputElement).disabled;
  }
  if (field instanceof HTMLButtonElement) field.disabled = (b as HTMLButtonElement).disabled;
  for (const type of Object.keys(b.__on ?? {})) {
    if (!a.__on?.[type]) a.addEventListener(type, dispatch);
  }
  a.__on = b.__on;
  // data-keep: the element owns its children (e.g. a live canvas); refreshes leave them alone
  if (a.hasAttribute("data-keep")) return;
  patchChildren(a, [...b.childNodes]);
}
