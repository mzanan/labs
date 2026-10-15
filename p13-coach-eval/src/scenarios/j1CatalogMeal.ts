import { ITEM } from "./catalogItems";
import type { Scenario } from "./types";

const LOG = { tools: ["log_meal"], forbidTools: ["log_estimated_meal"] };

export const J1_SCENARIOS: Scenario[] = [
  {
    id: "J1-01-exact-portions",
    job: "J1",
    lang: "es",
    title: "Exact name with a count",
    turns: [
      {
        user: "Registrá 2 Huevo duro en el desayuno",
        expect: { ...LOG, meals: [{ item: ITEM.huevoDuro, portions: 2, category: "breakfast" }] },
      },
    ],
  },
  {
    id: "J1-02-partial-name",
    job: "J1",
    lang: "es",
    title: "Partial name",
    turns: [
      {
        user: "anotá el shawarma de pollo en el almuerzo",
        expect: { ...LOG, meals: [{ item: ITEM.shawarmaPollo, portions: 1, category: "lunch" }] },
      },
    ],
  },
  {
    id: "J1-03-spanish-for-english",
    job: "J1",
    lang: "es",
    title: "Spanish words for an English catalog name",
    turns: [
      {
        user: "anotame el pollo tandoori con arroz de la cena",
        expect: { ...LOG, meals: [{ item: ITEM.tandoori, portions: 1, category: "dinner" }] },
      },
    ],
  },
  {
    id: "J1-04-variant-stated",
    job: "J1",
    lang: "es",
    title: "Variant family, the user states which one",
    turns: [
      {
        user: "registrá un vaso de leche descremada en la merienda",
        expect: { ...LOG, meals: [{ item: ITEM.lecheDescremada, portions: 1, category: "snack" }] },
      },
    ],
  },
  {
    id: "J1-05-variant-english",
    job: "J1",
    lang: "en",
    title: "Variant family in English, place stated",
    turns: [
      {
        user: "Log the Shoyu Ramen with the extra egg from Sakura for dinner",
        expect: { ...LOG, meals: [{ item: ITEM.shoyuHuevoExtra, portions: 1, category: "dinner" }] },
      },
    ],
  },
  {
    id: "J1-06-fractional-portions",
    job: "J1",
    lang: "es",
    title: "Fractional portions",
    turns: [
      {
        user: "anotá 1.5 porciones de Mesala jazmín en el almuerzo",
        expect: { ...LOG, meals: [{ item: ITEM.mesalaJazmin, portions: 1.5, category: "lunch" }] },
      },
    ],
  },
  {
    id: "J1-07-two-items",
    job: "J1",
    lang: "es",
    title: "Two catalog items in one message",
    turns: [
      {
        user: "desayuné una banana y un café americano, registralos",
        expect: {
          ...LOG,
          meals: [
            { item: ITEM.banana, portions: 1, category: "breakfast" },
            { item: ITEM.cafeAmericano, portions: 1, category: "breakfast" },
          ],
        },
      },
    ],
  },
  {
    id: "J1-08-meaning-gym",
    job: "J1",
    lang: "es",
    title: "Name that matches only by meaning (el de gym)",
    turns: [
      {
        user: "registrá el de gym en el desayuno",
        expect: { ...LOG, meals: [{ item: ITEM.desayunoGym, portions: 1, category: "breakfast" }] },
      },
    ],
  },
  {
    id: "J1-09-meaning-shake",
    job: "J1",
    lang: "es",
    title: "Description instead of the catalog name",
    turns: [
      {
        user: "me tomé el batido de proteína con agua después de entrenar, anotalo",
        expect: { ...LOG, meals: [{ item: ITEM.batidoAgua, portions: 1 }] },
      },
    ],
  },
  {
    id: "J1-10-english-exact",
    job: "J1",
    lang: "en",
    title: "English request, English catalog name",
    turns: [
      {
        user: "I had the Teriyaki Chicken Rice for dinner, please log it",
        expect: { ...LOG, meals: [{ item: ITEM.teriyaki, portions: 1, category: "dinner" }] },
      },
    ],
  },
];
