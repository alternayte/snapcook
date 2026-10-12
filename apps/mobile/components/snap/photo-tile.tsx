import type { SnapProposal } from "@snapcook/schema";
import { Image } from "expo-image";
import { useEffect } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { type SnapState, useSnap } from "@/lib/snaps";
import { useT } from "@/lib/use-t";

export type Photo = {
  key: string;
  uri: string;
  /** Unset while the photo is still being sent. */
  snapId?: string;
  failed?: boolean;
};

type Props = {
  photo: Photo;
  index: number;
  /** Called once, when detection for this photo has finished. */
  onDone: (key: string, state: SnapState & { proposals: SnapProposal[] }) => void;
};

/** One photo of the batch as a small print, with what is happening to it. */
export function PhotoTile({ photo, index, onDone }: Props) {
  const t = useT();
  const snap = useSnap(photo.snapId);
  const state = snap.data;
  const failed = photo.failed || snap.isError || state?.status === "failed";

  // biome-ignore lint/correctness/useExhaustiveDependencies: reporting once per photo is the point.
  useEffect(() => {
    if (state?.status === "done") onDone(photo.key, { ...state, proposals: state.proposals ?? [] });
  }, [state?.status]);

  const caption = failed
    ? t("snap.photo.failed")
    : !photo.snapId
      ? t("snap.photo.sending")
      : state?.status === "done"
        ? t("snap.photo.done", { count: state.proposals?.length ?? 0 })
        : t("snap.photo.looking");

  return (
    <View
      className="w-[30%] rounded-paper bg-card p-1.5 shadow-sm shadow-ink/30"
      style={{ transform: [{ rotate: index % 2 === 0 ? "-2deg" : "1.5deg" }] }}
    >
      <Image source={photo.uri} style={{ width: "100%", aspectRatio: 1 }} contentFit="cover" />
      <Text
        className={
          failed ? "pt-1 font-medium text-xs text-tomato" : "pt-1 font-medium text-xs text-ink-soft"
        }
      >
        {caption}
      </Text>
    </View>
  );
}
