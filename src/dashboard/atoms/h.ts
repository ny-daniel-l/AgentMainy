// The one DOM helper every dashboard component is built with:
//   h("div", { class: "card", onclick: fn }, "text", childNode)
// Children are appended as text nodes, never parsed as HTML, so names coming
// from agents or Home Assistant cannot inject markup. Only the `html` prop
// parses HTML, and it is used for our own static SVG icons only.

export type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "html") {
      el.innerHTML = String(value);
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, children);
  return el;
}

/** Replace everything inside `root` with `children`. */
export function mount(root: HTMLElement, ...children: Child[]): void {
  root.replaceChildren();
  append(root, children);
}

function append(el: HTMLElement, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}
