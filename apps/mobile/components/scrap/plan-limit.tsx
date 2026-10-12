import { Link } from "expo-router";
import { Card } from "@/components/scrap/paper";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/use-t";

/** Shown where the free plan's allowance has run out, with the way to more. */
export function PlanLimit({ body }: { body?: string }) {
  const t = useT();
  return (
    <Card tilt={0.6} className="gap-2 bg-mustard">
      <Text variant="heading">{t("plan.limit.title")}</Text>
      <Text>{body ?? t("plan.limit.body")}</Text>
      <Link href="/paywall" asChild>
        <Button variant="paper" size="sm" className="self-start">
          <Text>{t("plan.upgrade")}</Text>
        </Button>
      </Link>
    </Card>
  );
}
