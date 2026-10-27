import type {
  BrowseQuery,
  BrowseResponse,
  ImportDraft,
  ImportSummary,
  ImportView,
} from "@snapcook/schema";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File as DeviceFile } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { api, unwrap } from "@/lib/api";
import type { ShoppingList } from "@/lib/list";

// Recipe text needs more detail than a pantry photo, so imports are sent larger.
const LONGEST_EDGE = 2048;
const JPEG_QUALITY = 0.85;
const POLL_MS = 2000;

/** The query as the server reads it: every value a string, unset ones left out. */
function asQuery(query: BrowseQuery) {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)]),
  );
}

export function useBrowse(householdId: string, query: BrowseQuery) {
  return useQuery({
    queryKey: ["browse", householdId, query],
    placeholderData: keepPreviousData,
    queryFn: () => unwrap<BrowseResponse>(api.recipes.$get({ query: asQuery(query) })),
  });
}

export function useShare(householdId: string, recipeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (share: boolean) =>
      unwrap<undefined>(
        share
          ? api.recipes[":recipeId"].share.$post({ param: { recipeId } })
          : api.recipes[":recipeId"].share.$delete({ param: { recipeId } }),
      ),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["recipe", recipeId] }),
        client.invalidateQueries({ queryKey: ["browse", householdId] }),
      ]),
  });
}

/** Puts on the list what a recipe needs and the pantry lacks. */
export function useAddMissing(householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { recipe_id: string; adaptation_id?: string }) =>
      unwrap<ShoppingList & { added: number }>(api.list.missing.$post({ json: input })),
    onSuccess: ({ added: _added, ...list }) => client.setQueryData(["list", householdId], list),
  });
}

/** Turns the household's machine on or off. Recipes are fitted again after a change. */
export function useSetMachine(householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mc_smart: boolean) =>
      unwrap<undefined>(api.household.profile.devices.$put({ json: { mc_smart } })),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["me"] }),
        client.invalidateQueries({ queryKey: ["profile", householdId] }),
        client.invalidateQueries({ queryKey: ["adaptation", householdId] }),
      ]),
  });
}

/** Shrinks a picked image and makes it something the upload can carry. */
async function prepare(asset: ImagePickerAsset) {
  const landscape = asset.width >= asset.height;
  const longest = Math.max(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  if (longest > LONGEST_EDGE) {
    context.resize(landscape ? { width: LONGEST_EDGE } : { height: LONGEST_EDGE });
  }
  const image = await (await context.renderAsync()).saveAsync({
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });
  // The browser sends a real file. A phone sends the saved file, which Expo's fetch reads as bytes.
  return Platform.OS === "web"
    ? new File([await (await fetch(image.uri)).blob()], "page.jpg", { type: "image/jpeg" })
    : (new DeviceFile(image.uri) as unknown as File);
}

export function useStartImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (assets: ImagePickerAsset[]) => {
      const photo = await Promise.all(assets.map(prepare));
      return unwrap<{ import_id: string }>(api.imports.$post({ form: { photo } }));
    },
    // The count of imports left is part of the session answer.
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["me"] }),
        client.invalidateQueries({ queryKey: ["imports"] }),
      ]),
  });
}

type OpenImport = Omit<ImportSummary, "created_at"> & { created_at: string };

/**
 * The household's imports in progress, asked about again while one is being read or saved. When
 * one leaves the list it has become a recipe, so the recipe lists are read again.
 */
export function useImports(enabled = true) {
  const client = useQueryClient();
  const imports = useQuery({
    queryKey: ["imports"],
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some((i) => i.status === "reading" || i.status === "saving")
        ? POLL_MS
        : false,
    queryFn: async () => (await unwrap<{ imports: OpenImport[] }>(api.imports.$get())).imports,
  });
  const saving = useRef(new Set<string>());
  useEffect(() => {
    if (!imports.data) return;
    const open = new Set(imports.data.map((i) => i.id));
    const finished = [...saving.current].filter((id) => !open.has(id));
    saving.current = new Set(imports.data.filter((i) => i.status === "saving").map((i) => i.id));
    if (finished.length === 0) return;
    client.invalidateQueries({ queryKey: ["browse"] });
    client.invalidateQueries({ queryKey: ["recipe"] });
    client.invalidateQueries({ queryKey: ["adaptation"] });
  }, [imports.data, client]);
  return imports;
}

/** One import, asked about again while it is being read or saved. */
export function useImport(id: string) {
  return useQuery({
    queryKey: ["import", id],
    refetchInterval: (query) =>
      query.state.data?.status === "reading" || query.state.data?.status === "saving"
        ? POLL_MS
        : false,
    queryFn: () => unwrap<ImportView>(api.imports[":id"].$get({ param: { id } })),
  });
}

/** `onSent` runs once the server has the recipe, before the screen changes to show it saving. */
export function useSubmitImport(id: string, onSent: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: ImportDraft) =>
      unwrap<ImportView>(api.imports[":id"].$put({ param: { id }, json: { draft } })),
    onSuccess: (view) => {
      onSent();
      client.setQueryData(["import", id], view);
      return client.invalidateQueries({ queryKey: ["imports"] });
    },
  });
}

export function useDiscardImport(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap<undefined>(api.imports[":id"].$delete({ param: { id } })),
    onSettled: () => client.invalidateQueries({ queryKey: ["imports"] }),
  });
}

export function useStartEdit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (recipeId: string) =>
      unwrap<{ import_id: string }>(api.recipes[":recipeId"].edit.$post({ param: { recipeId } })),
    onSettled: () => client.invalidateQueries({ queryKey: ["imports"] }),
  });
}
