import type {
  AdaptationControls,
  AdaptResponse,
  HouseholdProfile,
  InviteView,
  Location,
  Me,
  MemberView,
  MergeChoice,
  PantryItem,
  PantryPatch,
  ProfileInput,
  RecipeView,
  SuggestInput,
  SuggestResponse,
} from "@snapcook/schema";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiError, api, unwrap } from "@/lib/api";

// How often the app asks whether another member changed something.
const SYNC_POLL_MS = 30_000;

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => {
      try {
        return await unwrap<Me>(api.me.$get());
      } catch (error) {
        // Signed out is a state the app handles, not a failure.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

export function useCreateHousehold() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => unwrap<Me>(api.household.$post({ json: { name } })),
    onSuccess: (me) => client.setQueryData(["me"], me),
  });
}

export type ProfileView = {
  profile: HouseholdProfile;
  names: Record<string, string>;
  staple_options: { id: string; name: string }[];
};

export function useProfile(householdId: string) {
  return useQuery({
    queryKey: ["profile", householdId],
    queryFn: () => unwrap<ProfileView>(api.household.profile.$get()),
  });
}

export function useSaveProfile(householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileInput) =>
      unwrap<{ profile: HouseholdProfile }>(api.household.profile.$put({ json: input })),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["profile", householdId] }),
        client.invalidateQueries({ queryKey: ["me"] }),
      ]),
  });
}

export function useMatchText() {
  return useMutation({
    mutationFn: (text: string) =>
      unwrap<{ ingredients: { id: string; name: string }[] }>(
        api.household.profile.match.$post({ json: { text } }),
      ),
  });
}

export function usePantry(householdId: string) {
  return useQuery({
    queryKey: ["pantry", householdId],
    queryFn: async () => (await unwrap<{ items: PantryItem[] }>(api.pantry.$get())).items,
  });
}

export type AddOutcome =
  | { outcome: "created" | "merged"; item: PantryItem }
  | { outcome: "merge_needed"; existing: PantryItem; incoming: Pick<PantryItem, "display_name"> };

export function useAddPantryItem(householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; location: Location; merge?: MergeChoice }) =>
      unwrap<AddOutcome>(api.pantry.items.$post({ json: input })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["pantry", householdId] }),
  });
}

export function useChangePantryItem(householdId: string) {
  const client = useQueryClient();
  const key = ["pantry", householdId];
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PantryPatch }) =>
      unwrap<{ item: PantryItem }>(api.pantry.items[":id"].$patch({ param: { id }, json: patch })),
    // The stepper answers at once and goes back if the server refuses.
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<PantryItem[]>(key);
      client.setQueryData<PantryItem[]>(key, (items) =>
        items?.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
      return { before };
    },
    onError: (_error, _input, context) => client.setQueryData(key, context?.before),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}

export function useRemovePantryItem(householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap<undefined>(api.pantry.items[":id"].$delete({ param: { id } })),
    onSettled: () => client.invalidateQueries({ queryKey: ["pantry", householdId] }),
  });
}

export function useIngredientSearch(text: string) {
  const q = text.trim();
  return useQuery({
    queryKey: ["ingredients", q],
    enabled: q.length >= 2,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await unwrap<{ ingredients: { id: string; name: string }[] }>(
          api.ingredients.$get({ query: { q } }),
        )
      ).ingredients,
  });
}

/** Asks for dishes, or for the next page of an earlier answer when a cursor is given. */
export function useSuggest() {
  return useMutation({
    mutationFn: ({ input, cursor }: { input: SuggestInput; cursor?: string }) =>
      unwrap<SuggestResponse>(api.suggestions.$post({ json: input, query: { cursor } })),
  });
}

export function useRecipe(recipeId: string) {
  return useQuery({
    queryKey: ["recipe", recipeId],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => unwrap<RecipeView>(api.recipes[":recipeId"].$get({ param: { recipeId } })),
  });
}

/**
 * The recipe fitted to the household under the given controls. A change of controls keeps the
 * last answer on screen until the new one arrives.
 */
export function useAdaptation(
  householdId: string,
  versionId: string | undefined,
  controls: Partial<AdaptationControls>,
) {
  return useQuery({
    queryKey: ["adaptation", householdId, versionId, controls],
    enabled: versionId !== undefined,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 60_000,
    queryFn: () =>
      unwrap<AdaptResponse>(
        api.adaptations.$post({ json: { recipe_version_id: versionId ?? "", controls } }),
      ),
  });
}

/**
 * Keeps this device level with the rest of the household. It asks for the household's change
 * stamps on a timer and when the app comes back to the front; a stamp that moved means another
 * member changed that part, and it is read again.
 */
export function useHouseholdSync() {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    refetchInterval: SYNC_POLL_MS,
    queryFn: async () => {
      try {
        return await unwrap<Me>(api.me.$get());
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
  const household = me.data?.household;
  const id = household?.id;
  const { pantry_rev, list_rev, profile_rev } = household ?? {};
  // biome-ignore lint/correctness/useExhaustiveDependencies: each effect runs when its stamp moves.
  useEffect(() => {
    if (id) client.invalidateQueries({ queryKey: ["pantry", id] });
  }, [pantry_rev]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above.
  useEffect(() => {
    if (id) client.invalidateQueries({ queryKey: ["list", id] });
  }, [list_rev]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above.
  useEffect(() => {
    if (id) client.invalidateQueries({ queryKey: ["profile", id] });
  }, [profile_rev]);
  return me;
}

export function useJoinHousehold() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => unwrap<Me>(api.household.join.$post({ json: { code } })),
    onSuccess: (me) => client.setQueryData(["me"], me),
  });
}

export function useMembers(householdId: string) {
  return useQuery({
    queryKey: ["members", householdId],
    queryFn: async () =>
      (await unwrap<{ members: MemberView[] }>(api.household.members.$get())).members,
  });
}

export function useInvite() {
  return useMutation({
    mutationFn: () => unwrap<InviteView>(api.household.invites.$post()),
  });
}

export function useRemoveMember(householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      unwrap<undefined>(api.household.members[":userId"].$delete({ param: { userId } })),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["members", householdId] }),
        client.invalidateQueries({ queryKey: ["me"] }),
      ]),
  });
}
