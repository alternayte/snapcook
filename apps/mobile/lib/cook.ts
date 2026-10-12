import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  CookView,
  FinishCookInput,
  FinishCookResponse,
  RescueResponse,
} from "@snapcook/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";

const saved = (id: string) => `cook:${id}`;
const savedStep = (id: string) => `cook-step:${id}`;

export function useStartCook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (adaptation_id: string) =>
      unwrap<CookView>(api.cooks.$post({ json: { adaptation_id } })),
    onSuccess: (cook) => client.setQueryData(["cook", cook.id], cook),
  });
}

/**
 * One cook. The answer is kept on the device, so a kitchen with no signal still shows the recipe
 * and the step the cook had reached.
 */
export function useCook(id: string) {
  return useQuery({
    queryKey: ["cook", id],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const kept = await AsyncStorage.getItem(saved(id)).catch(() => null);
      const step = Number(await AsyncStorage.getItem(savedStep(id)).catch(() => null));
      try {
        const cook = await unwrap<CookView>(api.cooks[":id"].$get({ param: { id } }));
        await AsyncStorage.setItem(saved(id), JSON.stringify(cook)).catch(() => {});
        // The device may know a later step than the server, if the last save did not get through.
        return { ...cook, current_step: Math.max(cook.current_step, step || 0) };
      } catch (error) {
        if (!kept) throw error;
        const cook = JSON.parse(kept) as CookView;
        return { ...cook, current_step: Math.max(cook.current_step, step || 0) };
      }
    },
  });
}

/** Records the step the cook is on: on the device first, then on the server when it answers. */
export function saveStep(id: string, current_step: number) {
  AsyncStorage.setItem(savedStep(id), String(current_step)).catch(() => {});
  api.cooks[":id"].$patch({ param: { id }, json: { current_step } }).catch(() => {});
}

export function useFinishCook(id: string, householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: FinishCookInput) =>
      unwrap<FinishCookResponse>(api.cooks[":id"].finish.$post({ param: { id }, json: input })),
    onSuccess: (result) => {
      if (result.outcome !== "finished") return;
      AsyncStorage.multiRemove([saved(id), savedStep(id)]).catch(() => {});
      return Promise.all([
        client.invalidateQueries({ queryKey: ["pantry", householdId] }),
        client.invalidateQueries({ queryKey: ["cooks"] }),
      ]);
    },
  });
}

export function useRescue(id: string) {
  return useMutation({
    mutationFn: (input: { step_index: number; text: string }) =>
      unwrap<RescueResponse>(api.cooks[":id"].rescue.$post({ param: { id }, json: input })),
  });
}

export type CookedRow = {
  id: string;
  recipe_id: string;
  title: string;
  image: string | null;
  started_at: string;
  finished_at: string | null;
  rating: number | null;
  servings: number;
};

export function useCookHistory() {
  return useQuery({
    queryKey: ["cooks"],
    queryFn: async () => (await unwrap<{ cooks: CookedRow[] }>(api.cooks.$get())).cooks,
  });
}
