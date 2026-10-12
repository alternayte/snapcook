import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Card, Page } from "@/components/scrap/paper";
import { Loading } from "@/components/scrap/status";
import { Sticker } from "@/components/scrap/sticker";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import type { MessageId } from "@/lib/messages/en";
import { canPurchase, offers, purchase, restore } from "@/lib/purchases";
import { useMe } from "@/lib/queries";
import { useT } from "@/lib/use-t";

const POINTS: MessageId[] = [
  "paywall.point.snaps",
  "paywall.point.suggestions",
  "paywall.point.controls",
  "paywall.point.members",
  "paywall.point.saved",
];
// After a purchase the server learns of it from the store. The app asks until the plan has changed.
const CONFIRM_POLL_MS = 2000;

export default function Paywall() {
  const t = useT();
  const router = useRouter();
  const client = useQueryClient();
  const me = useMe();
  const household = me.data?.household;
  const isOwner = me.data?.role === "owner";
  const paid = household !== undefined && household !== null && household.plan !== "free";
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const ownerId = household?.owner_user_id ?? "";
  const onSale = useQuery({
    queryKey: ["offers", ownerId],
    enabled: canPurchase && isOwner && !paid,
    queryFn: () => offers(ownerId),
  });

  useEffect(() => {
    if (!waiting || paid) return;
    const poll = setInterval(() => client.invalidateQueries({ queryKey: ["me"] }), CONFIRM_POLL_MS);
    return () => clearInterval(poll);
  }, [waiting, paid, client]);

  if (!household) return <Loading />;

  async function act(run: () => Promise<unknown>) {
    setFailed(false);
    try {
      await run();
      setWaiting(true);
    } catch {
      // A purchase the buyer cancelled also lands here. Nothing was charged either way.
      setFailed(true);
    }
  }

  return (
    <Page>
      <Button
        variant="quiet"
        size="sm"
        className="self-start"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      >
        <Text>← {t("recipe.back")}</Text>
      </Button>
      <View className="h-24">
        <Sticker
          name="tomato"
          size={104}
          angle={10}
          delay={150}
          style={{ position: "absolute", right: 0, top: -4 }}
        />
        <Sticker
          name="lemon"
          size={72}
          angle={-16}
          delay={300}
          style={{ position: "absolute", right: 96, top: 28 }}
        />
      </View>
      <View className="gap-1">
        <Text variant="display">{t("paywall.title")}</Text>
        <Text variant="hand" style={{ transform: [{ rotate: "-2deg" }] }}>
          {t("paywall.note")}
        </Text>
      </View>
      <Card tape tilt={-0.6} className="gap-2.5 pt-6">
        {POINTS.map((point) => (
          <Text key={point}>✓ {t(point)}</Text>
        ))}
      </Card>

      {paid ? (
        <Text variant="title" className="text-center">
          {t("paywall.done")}
        </Text>
      ) : waiting ? (
        <Text variant="hand" className="text-center">
          {t("paywall.waiting")}
        </Text>
      ) : !isOwner ? (
        <Text className="text-center">{t("paywall.ownerOnly")}</Text>
      ) : !canPurchase ? (
        <Text className="text-center">{t("paywall.unavailable")}</Text>
      ) : (
        <>
          {(onSale.data ?? []).map((offer, index) => (
            <Button
              key={offer.id}
              variant={index === 0 ? "primary" : "paper"}
              onPress={() => act(() => purchase(ownerId, offer.id))}
            >
              <Text>{t("paywall.buy", { name: offer.name, price: offer.price })}</Text>
            </Button>
          ))}
          <Button variant="quiet" onPress={() => act(() => restore(ownerId))}>
            <Text>{t("paywall.restore")}</Text>
          </Button>
        </>
      )}
      {failed || onSale.isError ? (
        <Text className="text-center font-medium text-sm text-tomato">{t("paywall.failed")}</Text>
      ) : null}
    </Page>
  );
}
