import type { Db } from "@snapcook/db";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import {
  type DetectionDeps,
  deleteOldPhotos,
  failSnap,
  runDetection,
} from "./modules/snaps/service";

const DETECT = "detect";
const RETENTION = "photo-retention";
const COST_ROLLUP = "cost-rollup";

const JOB_ERROR_WINDOW_MS = 60 * 1000;

// A failed detection is tried twice more before the photo is marked failed.
const DETECT_RETRIES = 2;

// A household that passes this much in a month, or one call above the second amount, is logged.
const MONTHLY_ALERT_USD = 1.1;
const CALL_ALERT_USD = 0.22;

/** Adds up yesterday's and today's model cost per household, and logs what needs a look. */
export async function rollUpCosts(db: Db, now = new Date()) {
  await db.execute(sql`
    insert into household_cost_daily (household_id, day, cost_usd, calls)
    select household_id, (created_at at time zone 'UTC')::date, sum(cost_usd), count(*)
    from llm_calls
    where household_id is not null and created_at >= ${now}::timestamptz - interval '2 days'
    group by 1, 2
    on conflict (household_id, day) do update set cost_usd = excluded.cost_usd, calls = excluded.calls`);
  const month = now.toISOString().slice(0, 7);
  const over = await db.execute<{ household_id: string; cost: number }>(sql`
    select household_id, sum(cost_usd)::float8 as cost from household_cost_daily
    where to_char(day, 'YYYY-MM') = ${month} group by 1 having sum(cost_usd) > ${MONTHLY_ALERT_USD}`);
  const large = await db.execute<{ household_id: string; endpoint: string; cost: number }>(sql`
    select household_id, endpoint, cost_usd::float8 as cost from llm_calls
    where created_at >= ${now}::timestamptz - interval '1 day' and cost_usd > ${CALL_ALERT_USD}`);
  for (const row of over.rows) {
    console.warn(
      `cost alert: household ${row.household_id} is at USD ${row.cost.toFixed(2)} in ${month}`,
    );
  }
  for (const row of large.rows) {
    console.warn(
      `cost alert: one ${row.endpoint} call cost USD ${row.cost.toFixed(2)} (household ${row.household_id})`,
    );
  }
  return { over: over.rows.length, large: large.rows.length };
}

/** Starts the background jobs of the API process, on the same database. */
export async function startJobs(databaseUrl: string, deps: DetectionDeps) {
  const boss = new PgBoss(databaseUrl);
  // The runner reports its own failures, such as a lost database connection. One within the
  // last minute means the jobs cannot be trusted to run.
  let lastError = 0;
  boss.on("error", (error) => {
    lastError = Date.now();
    console.error("job runner:", error);
  });
  await boss.start();
  await boss.createQueue(DETECT, { retryLimit: DETECT_RETRIES, retryBackoff: true });
  await boss.createQueue(RETENTION);
  await boss.createQueue(COST_ROLLUP);

  await boss.work<{ snapId: string }>(
    DETECT,
    { includeMetadata: true, batchSize: 1 },
    async ([job]) => {
      if (!job) return;
      try {
        await runDetection(deps, job.data.snapId);
      } catch (error) {
        // The last try has failed: tell the household, and give the snap back.
        if (job.retryCount >= DETECT_RETRIES) await failSnap(deps.db, job.data.snapId);
        throw error;
      }
    },
  );
  await boss.work(RETENTION, async () => {
    await deleteOldPhotos(deps.db, deps.snapDir);
  });
  await boss.work(COST_ROLLUP, async () => {
    await rollUpCosts(deps.db);
  });
  await boss.schedule(RETENTION, "7 * * * *");
  await boss.schedule(COST_ROLLUP, "20 2 * * *");

  return {
    enqueueDetect: async (snapId: string) => {
      await boss.send(DETECT, { snapId });
    },
    healthy: () => Date.now() - lastError > JOB_ERROR_WINDOW_MS,
    stop: () => boss.stop(),
  };
}
