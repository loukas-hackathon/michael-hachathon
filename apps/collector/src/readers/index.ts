import type { Reader } from "../types";
import { activityWatch } from "./activitywatch";
import { chrome } from "./chrome";
import { claudeCode } from "./claude-code";
import { iphoneUsage } from "./iphone-usage";
import { macUsage } from "./mac-usage";

// Add each new reader here. Order is the order they run in.
export const allReaders: Reader[] = [macUsage, iphoneUsage, chrome, claudeCode, activityWatch];

/** The readers that can work on this system (a Windows PC reads ActivityWatch and Claude Code). */
export const readersFor = (platform: NodeJS.Platform) =>
  allReaders.filter((r) => !r.platforms || r.platforms.includes(platform));

export const readers: Reader[] = readersFor(process.platform);
