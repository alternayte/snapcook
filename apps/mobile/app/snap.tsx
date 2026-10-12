import { Location, type SnapProposal } from "@snapcook/schema";
import * as ImagePicker from "expo-image-picker";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Card, Label, Page } from "@/components/scrap/paper";
import { Loading } from "@/components/scrap/status";
import { Sticker } from "@/components/scrap/sticker";
import { type Photo, PhotoTile } from "@/components/snap/photo-tile";
import { ProposalRow, type Row, SURE_ENOUGH } from "@/components/snap/proposal-row";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Text } from "@/components/ui/text";
import { useMe } from "@/lib/queries";
import { MAX_PHOTOS, type SnapState, uploadPhoto, useCommitSnaps } from "@/lib/snaps";
import { useT } from "@/lib/use-t";

function Snap({ householdId }: { householdId: string }) {
  const t = useT();
  const router = useRouter();
  const commit = useCommitSnaps(householdId);
  const [location, setLocation] = useState<Location>("fridge");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const room = MAX_PHOTOS - photos.length;
  const accepted = rows.filter((row) => row.accepted);

  async function add(source: "camera" | "gallery") {
    const options = { mediaTypes: ["images" as const], quality: 1 };
    const picked =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({
            ...options,
            allowsMultipleSelection: true,
            selectionLimit: room,
          });
    if (picked.canceled) return;
    for (const asset of picked.assets.slice(0, room)) {
      const key = `${Date.now()}-${asset.uri}`;
      setPhotos((list) => [...list, { key, uri: asset.uri }]);
      const patch = await uploadPhoto(asset, location).then(
        (snapId) => ({ snapId }),
        () => ({ failed: true }),
      );
      setPhotos((list) =>
        list.map((photo) => (photo.key === key ? { ...photo, ...patch } : photo)),
      );
    }
  }

  // Each photo's proposals join the one list as that photo finishes; earlier edits are kept.
  function onDone(key: string, state: SnapState & { proposals: SnapProposal[] }) {
    setRows((list) =>
      list.some((row) => row.key.startsWith(`${key}:`))
        ? list
        : [
            ...list,
            ...state.proposals.map((p, index) => ({
              key: `${key}:${index}`,
              name: p.name,
              ingredient_id: p.ingredient_id,
              quantity: p.quantity,
              unit: p.unit,
              location: state.location,
              confidence: p.confidence,
              existing_item_id: p.existing_item_id,
              accepted: p.confidence >= SURE_ENOUGH,
              merge: "add" as const,
            })),
          ],
    );
  }

  function putAway() {
    commit.mutate(
      accepted.map((row) => ({
        ingredient_id: row.ingredient_id,
        display_name: row.name.trim(),
        quantity: row.quantity,
        unit: row.unit,
        location: row.location,
        confidence: row.confidence,
        ...(row.existing_item_id
          ? { merge: { existing_item_id: row.existing_item_id, choice: row.merge } }
          : {}),
      })),
      { onSuccess: () => router.replace("/(tabs)/pantry") },
    );
  }

  return (
    <Page>
      <View className="h-20">
        <Sticker
          name="pan"
          size={88}
          angle={-10}
          delay={150}
          style={{ position: "absolute", right: 4, top: -4 }}
        />
      </View>
      <View className="gap-1">
        <Text variant="display">{t("snap.title")}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("snap.note")}
        </Text>
      </View>

      <Card tape tilt={-0.6} className="gap-4 pt-6">
        <Text variant="label">{t("snap.where")}</Text>
        <View className="flex-row flex-wrap gap-2">
          {Location.options.map((option, index) => (
            <Chip
              key={option}
              index={index}
              label={t(`location.${option}`)}
              selected={location === option}
              onPress={() => setLocation(option)}
            />
          ))}
        </View>
        <Button disabled={room <= 0} onPress={() => add("camera")}>
          <Text>{t("snap.camera")}</Text>
        </Button>
        <Button variant="paper" disabled={room <= 0} onPress={() => add("gallery")}>
          <Text>{t("snap.gallery")}</Text>
        </Button>
        <Text variant="small">{t("snap.limit", { count: MAX_PHOTOS })}</Text>
      </Card>

      {photos.length > 0 ? (
        <View className="flex-row flex-wrap gap-3">
          {photos.map((photo, index) => (
            <PhotoTile key={photo.key} photo={photo} index={index} onDone={onDone} />
          ))}
        </View>
      ) : null}

      {rows.length > 0 ? (
        <>
          <View className="gap-1">
            <Text variant="title">{t("snap.review")}</Text>
            <Text variant="small">{t("snap.review.help")}</Text>
          </View>
          {Location.options
            .map((place) => ({ place, list: rows.filter((row) => row.location === place) }))
            .filter((group) => group.list.length > 0)
            .map((group, index) => (
              <Card key={group.place} tilt={index % 2 === 0 ? 0.5 : -0.5} className="gap-1">
                <Label className={index % 2 === 0 ? "bg-mustard" : "bg-sage"}>
                  <Text variant="label">{t(`location.${group.place}`)}</Text>
                </Label>
                {group.list.map((row) => (
                  <ProposalRow
                    key={row.key}
                    row={row}
                    onChange={(patch) =>
                      setRows((list) =>
                        list.map((other) =>
                          other.key === row.key ? { ...other, ...patch } : other,
                        ),
                      )
                    }
                  />
                ))}
              </Card>
            ))}
          <Button
            disabled={
              accepted.length === 0 ||
              commit.isPending ||
              accepted.some((row) => row.name.trim() === "")
            }
            onPress={putAway}
          >
            <Text>{t("snap.commit", { count: accepted.length })}</Text>
          </Button>
          {commit.isError ? (
            <Text className="font-medium text-sm text-tomato">{t("common.error")}</Text>
          ) : null}
        </>
      ) : null}

      <Link href="/(tabs)/pantry" replace asChild>
        <Button variant="quiet">
          <Text>{t("snap.manual")}</Text>
        </Button>
      </Link>
    </Page>
  );
}

export default function SnapScreen() {
  const me = useMe();
  const household = me.data?.household;
  return household ? <Snap householdId={household.id} /> : <Loading />;
}
