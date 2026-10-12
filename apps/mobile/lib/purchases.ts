import { Platform } from "react-native";

export type Offer = { id: string; name: string; price: string };

const KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_RC_IOS_KEY,
  android: process.env.EXPO_PUBLIC_RC_ANDROID_KEY,
});

/** Whether this build can sell: a phone build with the store key set. */
export const canPurchase = Platform.OS !== "web" && Boolean(KEY);

// The store library exists only in a phone build, so it is loaded where it is used.
type Package = { identifier: string; product: { title: string; priceString: string } };
type Store = {
  configure(options: { apiKey: string; appUserID: string }): void;
  getOfferings(): Promise<{ current: { availablePackages: Package[] } | null }>;
  purchasePackage(pack: Package): Promise<unknown>;
  restorePurchases(): Promise<unknown>;
};
let store: Store | undefined;
let packages: Package[] = [];

function open(ownerUserId: string) {
  if (!store) {
    store = (require("react-native-purchases") as { default: Store }).default;
    // The buyer is the household's owner, so the server can match a purchase to the household.
    store.configure({ apiKey: KEY ?? "", appUserID: ownerUserId });
  }
  return store;
}

/** What is on sale now, with the price the store shows in the buyer's currency. */
export async function offers(ownerUserId: string): Promise<Offer[]> {
  packages = (await open(ownerUserId).getOfferings()).current?.availablePackages ?? [];
  return packages.map((p) => ({
    id: p.identifier,
    name: p.product.title,
    price: p.product.priceString,
  }));
}

export async function purchase(ownerUserId: string, offerId: string) {
  const pack = packages.find((p) => p.identifier === offerId);
  if (!pack) throw new Error("that offer is gone");
  await open(ownerUserId).purchasePackage(pack);
}

export const restore = (ownerUserId: string) => open(ownerUserId).restorePurchases();
