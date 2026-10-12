import { zValidator } from "@hono/zod-validator";
import type { Db } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import {
  CookProgressInput,
  FinishCookInput,
  Id,
  RescueInput,
  StartCookInput,
} from "@snapcook/schema";
import { Hono } from "hono";
import { z } from "zod";
import { allowanceExceeded, fail, type HouseholdEnv } from "../../http";
import { AllowanceUsedUp } from "../billing/usage";
import { profileOf } from "../household/service";
import { cookHistory, cookView, finishCook, rescue, setStep, startCook } from "./service";

export function cookRoutes(db: Db, llm: Llm) {
  const idParam = zValidator("param", z.object({ id: Id }), (result, c) =>
    result.success ? undefined : fail(c, 404, "not_found", "No such cook."),
  );
  const body = <S extends z.ZodType>(shape: S) =>
    zValidator("json", shape, (result, c) =>
      result.success ? undefined : fail(c, 400, "validation", "The request is not valid."),
    );
  const missing = (c: Parameters<typeof fail>[0]) => fail(c, 404, "not_found", "No such cook.");

  return new Hono<HouseholdEnv>()
    .get("/cooks", async (c) => c.json({ cooks: await cookHistory(db, c.var.household.id) }))
    .post("/cooks", body(StartCookInput), async (c) => {
      const cook = await startCook(
        db,
        c.var.household.id,
        c.var.user.id,
        c.req.valid("json").adaptation_id,
      );
      return cook ? c.json(cook, 201) : fail(c, 404, "not_found", "No such adaptation.");
    })
    .get("/cooks/:id", idParam, async (c) => {
      const cook = await cookView(db, c.var.household.id, c.req.valid("param").id);
      return cook ? c.json(cook) : missing(c);
    })
    .patch("/cooks/:id", idParam, body(CookProgressInput), async (c) => {
      const moved = await setStep(
        db,
        c.var.household.id,
        c.req.valid("param").id,
        c.req.valid("json").current_step,
      );
      return moved ? c.body(null, 204) : missing(c);
    })
    .post("/cooks/:id/finish", idParam, body(FinishCookInput), async (c) => {
      const profile = await profileOf(db, c.var.household.id);
      if (!profile) return fail(c, 404, "not_found", "This household has no profile.");
      const result = await finishCook(
        db,
        c.var.household.id,
        profile,
        c.req.valid("param").id,
        c.req.valid("json"),
      );
      return result ? c.json(result) : missing(c);
    })
    .post("/cooks/:id/rescue", idParam, body(RescueInput), async (c) => {
      try {
        const answer = await rescue(
          db,
          llm,
          c.var.household,
          c.req.valid("param").id,
          c.req.valid("json"),
        );
        return answer ? c.json(answer) : missing(c);
      } catch (error) {
        if (error instanceof AllowanceUsedUp) return allowanceExceeded(c, error.refusal);
        return fail(c, 502, "upstream_model", "No answer came back. Try again.");
      }
    });
}
