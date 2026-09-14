import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MockPluginContext } from "@droposs/plugin-sdk";
import Plugin, {
  type ManifestFetch,
  type SaveEnv,
  LudusaviManifestSource,
  LudusaviResolver,
  envFromProcess,
  expandPattern,
  findManifestGame,
  parseManifest,
  patternPlatforms,
  resolvePatterns,
  toCloudSavePatterns,
} from "../src/index.js";

const FIXTURE = fileURLToPath(
  new URL("../../test/fixtures/manifest.yaml", import.meta.url),
);

const fixtureText = readFileSync(FIXTURE, "utf8");

const ENV: SaveEnv = {
  home: "/home/steam",
  osUserName: "steam",
  winLocalAppData: "C:\\Users\\steam\\AppData\\Local",
  winAppData: "C:\\Users\\steam\\AppData\\Roaming",
};

test("drop-cloudsave-ludusavi registers a cloud save resolver", async () => {
  const ctx = new MockPluginContext("drop-cloudsave-ludusavi", [
    "cloudsave:provider",
    "network",
  ]);
  await new Plugin().init(ctx);
  assert.equal(ctx.cloudSaveResolvers.size, 1);
  assert.equal(
    ctx.cloudSaveResolvers.get("ludusavi")?.name,
    "Ludusavi Save Path Resolver",
  );
});

test("parseManifest reads files, tags, platform conditions, and registry keys", () => {
  const manifest = parseManifest(fixtureText);
  const hollow = findManifestGame(manifest, "Hollow Knight");
  assert.ok(hollow);
  assert.equal(hollow.files.length, 2);
  assert.deepEqual(hollow.files[0].tags, ["save"]);
  assert.deepEqual(patternPlatforms(hollow.files[0]), ["windows"]);
  assert.deepEqual(patternPlatforms(hollow.files[1]), ["linux"]);
  assert.deepEqual(hollow.registry, [
    "HKEY_CURRENT_USER/Software/Team Cherry/Hollow Knight",
  ]);

  const legacy = findManifestGame(manifest, "legacy game");
  assert.ok(legacy, "case-insensitive lookup should find Legacy Game");
  assert.deepEqual(legacy.files.map((file) => file.pattern), [
    "<home>/.legacy/save",
    "<base>/profile",
  ]);
  assert.deepEqual(legacy.registry, ["HKEY_CURRENT_USER/Software/Legacy/Game"]);

  assert.equal(parseManifest("").size, 0);
  assert.throws(() => parseManifest("not: [valid"));
});

test("expandPattern resolves placeholders and skips unresolvable ones", () => {
  assert.equal(
    expandPattern("<winLocalAppData>/Hollow Knight", ENV),
    "C:\\Users\\steam\\AppData\\Local/Hollow Knight",
  );
  assert.equal(
    expandPattern("<home>/.config/<osUserName>", ENV),
    "/home/steam/.config/steam",
  );
  assert.equal(expandPattern("<base>/profile", ENV, "/games/legacy"), "/games/legacy/profile");
  assert.equal(expandPattern("<base>/profile", ENV), null);
  assert.equal(expandPattern("<storeUserId>/saves", ENV), null);
  assert.equal(
    expandPattern("<storeUserId>/saves", { ...ENV, storeUserId: "76561198" }),
    "76561198/saves",
  );
});

test("toCloudSavePatterns maps manifest entries with platform hints", () => {
  const manifest = parseManifest(fixtureText);
  const hollow = findManifestGame(manifest, "Hollow Knight")!;
  const patterns = toCloudSavePatterns(hollow, {
    env: ENV,
    installDir: "/games/hk",
    runtimePlatform: "linux",
  });
  assert.deepEqual(patterns, [
    {
      pattern: "C:\\Users\\steam\\AppData\\Local/Hollow Knight",
      platform: "windows",
      winePrefix: true,
    },
    {
      pattern: "/home/steam/.config/unity3d/Team Cherry/Hollow Knight",
      platform: "linux",
    },
  ]);

  const registryOnly = findManifestGame(manifest, "Registry Only")!;
  assert.deepEqual(
    toCloudSavePatterns(registryOnly, { env: ENV, runtimePlatform: "linux" }),
    [],
  );
});

test("LudusaviResolver prefers manifest paths over heuristics", async () => {
  const source = { load: async () => parseManifest(fixtureText) };
  const resolver = new LudusaviResolver(source, {
    env: ENV,
    runtimePlatform: "linux",
  });
  const patterns = await resolver.resolveSavePaths({
    gameId: "g",
    gameTitle: "Hollow Knight",
    installDir: "/games/hk",
  });
  assert.ok(
    patterns.some(
      (entry) =>
        entry.pattern ===
          "C:\\Users\\steam\\AppData\\Local/Hollow Knight" &&
        entry.platform === "windows" &&
        entry.winePrefix === true,
    ),
  );
  assert.ok(
    patterns.some(
      (entry) =>
        entry.pattern ===
          "/home/steam/.config/unity3d/Team Cherry/Hollow Knight" &&
        entry.platform === "linux",
    ),
  );
  assert.ok(patterns.some((entry) => entry.pattern === "/games/hk/saves"));
});

test("LudusaviResolver falls back to heuristics for unknown or failed manifests", async () => {
  const resolver = new LudusaviResolver(
    { load: async () => parseManifest(fixtureText) },
    { env: ENV, runtimePlatform: "linux" },
  );
  const unknown = await resolver.resolveSavePaths({
    gameId: "g",
    gameTitle: "Some Unlisted Game",
    installDir: "/games/u",
  });
  assert.deepEqual(
    unknown,
    resolvePatterns({ gameId: "g", gameTitle: "Some Unlisted Game", installDir: "/games/u" }),
  );

  const failing = new LudusaviResolver(
    {
      load: async () => {
        throw new Error("offline");
      },
    },
    { env: ENV, runtimePlatform: "linux" },
  );
  const fallback = await failing.resolveSavePaths({
    gameId: "g",
    gameTitle: "Hollow Knight",
    installDir: "/games/hk",
  });
  assert.ok(fallback.some((entry) => entry.pattern === "/games/hk/saves"));
});

test("LudusaviManifestSource caches results and retries after failures", async () => {
  let calls = 0;
  let healthy = true;
  const fetchFn: ManifestFetch = async () => {
    calls += 1;
    if (!healthy) {
      return { ok: false, status: 503 } as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => fixtureText,
    } as Response;
  };

  const source = new LudusaviManifestSource(fetchFn, "https://example.test/m.yaml");
  const first = await source.load();
  const second = await source.load();
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.ok(first.has("Hollow Knight"));

  healthy = false;
  const failing = new LudusaviManifestSource(fetchFn, "https://example.test/m.yaml");
  await assert.rejects(() => failing.load(), /HTTP 503/);
  healthy = true;
  const manifest = await failing.load();
  assert.ok(manifest instanceof Map);
  assert.ok(manifest.has("Hollow Knight"));
});

test("envFromProcess derives Windows and XDG locations", () => {
  const env = envFromProcess({
    HOME: "/home/steam",
    XDG_CONFIG_HOME: "/home/steam/.config",
    APPDATA: "C:\\Users\\steam\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\steam\\AppData\\Local",
    USERPROFILE: "C:\\Users\\steam",
  });
  assert.equal(env.home, "/home/steam");
  assert.equal(env.winAppData, "C:\\Users\\steam\\AppData\\Roaming");
  assert.equal(env.winDocuments, "C:\\Users\\steam\\Documents");
  assert.equal(env.xdgConfig, "/home/steam/.config");
  assert.equal(env.xdgData, "/home/steam/.local/share");
});
