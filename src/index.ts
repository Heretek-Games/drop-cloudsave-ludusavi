import type {
  CloudSavePathResolver,
  CloudSavePattern,
  GameInstallContext,
  PluginContext,
  ServerPlugin,
} from "@droposs/plugin-sdk";
import {
  type LudusaviManifest,
  type ManifestFetch,
  type SaveEnv,
  LudusaviManifestSource,
  envFromProcess,
  findManifestGame,
  toCloudSavePatterns,
} from "./manifest.js";

export * from "./manifest.js";

export interface ResolverOptions {
  env?: SaveEnv;
  runtimePlatform?: NodeJS.Platform;
}

/** Heuristic fallback used only when a title is absent from the manifest. */
export function resolvePatterns(context: GameInstallContext): CloudSavePattern[] {
  const patterns: CloudSavePattern[] = [
    { pattern: `%APPDATA%/${context.gameTitle}/saves`, platform: "windows", winePrefix: true },
    { pattern: `%LOCALAPPDATA%/${context.gameTitle}`, platform: "windows", winePrefix: true },
    { pattern: `~/.config/${context.gameTitle}`, platform: "linux" },
    { pattern: `~/Library/Application Support/${context.gameTitle}`, platform: "macos" },
  ];
  if (context.installDir) {
    patterns.push({ pattern: `${context.installDir}/saves`, winePrefix: false });
  }
  return patterns;
}

export class LudusaviResolver implements CloudSavePathResolver {
  id = "ludusavi";
  name = "Ludusavi Save Path Resolver";

  constructor(
    private readonly source?: { load(): Promise<LudusaviManifest> },
    private readonly options: ResolverOptions = {},
  ) {}

  async resolveSavePaths(context: GameInstallContext): Promise<CloudSavePattern[]> {
    if (this.source) {
      try {
        const manifest = await this.source.load();
        const game = findManifestGame(manifest, context.gameTitle);
        if (game) {
          const patterns = toCloudSavePatterns(game, {
            env: this.options.env ?? envFromProcess(),
            installDir: context.installDir,
            runtimePlatform: this.options.runtimePlatform,
          });
          if (patterns.length > 0) {
            if (context.installDir) {
              patterns.push({
                pattern: `${context.installDir.replace(/[\\/]+$/, "")}/saves`,
                winePrefix: false,
              });
            }
            return patterns;
          }
        }
      } catch {
        // Manifest unavailable: fall through to the heuristic patterns.
      }
    }
    return resolvePatterns(context);
  }
}

function createManifestSource(ctx: PluginContext): LudusaviManifestSource {
  const fetchFn: ManifestFetch = ctx.fetch.bind(ctx);
  return new LudusaviManifestSource(fetchFn);
}

export default class LudusaviPlugin implements ServerPlugin {
  metadata = {
    id: "drop-cloudsave-ludusavi",
    name: "Ludusavi Cloud Save Resolver",
    version: "0.1.0",
    apiVersion: 2,
    capabilities: ["cloudsave:provider" as const, "network" as const],
  };

  async init(ctx: PluginContext): Promise<void> {
    ctx.registerCloudSaveResolver(
      new LudusaviResolver(createManifestSource(ctx)),
    );
    ctx.logger.info("Ludusavi cloud save resolver registered");
  }
}
