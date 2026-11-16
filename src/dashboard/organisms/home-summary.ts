// The Overview's Home card: who is home, the door and the internet in a few
// lines, or a button to connect Home Assistant.
import { h } from "../atoms/h";
import { pill } from "../atoms/badge";
import { button } from "../atoms/button";
import { card } from "../molecules/card";
import { empty } from "../molecules/empty";
import { ha, haConfig } from "../services/home-assistant";
import * as model from "../services/home-model";

export function homeSummary(goTo: (page: string) => void): HTMLElement {
  if (!haConfig()) {
    return card({ title: "Home", icon: "home" },
      empty("Connect Home Assistant to see who is home, your door and your internet.", {
        icon: "home",
        action: button("Connect Home Assistant", () => goTo("home"), { variant: "primary", icon: "plug" }),
      }));
  }
  if (ha.status !== "online") {
    return card({ title: "Home", icon: "home", aside: pill(ha.status, ha.status === "error" ? "bad" : "info") },
      empty(ha.error || "Connecting to Home Assistant…", { icon: "home" }));
  }
  const list = ha.entities();
  const people = model.peopleHome(list);
  const lock = model.locks(list)[0];
  const net = model.internet(list);
  return card(
    { title: "Home", icon: "home", aside: button("Open", () => goTo("home")) },
    h("div", { class: "summary-lines" },
      h("div", null, h("span", { class: "muted" }, "Home "),
        people.length ? h("b", null, people.map(model.nameOf).join(", ")) : h("span", null, "nobody")),
      lock ? h("div", null, h("span", { class: "muted" }, `${model.nameOf(lock)} `), pill(lock.state, lock.state === "locked" ? "ok" : "warn")) : null,
      net.online !== undefined || net.download
        ? h("div", null, h("span", { class: "muted" }, "Internet "),
            pill(net.online === false ? "offline" : "online", net.online === false ? "bad" : "ok"),
            net.download ? h("span", { class: "muted" }, ` ↓ ${net.download}`) : null)
        : null,
    ),
  );
}
