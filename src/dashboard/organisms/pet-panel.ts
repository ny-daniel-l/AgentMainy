// The pet at a glance: name, level, stage, XP to the next level and hunger.
// Read-only: it shows the care engine's numbers and never changes them.
import { h } from "../atoms/h";
import { pill, type Tone } from "../atoms/badge";
import { button } from "../atoms/button";
import { card } from "../molecules/card";
import { meter } from "../molecules/meter";
import { empty } from "../molecules/empty";
import * as care from "../../pet/care";
import { savedSlug, petDisplayName, getLibrary } from "../../pet/catalog";
import { t } from "../../shared/i18n";

const HUNGER_TONE: Record<care.Hunger, Tone> = { full: "ok", satisfied: "ok", peckish: "info", hungry: "warn", starving: "bad" };

function petName(slug: string): string {
  const custom = petDisplayName(slug);
  if (custom !== slug) return custom;
  return getLibrary().find((p) => p.slug === slug)?.name || slug;
}

export function petPanel(goTo: (page: string) => void): HTMLElement {
  const slug = savedSlug();
  if (!slug) {
    return card({ title: "Pet", icon: "pet" },
      empty("No pet picked yet.", { icon: "pet", action: button("Choose a pet", () => goTo("pet"), { variant: "primary" }) }));
  }
  const s = care.stateFor(slug);
  const level = care.displayLevel(s.xp);
  const stage = t(care.stageName(care.levelForXP(s.xp)));
  const hunger = care.hunger(s);
  const toNext = care.tokensToNextLevel(s);
  return card(
    { title: "Pet", icon: "pet", aside: pill(t(hunger), HUNGER_TONE[hunger]) },
    h("div", { class: "pet-hero" },
      h("div", { class: "pet-level" }, h("span", null, t("Lv")), h("b", null, String(level))),
      h("div", { class: "pet-meta" },
        h("div", { class: "pet-name" }, petName(slug)),
        h("div", { class: "muted" }, `${stage} · ${s.streakDays}-day streak`),
      ),
    ),
    meter(care.levelProgress(s.xp), toNext > 0 ? `${s.xp} XP · ≈ ${toNext.toLocaleString()} tokens to next level` : `${s.xp} XP`),
    h("div", { class: "pet-foot" },
      h("span", null, h("b", null, s.tokensToday.toLocaleString()), " tokens today"),
      h("span", null, h("b", null, String(s.mealsToday)), " sessions"),
      button("Care", () => goTo("care"), { title: "Open the Care page" }),
    ),
  );
}
