import type { ListAddItem, ListPatch, Location, SavedCard, ShoppingItem } from "@snapcook/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";

// Two people shop from one list, so the other's ticks must show without a reload.
const LIST_POLL_MS = 30_000;

export type ShoppingList = { items: ShoppingItem[]; recipes: Record<string, string> };

export function useList(householdId: string) {
  return useQuery({
    queryKey: ["list", householdId],
    refetchInterval: LIST_POLL_MS,
    queryFn: () => unwrap<ShoppingList>(api.list.$get()),
  });
}

export function useAddToList(householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (items: ListAddItem[]) =>
      unwrap<ShoppingList>(api.list.items.$post({ json: { items } })),
    onSuccess: (list) => client.setQueryData(["list", householdId], list),
  });
}

export function useChangeLine(householdId: string) {
  const client = useQueryClient();
  const key = ["list", householdId];
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ListPatch }) =>
      unwrap<{ item: ShoppingItem }>(api.list.items[":id"].$patch({ param: { id }, json: patch })),
    // A tick shows at once and goes back if the server refuses.
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<ShoppingList>(key);
      client.setQueryData<ShoppingList>(key, (list) =>
        list
          ? {
              ...list,
              items: list.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
            }
          : list,
      );
      return { before };
    },
    onError: (_error, _input, context) => client.setQueryData(key, context?.before),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}

export function useRemoveLine(householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap<undefined>(api.list.items[":id"].$delete({ param: { id } })),
    onSettled: () => client.invalidateQueries({ queryKey: ["list", householdId] }),
  });
}

export function usePutAway(householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (location: Location) =>
      unwrap<{ moved: number }>(api.list["put-away"].$post({ json: { location } })),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["list", householdId] }),
        client.invalidateQueries({ queryKey: ["pantry", householdId] }),
      ]),
  });
}

export function useSaved(householdId: string) {
  return useQuery({
    queryKey: ["saved", householdId],
    queryFn: async () =>
      (
        await unwrap<{ saved: (Omit<SavedCard, "saved_at"> & { saved_at: string })[] }>(
          api.saved.$get(),
        )
      ).saved,
  });
}

export function useToggleSaved(householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ recipeId, save }: { recipeId: string; save: boolean }) =>
      unwrap<undefined>(
        save
          ? api.saved[":recipeId"].$put({ param: { recipeId } })
          : api.saved[":recipeId"].$delete({ param: { recipeId } }),
      ),
    onSettled: () => client.invalidateQueries({ queryKey: ["saved", householdId] }),
  });
}
