export const en = {
  "app.name": "SnapCook",
  "home.api.checking": "Checking the API…",
  "home.api.ok": "API reachable",
  "home.api.down": "API not reachable",
  "home.api.retry": "Try again",
  "notFound.title": "Not found",
  "notFound.body": "This screen does not exist.",
  "notFound.home": "Go to the home screen",
} as const;

export type MessageId = keyof typeof en;
