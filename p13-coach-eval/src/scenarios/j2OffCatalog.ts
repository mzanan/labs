import type { Scenario } from "./types";

const ESTIMATE = { tools: ["log_estimated_meal"], forbidTools: ["log_meal"] };

export const J2_SCENARIOS: Scenario[] = [
  {
    id: "J2-01-pho",
    job: "J2",
    lang: "es",
    title: "Off-catalog dish",
    turns: [
      {
        user: "comí un pho grande en el almuerzo, anotalo",
        expect: { ...ESTIMATE, meals: [{ namePattern: "pho", category: "lunch" }] },
      },
    ],
  },
  {
    id: "J2-02-mesala-black-rice",
    job: "J2",
    lang: "es",
    title: "Catalog dish with a modification (2026-09-19 incident)",
    turns: [
      {
        user: "registrá mesala pero con arroz negro en vez de blanco",
        expect: { ...ESTIMATE, meals: [{ namePattern: "mesala|arroz negro" }] },
      },
    ],
  },
  {
    id: "J2-03-banh-mi",
    job: "J2",
    lang: "es",
    title: "Off-catalog snack, no substitution",
    turns: [
      {
        user: "anotá un bánh mì de cerdo en la merienda",
        expect: { ...ESTIMATE, meals: [{ namePattern: "b[aá]nh ?m[iì]", category: "snack" }] },
      },
    ],
  },
  {
    id: "J2-04-english-salad",
    job: "J2",
    lang: "en",
    title: "Off-catalog meal in English",
    turns: [
      {
        user: "Log a chicken caesar salad for lunch",
        expect: { ...ESTIMATE, meals: [{ namePattern: "caesar", category: "lunch" }] },
      },
    ],
  },
];
