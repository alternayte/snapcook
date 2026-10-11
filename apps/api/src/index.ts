import { app } from "./app";

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
