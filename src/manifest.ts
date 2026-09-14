import { parse as parseYaml } from "yaml";
import type { CloudSavePattern } from "@droposs/plugin-sdk";

/** Canonical upstream Ludusavi save-path manifest. */
export const LUDUSAVI_MANIFEST_URL =
  "https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml";

export type ManifestFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ManifestWhen {
  os?: string;
  store?: string;
  bit?: number;
}

export interface ManifestFileEntry {
  pattern: string;
  tags: string[];
  when: ManifestWhen[];
}

export interface ManifestGame {
  name: string;
  files: ManifestFileEntry[];
  registry: string[];
}

export type LudusaviManifest = Map<string, ManifestGame>;

/** Values used to expand Ludusavi `<placeholder>` path tokens. */
export interface SaveEnv {
  home?: string;
  osUserName?: string;
  winAppData?: string;
  winLocalAppData?: string;
  winDocuments?: string;
  winProgramData?: string;
  winPublic?: string;
  winDir?: string;
  xdgData?: string;
  xdgConfig?: string;
  root?: string;
  storeUserId?: string;
}

const PLACEHOLDERS: Record<string, keyof SaveEnv> = {
  "<home>": "home",
  "<osUserName>": "osUserName",
  "<winAppData>": "winAppData",
  "<winLocalAppData>": "winLocalAppData",
  "<winDocuments>": "winDocuments",
  "<winProgramData>": "winProgramData",
  "<winPublic>": "winPublic",
  "<winDir>": "winDir",
  "<xdgData>": "xdgData",
  "<xdgConfig>": "xdgConfig",
  "<root>": "root",
  "<storeUserId>": "storeUserId",
};

const PLACEHOLDER_RE = /<[a-zA-Z]+>/g;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseWhen(value: unknown): ManifestWhen[] {
  if (!Array.isArray(value)) return [];
  const conditions: ManifestWhen[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const condition = raw as Record<string, unknown>;
    conditions.push({
      os: typeof condition.os === "string" ? condition.os : undefined,
      store: typeof condition.store === "string" ? condition.store : undefined,
      bit: typeof condition.bit === "number" ? condition.bit : undefined,
    });
  }
  return conditions;
}

function parseFiles(raw: unknown): ManifestFileEntry[] {
  if (Array.isArray(raw)) {
    return asStringArray(raw).map((pattern) => ({
      pattern,
      tags: [],
      when: [],
    }));
  }
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, unknown>).map(
    ([pattern, meta]) => {
      const entry = (meta ?? {}) as Record<string, unknown>;
      return {
        pattern,
        tags: asStringArray(entry.tags),
        when: parseWhen(entry.when),
      };
    },
  );
}

function parseRegistry(raw: unknown): string[] {
  if (Array.isArray(raw)) return asStringArray(raw);
  if (raw && typeof raw === "object") return Object.keys(raw);
  return [];
}

/**
 * Parses the subset of the Ludusavi manifest this plugin needs: each game's
 * `files` entries (pattern, tags, platform conditions) and `registry` keys.
 * Unknown sections (`steam`, `launch`, `cloud`, ...) are ignored.
 */
export function parseManifest(text: string): LudusaviManifest {
  const document = parseYaml(text) as unknown;
  const manifest: LudusaviManifest = new Map();
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return manifest;
  }
  for (const [name, raw] of Object.entries(
    document as Record<string, unknown>,
  )) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    manifest.set(name, {
      name,
      files: parseFiles(entry.files),
      registry: parseRegistry(entry.registry),
    });
  }
  return manifest;
}

/** Builds a `SaveEnv` from process environment variables. */
export function envFromProcess(
  env: NodeJS.ProcessEnv = process.env,
): SaveEnv {
  const home = env.HOME || env.USERPROFILE;
  const userProfile = env.USERPROFILE;
  return {
    home,
    osUserName: env.USER || env.USERNAME,
    winAppData: env.APPDATA,
    winLocalAppData: env.LOCALAPPDATA,
    winDocuments: userProfile
      ? `${userProfile.replace(/[\\/]+$/, "")}\\Documents`
      : undefined,
    winProgramData: env.ProgramData ?? env.PROGRAMDATA,
    winPublic: env.PUBLIC,
    winDir: env.SystemRoot ?? env.SYSTEMROOT,
    xdgData: env.XDG_DATA_HOME ?? (home ? `${home}/.local/share` : undefined),
    xdgConfig: env.XDG_CONFIG_HOME ?? (home ? `${home}/.config` : undefined),
    root: env.SystemDrive ? `${env.SystemDrive}\\` : "/",
  };
}

