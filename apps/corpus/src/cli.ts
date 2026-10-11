#!/usr/bin/env bun
import { smoke } from "./smoke";

type Stage = (args: string[]) => Promise<void>;

const stages: Record<string, Stage> = { smoke };

const [name, ...args] = process.argv.slice(2);
const stage = name ? stages[name] : undefined;

if (!stage) {
  const known = Object.keys(stages).join(", ") || "none";
  console.error(
    `usage: corpus <stage> [args]\nunknown stage: ${name ?? "(missing)"}\nstages: ${known}`,
  );
  process.exit(2);
}

await stage(args);
