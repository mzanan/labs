import { describe, expect, it } from "vitest";

import { sizeFamilyKey } from "@/lib/catalogName";

describe("sizeFamilyKey (hidden grader)", () => {
  it("strips a leading size", () => {
    expect(sizeFamilyKey("100G Sweet Potato")).toBe("sweet potato");
  });
  it("strips a slash-joined size list as one token", () => {
    expect(sizeFamilyKey("100G/200G Sweet Potato")).toBe("sweet potato");
    expect(sizeFamilyKey("100/200g Sweet Potato")).toBe("sweet potato");
    expect(sizeFamilyKey("140 g/210 g Ab-Free Chicken")).toBe("ab-free chicken");
  });
  it("strips a trailing size", () => {
    expect(sizeFamilyKey("Sweet Potato 100g")).toBe("sweet potato");
  });
  it("strips a size in the middle and collapses whitespace", () => {
    expect(sizeFamilyKey("Greek  Yogurt 170g  Plain")).toBe("greek yogurt plain");
  });
  it("groups every position to the same key", () => {
    const keys = new Set(
      ["100G/200G Sweet Potato", "200G Sweet Potato", "Sweet Potato 100g", "sweet potato 1,5 kg"].map(sizeFamilyKey),
    );
    expect(keys).toEqual(new Set(["sweet potato"]));
  });
  it("handles decimals, spaces and every unit", () => {
    expect(sizeFamilyKey("1.5kg Rice")).toBe("rice");
    expect(sizeFamilyKey("Rice 1,5 KG")).toBe("rice");
    expect(sizeFamilyKey("250 ml Milk")).toBe("milk");
    expect(sizeFamilyKey("Milk 1l")).toBe("milk");
    expect(sizeFamilyKey("8oz Steak")).toBe("steak");
    expect(sizeFamilyKey("Oats 50gr")).toBe("oats");
    expect(sizeFamilyKey("Oats 50 grams")).toBe("oats");
  });
  it("removes punctuation left dangling by the size", () => {
    expect(sizeFamilyKey("Chicken (140g)")).toBe("chicken");
    expect(sizeFamilyKey("Chicken - 140g")).toBe("chicken");
    expect(sizeFamilyKey("140g, Chicken")).toBe("chicken");
  });
  it("keeps diacritic normalization", () => {
    expect(sizeFamilyKey("Cơm Tấm 300g")).toBe("com tam");
  });
  it("returns null when there is no size token", () => {
    expect(sizeFamilyKey("Rice")).toBeNull();
    expect(sizeFamilyKey("7up")).toBeNull();
    expect(sizeFamilyKey("V8 juice")).toBeNull();
    expect(sizeFamilyKey("2 eggs")).toBeNull();
    expect(sizeFamilyKey("Coke 0")).toBeNull();
  });
  it("returns null when only sizes are left", () => {
    expect(sizeFamilyKey("100g")).toBeNull();
    expect(sizeFamilyKey("  ")).toBeNull();
  });
  it("does not treat unit letters inside words as units", () => {
    expect(sizeFamilyKey("Gloria 100g")).toBe("gloria");
    expect(sizeFamilyKey("Lemon 2l Soda")).toBe("lemon soda");
  });
});
