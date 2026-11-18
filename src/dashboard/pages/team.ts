// Team: start an UltraClaude agent team for a project and work with it right
// here. The frame stays mounted while you visit other pages, so terminals and
// scroll positions are kept.
import { mount } from "../atoms/h";
import { card } from "../molecules/card";
import { empty } from "../molecules/empty";
import { toast } from "../molecules/toast";
import { teamLauncher } from "../organisms/team-launcher";
import { teamFrame } from "../organisms/team-frame";
import { currentFolder, openTeam, runningTeam, stopTeam, folderName } from "../services/team";
import type { DashPage } from "./page";

let root: HTMLElement;
let shownFolder: string | null = null;
let shownUrl = "";

function launcher(error = "") {
  shownFolder = null;
  root.classList.remove("full");
  mount(root, teamLauncher(start, error));
}

function frame(folder: string, url: string) {
  shownFolder = folder;
  shownUrl = url;
  root.classList.add("full");
  mount(root, teamFrame(folder, url, {
    onSwitch: () => launcher(),
    onStop: async () => {
      try {
        await stopTeam(folder);
        toast(`Team for ${folderName(folder)} stopped`, "info");
      } catch (e) {
        toast(String(e), "bad");
      }
      launcher();
    },
  }));
}

async function start(folder: string) {
  mount(root, card({ title: "Starting the team…", icon: "team" },
    empty(`Starting the team engine for ${folder}. The first start takes a few seconds.`, { icon: "team" })));
  try {
    frame(folder, await openTeam(folder));
  } catch (e) {
    launcher(String(e));
  }
}

/** Show the team that is still running from last time, if any. */
async function restore() {
  const folder = currentFolder();
  if (!folder || shownFolder === folder) return;
  const url = await runningTeam(folder);
  if (url) frame(folder, url);
}

/** The engine stops itself a minute after its window lost the connection (the
 *  laptop slept, say): then the frame only says "Failed to fetch". Start it again. */
async function revive() {
  const folder = shownFolder;
  if (!folder) return;
  const url = await runningTeam(folder).catch(() => null);
  if (folder === shownFolder && url !== shownUrl) await start(folder);
}

// back at the window after sleep or another app: check the team is still there
window.addEventListener("focus", () => { if (document.body.dataset.page === "team") void revive(); });

export const teamPage: DashPage = {
  id: "team",
  mount(el) {
    root = el;
    launcher();
  },
  show() {
    if (shownFolder) return void revive();
    launcher(); // fresh suggestions: agents may have started since
    void restore();
  },
};

