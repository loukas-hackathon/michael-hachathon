import type { Reader } from "../types";
import { chrome } from "./chrome";
import { macUsage } from "./mac-usage";

// Add each new reader here. Order is the order they run in.
export const readers: Reader[] = [macUsage, chrome];
