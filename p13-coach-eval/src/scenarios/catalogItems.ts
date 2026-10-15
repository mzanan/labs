import type { ItemRef } from "./types";

export const ITEM = {
  banana: { name: "Banana" },
  cafeAmericano: { name: "Café americano" },
  batidoAgua: { name: "Batido con agua (ZProtein)" },
  desayunoGym: { name: "Desayuno gym (banana + 3 huevos + ½ avena + ½ vaso leche)" },
  edamame: { name: "Edamame" },
  huevoDuro: { name: "Huevo duro" },
  latteEntera: { name: "Latte con leche entera" },
  latteOat: { name: "Latte con oat milk" },
  mesalaA: { name: "Mesala A (210g chicken + 200g batata + brócoli + cherry + lime)" },
  mesalaJazmin: { name: "Mesala jazmín (210g chicken + 200g jasmine + brócoli + cherry + lime)" },
  shawarmaPollo: { name: "Shawarma large de pollo (160g, pan clásico fino)" },
  shawarmaRes: { name: "Shawarma large de res" },
  shoyuHuevoExtra: { name: "Shoyu Ramen + huevo extra", place: "Sakura" },
  tandoori: { name: "Tandoori Chicken Half (G3) + Vietnamese Rice (T2)" },
  teriyaki: { name: "Teriyaki Chicken Rice (hotplate)" },
  lecheDescremada: { name: "Vaso de leche descremada (250ml)" },
} satisfies Record<string, ItemRef>;
