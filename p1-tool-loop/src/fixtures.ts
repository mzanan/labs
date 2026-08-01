export interface Meal {
  category: "breakfast" | "lunch" | "snack" | "dinner";
  name: string;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

export interface CatalogItem {
  name: string;
  place: string | null;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

export interface WorkoutDay {
  day: string;
  label: string;
  exercises: { name: string; topSet: string }[];
}

export interface Fixtures {
  targets: { protein_g: number; fat_g: number; carbs_g: number; calories: number };
  todayMeals: Meal[];
  catalog: CatalogItem[];
  workouts: WorkoutDay[];
}

export const FIXTURES: Fixtures = {
  targets: { protein_g: 160, fat_g: 70, carbs_g: 220, calories: 2150 },
  todayMeals: [
    { category: "breakfast", name: "Eggs and rice", protein_g: 32, fat_g: 18, carbs_g: 55 },
  ],
  catalog: [
    { name: "Grilled chicken breast 200g", place: "Com Tam Ba Ghien", protein_g: 62, fat_g: 8, carbs_g: 0 },
    { name: "Beef pho", place: "Pho Thin", protein_g: 30, fat_g: 12, carbs_g: 60 },
    { name: "Salmon salad", place: null, protein_g: 35, fat_g: 22, carbs_g: 10 },
  ],
  workouts: [
    {
      day: "2026-07-30",
      label: "Push day",
      exercises: [
        { name: "Bench press", topSet: "80kg x 6" },
        { name: "Overhead press", topSet: "45kg x 8" },
      ],
    },
  ],
};
