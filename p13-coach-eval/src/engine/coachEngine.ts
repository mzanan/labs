import type { CoachEvent } from "@/lib/ai/provider";
import type { Profile } from "@/lib/db/schema";

import type { UsageTotals } from "../capture/xplParse";
import type { WriteChange } from "../grade/writes";

export interface EngineTurnInput {
  userId: string;
  profile: Profile;
  message: string;
}

export interface EngineToolCall {
  id: string;
  name: string;
  input: unknown;
  result?: string;
}

export interface EngineTurnOutput {
  text: string;
  events: CoachEvent[];
  writes: WriteChange[];
  toolCalls: EngineToolCall[];
  usage: UsageTotals;
  latencyMs: number;
  approved: boolean;
  providerErrors: string[];
  error?: string;
}

export interface CoachEngine {
  name: string;
  reply(input: EngineTurnInput): Promise<EngineTurnOutput>;
}
