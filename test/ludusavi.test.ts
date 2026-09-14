import test from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import Plugin, { resolvePatterns } from "../src/index.js";

test("drop-cloudsave-ludusavi registers a cloud save resolver", async () => {
  const ctx = new MockPluginContext("drop-cloudsave-ludusavi", ["cloudsave:provider"]);
  await new Plugin().init(ctx);
  assert.equal(ctx.cloudSaveResolvers.size, 1);
  assert.equal(ctx.cloudSaveResolvers.get("ludusavi")?.name, "Ludusavi Save Path Resolver");
});

test("resolvePatterns includes the wine prefix and install dir", () => {
  const patterns = resolvePatterns({ gameId: "g", gameTitle: "Hollow Knight", installDir: "/games/hk" });
  assert.ok(patterns.some((p) => p.winePrefix === true));
  assert.ok(patterns.some((p) => p.pattern === "/games/hk/saves"));
});
