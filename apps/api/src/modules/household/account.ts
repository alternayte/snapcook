import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { type Db, schema } from "@snapcook/db";
import { and, count, eq, exists, ne, notInArray, or } from "drizzle-orm";

const {
  adaptations,
  householdMembers,
  households,
  recipeImages,
  recipeVersions,
  recipes,
  savedRecipes,
  users,
} = schema;

export type AccountFiles = {
  /** Directories that keep a folder of photos per household. */
  householdDirs: string[];
  /** The directory of recipe pictures. Unset when the server keeps none. */
  imageDir?: string;
};

export type DeleteOutcome = "deleted" | "has_members";

/**
 * Deletes a user. A member's household stays, with their cooks, photos and imports kept without a
 * name. An owner can delete their account only once they are the last member: the household goes
 * too. Its recipes go with it, except a recipe another household saved or cooked, which stays
 * without an owner and keeps its place on the community list.
 */
export async function deleteAccount(
  db: Db,
  userId: string,
  files: AccountFiles,
): Promise<{ outcome: DeleteOutcome; recipesChanged: boolean }> {
  const result = await db.transaction(async (tx) => {
    const [member] = await tx
      .select({ household_id: householdMembers.household_id, role: householdMembers.role })
      .from(householdMembers)
      .where(eq(householdMembers.user_id, userId));
    if (member?.role !== "owner") {
      await tx.delete(users).where(eq(users.id, userId));
      return {
        outcome: "deleted" as const,
        householdId: null,
        pictures: [],
        recipesChanged: false,
      };
    }

    const householdId = member.household_id;
    const [members] = await tx
      .select({ n: count() })
      .from(householdMembers)
      .where(eq(householdMembers.household_id, householdId));
    if ((members?.n ?? 0) > 1)
      return {
        outcome: "has_members" as const,
        householdId: null,
        pictures: [],
        recipesChanged: false,
      };

    const usedElsewhere = or(
      exists(
        tx
          .select({ one: savedRecipes.recipe_id })
          .from(savedRecipes)
          .where(
            and(eq(savedRecipes.recipe_id, recipes.id), ne(savedRecipes.household_id, householdId)),
          ),
      ),
      exists(
        tx
          .select({ one: adaptations.id })
          .from(adaptations)
          .innerJoin(recipeVersions, eq(recipeVersions.id, adaptations.recipe_version_id))
          .where(
            and(
              eq(recipeVersions.recipe_id, recipes.id),
              ne(adaptations.household_id, householdId),
            ),
          ),
      ),
    );
    const kept = await tx
      .update(recipes)
      .set({ household_id: null, orphaned_at: new Date() })
      .where(and(eq(recipes.household_id, householdId), usedElsewhere))
      .returning({ id: recipes.id });
    const keptIds = kept.map((row) => row.id);
    // The pictures of the recipes that go with the household, to delete once the rows are gone.
    const pictures = await tx
      .select({ file: recipeImages.file })
      .from(recipeImages)
      .innerJoin(recipeVersions, eq(recipeVersions.id, recipeImages.recipe_version_id))
      .innerJoin(recipes, eq(recipes.id, recipeVersions.recipe_id))
      .where(
        and(
          eq(recipes.household_id, householdId),
          keptIds.length > 0 ? notInArray(recipes.id, keptIds) : undefined,
        ),
      );
    const [owned] = await tx
      .select({ n: count() })
      .from(recipes)
      .where(eq(recipes.household_id, householdId));
    await tx.delete(households).where(eq(households.id, householdId));
    await tx.delete(users).where(eq(users.id, userId));
    return {
      outcome: "deleted" as const,
      householdId,
      pictures: pictures.flatMap((row) => (row.file ? [row.file] : [])),
      recipesChanged: keptIds.length > 0 || (owned?.n ?? 0) > 0,
    };
  });

  if (result.householdId) {
    for (const dir of new Set(files.householdDirs)) {
      await rm(join(dir, result.householdId), { recursive: true, force: true });
    }
  }
  if (files.imageDir) {
    for (const file of result.pictures) {
      await unlink(join(files.imageDir, file)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  return { outcome: result.outcome, recipesChanged: result.recipesChanged };
}