/**
 * Expands Ludusavi placeholders in a manifest pattern. Returns `null` when the
 * pattern cannot be resolved in the current environment (missing env value,
 * unknown token, or a `<base>` pattern without an install directory) so
 * callers skip it rather than guessing.
 */
export function expandPattern(
  pattern: string,
  env: SaveEnv,
  installDir?: string,
): string | null {
  let missing = false;
  const expanded = pattern.replace(PLACEHOLDER_RE, (token) => {
    if (token === "<base>") {
      if (!installDir) {
        missing = true;
        return token;
      }
      return installDir.replace(/[\\/]+$/, "");
    }
    const key = PLACEHOLDERS[token];
    const value = key ? env[key] : undefined;
    if (typeof value !== "string" || value.length === 0) {
      missing = true;
      return token;
    }
    return value;
  });
  return missing ? null : expanded;
}

/** Platforms a manifest file entry applies to, from `when` or its placeholders. */
export function patternPlatforms(
  entry: ManifestFileEntry,
): Array<"windows" | "linux" | "macos"> {
  const platforms = new Set<"windows" | "linux" | "macos">();
  for (const condition of entry.when) {
    const os = condition.os?.toLowerCase();
    if (os === "windows") platforms.add("windows");
    else if (os === "linux") platforms.add("linux");
    else if (os === "mac" || os === "macos" || os === "darwin") {
      platforms.add("macos");
    }
  }
  if (platforms.size === 0) {
    if (/<win[A-Z]/.test(entry.pattern)) platforms.add("windows");
    if (/<xdg/.test(entry.pattern)) platforms.add("linux");
  }
  return [...platforms];
}

export interface MapPatternOptions {
  env: SaveEnv;
  installDir?: string;
  /** Platform the resolver is running on; controls the `winePrefix` hint. */
  runtimePlatform?: NodeJS.Platform;
}

/**
 * Maps a manifest game to cloud-save patterns with placeholders expanded.
 * Registry-only entries are parsed but intentionally not mapped: the
 * `cloudsave:provider` SPI resolves filesystem paths, not registry keys.
 */
export function toCloudSavePatterns(
  game: ManifestGame,
  options: MapPatternOptions,
): CloudSavePattern[] {
  const runtimePlatform = options.runtimePlatform ?? process.platform;
  const patterns: CloudSavePattern[] = [];
  const seen = new Set<string>();
  for (const file of game.files) {
    const expanded = expandPattern(file.pattern, options.env, options.installDir);
    if (!expanded) continue;
    const platforms = patternPlatforms(file);
    const targets: Array<"windows" | "linux" | "macos" | undefined> =
      platforms.length > 0 ? platforms : [undefined];
    for (const platform of targets) {
      const key = `${platform ?? "*"}|${expanded}`;
      if (seen.has(key)) continue;
      seen.add(key);
      patterns.push({
        pattern: expanded,
        ...(platform ? { platform } : {}),
        ...(platform === "windows" && runtimePlatform !== "win32"
          ? { winePrefix: true }
          : {}),
      });
    }
  }
  return patterns;
}

/** Exact match first, then a case-insensitive fallback. */
export function findManifestGame(
  manifest: LudusaviManifest,
  title: string,
): ManifestGame | undefined {
  const exact = manifest.get(title);
  if (exact) return exact;
  const lower = title.toLowerCase();
  for (const [name, game] of manifest) {
    if (name.toLowerCase() === lower) return game;
  }
  return undefined;
}

/** Fetches and caches the Ludusavi manifest, retrying after a failed load. */
export class LudusaviManifestSource {
  private cache: Promise<LudusaviManifest> | null = null;

  constructor(
    private readonly fetchFn: ManifestFetch,
    private readonly url: string = LUDUSAVI_MANIFEST_URL,
  ) {}

  load(): Promise<LudusaviManifest> {
    if (!this.cache) {
      this.cache = this.fetchManifest().catch((error) => {
        this.cache = null;
        throw error;
      });
    }
    return this.cache;
  }

  private async fetchManifest(): Promise<LudusaviManifest> {
    const response = await this.fetchFn(this.url);
    if (!response.ok) {
      throw new Error(
        `Ludusavi manifest fetch failed: HTTP ${response.status}`,
      );
    }
    return parseManifest(await response.text());
  }
}
