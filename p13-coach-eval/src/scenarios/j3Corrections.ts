import { ITEM } from "./catalogItems";
import type { Scenario } from "./types";

export const J3_SCENARIOS: Scenario[] = [
  {
    id: "J3-01-make-it-three",
    job: "J3",
    lang: "es",
    title: "Change the count of the meal just logged",
    turns: [
      {
        user: "registrá 2 huevos duros en el desayuno",
        expect: { tools: ["log_meal"], meals: [{ item: ITEM.huevoDuro, portions: 2, category: "breakfast" }] },
      },
      {
        user: "hacelo 3",
        expect: { meals: [{ item: ITEM.huevoDuro, portions: 3, category: "breakfast" }] },
      },
    ],
  },
  {
    id: "J3-02-delete-last",
    job: "J3",
    lang: "es",
    title: "Delete the last meal",
    seed: { meals: [{ item: ITEM.shawarmaPollo, category: "lunch", dayOffset: 0 }] },
    turns: [
      {
        user: "borrá la última comida que registré, la cargué por error",
        expect: { meals: [] },
      },
    ],
  },
  {
    id: "J3-03-wrong-category",
    job: "J3",
    lang: "es",
    title: "Fix the category of the meal just logged",
    turns: [
      {
        user: "anotá Edamame en el almuerzo",
        expect: { tools: ["log_meal"], meals: [{ item: ITEM.edamame, portions: 1, category: "lunch" }] },
      },
      {
        user: "perdón, era en la cena, no en el almuerzo",
        expect: { meals: [{ item: ITEM.edamame, portions: 1, category: "dinner" }] },
      },
    ],
  },
  {
    id: "J3-04-half-portion",
    job: "J3",
    lang: "es",
    title: "Correct the portion to a half",
    turns: [
      {
        user: "registrá Mesala A en el almuerzo",
        expect: { tools: ["log_meal"], meals: [{ item: ITEM.mesalaA, portions: 1, category: "lunch" }] },
      },
      {
        user: "en realidad comí media porción nomás",
        expect: { meals: [{ item: ITEM.mesalaA, portions: 0.5, category: "lunch" }] },
      },
    ],
  },
  {
    id: "J3-05-english-make-it-one",
    job: "J3",
    lang: "en",
    title: "English count correction",
    turns: [
      {
        user: "log 2 boiled eggs as a snack",
        expect: { tools: ["log_meal"], meals: [{ item: ITEM.huevoDuro, portions: 2, category: "snack" }] },
      },
      {
        user: "actually it was just 1",
        expect: { meals: [{ item: ITEM.huevoDuro, portions: 1, category: "snack" }] },
      },
    ],
  },
  {
    id: "J3-06-wrong-item",
    job: "J3",
    lang: "es",
    title: "Replace the wrong catalog item",
    turns: [
      {
        user: "registrá un latte con leche entera en la merienda",
        expect: { tools: ["log_meal"], meals: [{ item: ITEM.latteEntera, portions: 1, category: "snack" }] },
      },
      {
        user: "me equivoqué, era el latte con oat milk",
        expect: { meals: [{ item: ITEM.latteOat, portions: 1, category: "snack" }] },
      },
    ],
  },
];
