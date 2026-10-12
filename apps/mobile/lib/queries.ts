import type {
  HouseholdProfile,
  Location,
  Me,
  MergeChoice,
  PantryItem,
  PantryPatch,
  ProfileInput,
  SuggestInput,
  SuggestResponse,
} from "@snapcook/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, unwrap } from "@/lib/api";

// The pantry is shared by the household, so another member's change must show without a reload.
const PANTRY_POLL_MS = 30_000;

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
    refetchInterval: PANTRY_POLL_MS,
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
