// Home: your Home Assistant at a glance. First visit asks for the address and
// a long-lived access token; after that the cards update live.
import { h, mount } from "../atoms/h";
import { pill } from "../atoms/badge";
import { button } from "../atoms/button";
import { card } from "../molecules/card";
import { empty } from "../molecules/empty";
import { homeBoard } from "../organisms/home-board";
import { ha, haConfig, saveHaConfig, normalizeUrl } from "../services/home-assistant";
import { scheduler, type DashPage } from "./page";

let root: HTMLElement;
let visible = false;

function connectForm(error = "") {
  const url = h("input", { class: "field", type: "text", placeholder: "http://homeassistant.local:8123", value: haConfig()?.url ?? "", spellcheck: "false", "aria-label": "Home Assistant address" });
  const token = h("input", { class: "field", type: "password", placeholder: "Long-lived access token", autocomplete: "off", "aria-label": "Access token" });
  const go = button("Connect", async () => {
    const cfg = { url: normalizeUrl(url.value), token: token.value.trim() };
    if (!url.value.trim() || !cfg.token) return connectForm("Enter the address and a token.");
    go.disabled = true;
    try {
      await ha.connect(cfg);
      saveHaConfig(cfg);
      render();
    } catch (e) {
      ha.disconnect();
      connectForm((e as Error).message);
    }
  }, { variant: "primary", icon: "plug" });
  mount(root, h("div", { class: "grid" },
    card({ title: "Connect Home Assistant", icon: "home", wide: true, cls: "card-hero" },
      h("p", { class: "lead" }, "See who is home, lock or unlock the door, check the internet and your appliances, and start timers."),
      h("div", { class: "form" },
        h("label", null, h("span", null, "Address"), url),
        h("label", null, h("span", null, "Token"), token),
        go,
      ),
      error ? h("div", { class: "form-error", role: "alert" }, error) : null,
      h("p", { class: "muted small" },
        "Create a token in Home Assistant: your profile → Security → Long-lived access tokens → Create token. ",
        "It is stored on this computer only and sent to your Home Assistant only."),
    ),
  ));
}

function render() {
  // Live updates must not wipe an open connect form (and its error message).
  if (!haConfig()) return root.querySelector(".form") ? undefined : connectForm();
  if (ha.status !== "online" && !ha.entities().length) {
    return mount(root, card({ title: "Home Assistant", icon: "home", aside: pill(ha.status, ha.status === "error" ? "bad" : "info") },
      empty(ha.error || "Connecting…", { icon: "home", action: button("Change connection", forget) })));
  }
  mount(root,
    h("div", { class: "grid" }, ...homeBoard(ha.entities())),
    h("div", { class: "page-foot" },
      pill(ha.status === "online" ? "live" : ha.status, ha.status === "online" ? "ok" : "warn"),
      h("span", { class: "muted" }, haConfig()!.url),
      button("Disconnect", forget),
    ),
  );
}

function forget() {
  ha.disconnect();
  saveHaConfig(null);
  connectForm();
}

const queue = scheduler(render, () => visible);

export const homePage: DashPage = {
  id: "home",
  mount(el) {
    root = el;
    ha.onChange(queue);
    const cfg = haConfig();
    if (cfg) ha.connect(cfg).catch(() => {}); // keeps retrying in the background
    render();
  },
  show() {
    visible = true;
    render();
  },
  hide() {
    visible = false;
  },
};
