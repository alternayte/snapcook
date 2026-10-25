import type { AcceptedProposal, Location, SnapProposal } from "@snapcook/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File as DeviceFile } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";
import { Platform } from "react-native";
import { api, unwrap } from "@/lib/api";

/** The most photos one review takes. */
export const MAX_PHOTOS = 6;

// What goes to the server: longest edge and JPEG quality. Enough to read a label, small to send.
const LONGEST_EDGE = 1600;
const JPEG_QUALITY = 0.8;
const POLL_MS = 1500;

/** Shrinks a picked photo and sends it. Returns the id to ask about. */
export async function uploadPhoto(asset: ImagePickerAsset, location: Location) {
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
  // The browser sends a real file. A phone sends the saved file, which Expo's fetch reads as bytes;
  // it does not accept React Native's { uri } form parts.
  const photo =
    Platform.OS === "web"
      ? new File([await (await fetch(image.uri)).blob()], "photo.jpg", { type: "image/jpeg" })
      : (new DeviceFile(image.uri) as unknown as File);
  const { snap_id } = await unwrap<{ snap_id: string }>(
    api.snaps.$post({ form: { photo, location } }),
  );
  return snap_id;
}

export type SnapState = {
  status: "queued" | "done" | "failed";
  location: Location;
  proposals: SnapProposal[] | null;
};

/** Asks about one photo until detection has finished. */
export function useSnap(id: string | undefined) {
  return useQuery({
    queryKey: ["snap", id],
    enabled: id !== undefined,
    refetchInterval: (query) => (query.state.data?.status === "queued" ? POLL_MS : false),
    queryFn: () => unwrap<SnapState>(api.snaps[":id"].$get({ param: { id: id ?? "" } })),
  });
}

export function useCommitSnaps(householdId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (accepted: AcceptedProposal[]) =>
      unwrap<unknown>(api.snaps.commit.$post({ json: { accepted } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["pantry", householdId] }),
  });
}
