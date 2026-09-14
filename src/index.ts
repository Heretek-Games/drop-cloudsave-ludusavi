import type {
  CloudSavePathResolver,
  CloudSavePattern,
  GameInstallContext,
  PluginContext,
  ServerPlugin,
} from "@droposs/plugin-sdk";

/** Default save patterns for a title, including the Proton/UMU prefix. */
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

  async resolveSavePaths(context: GameInstallContext): Promise<CloudSavePattern[]> {
    return resolvePatterns(context);
  }
}

export default class LudusaviPlugin implements ServerPlugin {
  metadata = {
    id: "drop-cloudsave-ludusavi",
    name: "Ludusavi Cloud Save Resolver",
    version: "0.1.0",
    apiVersion: 2,
    capabilities: ["cloudsave:provider" as const],
  };

  async init(ctx: PluginContext): Promise<void> {
    ctx.registerCloudSaveResolver(new LudusaviResolver());
    ctx.logger.info("Ludusavi cloud save resolver registered");
  }
}
