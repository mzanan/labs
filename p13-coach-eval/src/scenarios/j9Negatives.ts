import { WRITE_TOOLS } from "@/lib/constants";

import { ITEM } from "./catalogItems";
import type { Scenario } from "./types";

const NO_WRITE = { forbidTools: WRITE_TOOLS };

export const J9_SCENARIOS: Scenario[] = [
  {
    id: "J9-01-macro-question",
    job: "J9",
    lang: "es",
    title: "Macro question about a food, must not log it",
    turns: [{ user: "cuántos macros tiene un pho?", expect: NO_WRITE }],
  },
  {
    id: "J9-02-yesterday",
    job: "J9",
    lang: "es",
    title: "Question about yesterday",
    seed: {
      meals: [
        { item: ITEM.desayunoGym, category: "breakfast", dayOffset: -1 },
        { item: ITEM.tandoori, category: "dinner", dayOffset: -1 },
      ],
    },
    turns: [{ user: "qué comí ayer?", expect: NO_WRITE }],
  },
  {
    id: "J9-03-anotado-nothing",
    job: "J9",
    lang: "es",
    title: "Anotado? follow-up with nothing to log",
    turns: [
      { user: "qué me recomendás para la cena?", expect: NO_WRITE },
      { user: "anotado?", expect: NO_WRITE },
    ],
  },
];
