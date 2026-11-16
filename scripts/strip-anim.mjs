// Build-time: turn Meshy's per-animation GLBs (each a full ~8 MB mesh + one
// clip) into tiny clip-only GLBs (bones + animation, no mesh/texture), so the
// overlay bundles ONE full mesh (idle) plus a few small clips that play on its
// skeleton. Run: node scripts/strip-anim.mjs <srcDir>
import { NodeIO } from "@gltf-transform/core";
import { prune } from "@gltf-transform/functions";
import { cpSync } from "node:fs";
import { resolve } from "node:path";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/strip-anim.mjs <srcDir>"); process.exit(2); }
const pub = resolve("public");
const io = new NodeIO();

async function clipCount(path) {
  return (await io.read(path)).getRoot().listAnimations().length;
}

async function strip(inFile, outFile) {
  const doc = await io.read(resolve(src, inFile));
  const root = doc.getRoot();
  // Detach then drop meshes + skins; prune removes orphaned materials, textures
  // and mesh accessors, leaving only the bone nodes and the animation.
  for (const node of root.listNodes()) {
    if (node.getMesh()) node.setMesh(null);
    if (node.getSkin()) node.setSkin(null);
  }
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  await doc.transform(prune());
  await io.write(resolve(pub, outFile), doc);
}

// idle.glb keeps its mesh + idle clip , it's the base model.
cpSync(resolve(src, "idle.glb"), resolve(pub, "pet3d.glb"));
await strip("combat.glb", "anim_combat.glb");
await strip("victory.glb", "anim_victory.glb");
await strip("look.glb", "anim_look.glb");

for (const f of ["pet3d.glb", "anim_combat.glb", "anim_victory.glb", "anim_look.glb"]) {
  console.log(`${f}: ${await clipCount(resolve(pub, f))} clip(s)`);
}
