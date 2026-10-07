import type { Source } from "@radar/core";
import { github } from "./github.ts";
import { hn } from "./hn.ts";
import { lobsters } from "./lobsters.ts";
import type { Adapter } from "./types.ts";

// Product Hunt is in SOURCES but has no adapter until API access is granted, so it is skipped.
export const ADAPTERS: Partial<Record<Source, Adapter>> = { hn, lobsters, github };
