#!/usr/bin/env bun
import { embedIngredients } from "./embed-ingredients";
import { evalDetect } from "./eval/detect";
import { grid } from "./grid/stage";
import { image } from "./image/stage";
import { redraft, stage } from "./pipeline/stage";
import { smoke } from "./smoke";

type Command = (args: string[]) => Promise<void>;

const evals: Record<string, Command> = { detect: evalDetect };

const commands: Record<string, Command> = {
  "embed-ingredients": embedIngredients,
  eval: async ([name, ...rest]) => {
    const run = name ? evals[name] : undefined;
    if (!run) throw new Error(`usage: corpus eval <${Object.keys(evals).join("|")}> [dir]`);
    await run(rest);
  },
  grid,
  image,
  redraft,
  smoke,
  stage,
};

const [name, ...args] = process.argv.slice(2);
const command = name ? commands[name] : undefined;

if (!command) {
  console.error(
    `usage: corpus <command> [args]\nunknown command: ${name ?? "(missing)"}\ncommands: ${Object.keys(commands).join(", ")}`,
  );
  process.exit(2);
}

await command(args);
