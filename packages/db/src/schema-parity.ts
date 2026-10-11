import type * as S from "@snapcook/schema";
import type { schema } from "./client";

// Compile-time proof that every table's row type is exactly the zod-inferred entity type.
// A drifted column fails `tsc` here; nothing runs.

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Row<K extends keyof typeof schema> = (typeof schema)[K]["$inferSelect"];
type Same<A, B> = Equal<A, B> extends true ? true : { expected: B; actual: A };

export const parity: {
  users: Same<Row<"users">, S.User>;
  households: Same<Row<"households">, S.Household>;
  householdMembers: Same<Row<"householdMembers">, S.HouseholdMember>;
  householdInvites: Same<Row<"householdInvites">, S.HouseholdInvite>;
  householdProfiles: Same<Row<"householdProfiles">, S.HouseholdProfile>;
  pantryItems: Same<Row<"pantryItems">, S.PantryItem>;
  snaps: Same<Row<"snaps">, S.Snap>;
  suggestionRuns: Same<Row<"suggestionRuns">, S.SuggestionRun>;
  adaptations: Same<Row<"adaptations">, S.Adaptation>;
  cookSessions: Same<Row<"cookSessions">, S.CookSession>;
  savedRecipes: Same<Row<"savedRecipes">, S.SavedRecipe>;
  shoppingItems: Same<Row<"shoppingItems">, S.ShoppingItem>;
  usageCounters: Same<Row<"usageCounters">, S.UsageCounter>;
  subscriptions: Same<Row<"subscriptions">, S.Subscription>;
  llmCalls: Same<Row<"llmCalls">, S.LlmCall>;
  ingredients: Same<Row<"ingredients">, S.Ingredient>;
  ingredientSubstitutes: Same<Row<"ingredientSubstitutes">, S.IngredientSubstitute>;
  recipes: Same<Row<"recipes">, S.Recipe>;
  recipeVersions: Same<Row<"recipeVersions">, S.RecipeVersion>;
  recipeIngredients: Same<Row<"recipeIngredients">, S.RecipeIngredient>;
  deviceProfiles: Same<Row<"deviceProfiles">, S.DeviceProfile>;
  recipeDeviceVariants: Same<Row<"recipeDeviceVariants">, S.RecipeDeviceVariant>;
  recipeReports: Same<Row<"recipeReports">, S.RecipeReport>;
  dishCandidates: Same<Row<"dishCandidates">, S.DishCandidate>;
  dishStageOutputs: Same<Row<"dishStageOutputs">, S.DishStageOutput>;
} = {
  users: true,
  households: true,
  householdMembers: true,
  householdInvites: true,
  householdProfiles: true,
  pantryItems: true,
  snaps: true,
  suggestionRuns: true,
  adaptations: true,
  cookSessions: true,
  savedRecipes: true,
  shoppingItems: true,
  usageCounters: true,
  subscriptions: true,
  llmCalls: true,
  ingredients: true,
  ingredientSubstitutes: true,
  recipes: true,
  recipeVersions: true,
  recipeIngredients: true,
  deviceProfiles: true,
  recipeDeviceVariants: true,
  recipeReports: true,
  dishCandidates: true,
  dishStageOutputs: true,
};
