import { Redirect } from "expo-router";
import { Failed, Loading } from "@/components/scrap/status";
import { useMe } from "@/lib/queries";

/** Sends each person to the first screen that applies to them. */
export default function Gate() {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.isError) return <Failed onRetry={() => me.refetch()} />;
  if (!me.data) return <Redirect href="/sign-in" />;
  if (!me.data.household) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)/pantry" />;
}
