import type { Source } from "@radar/core";
import { hn } from "./hn.ts";
import { lobsters } from "./lobsters.ts";
import type { Adapter } from "./types.ts";

export const ADAPTERS: Partial<Record<Source, Adapter>> = { hn, lobsters };
