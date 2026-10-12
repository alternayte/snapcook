# Deployment

This directory holds two Compose files.

- `docker-compose.yml` is for a laptop. It publishes the API and Postgres on loopback ports and keeps data in `../data`.
- `docker-compose.prod.yml` is for a server behind a reverse proxy. It publishes no port, keeps data in named volumes, and adds a backup service.

## Server

1. Create a Docker Compose resource on the server platform. Point it at this repository and at `infra/docker-compose.prod.yml`. Set the build context to the repository root.
2. Route the public address to port 3000 of the `api` service. The proxy supplies TLS.
3. Set the variables from `.env.example`. `PUBLIC_URL` is the public address with its scheme and no trailing slash.
4. Deploy. The API applies database migrations when it starts.
5. Open `<PUBLIC_URL>/api/v1/healthz`. The answer is `{"status":"ok"}` when the database and the job runner are up.

The photo upload limit is enforced by the API, so the proxy needs no body-size rule below 20 MB.

## Recipe data

A new server has an empty database. Load the recipe corpus from a machine that has it:

1. Run `infra/corpus-export.sh <directory>` on that machine. The directory must be outside the repository.
2. Copy the directory to the server.
3. Load the rows: `docker exec -i <postgres container> psql -U snapcook -d snapcook < corpus.sql`.
4. Copy the pictures: `docker cp images/. <api container>:/data/images/`.

You can run the load again after a new batch. Rows that are already on the server do not change.

## Backups

The `backup` service writes a database dump to the `backups` volume each night at 03:00 Europe/Zurich. It keeps 14 days of dumps.

Set `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `BACKUP_S3_KEY_ID` and `BACKUP_S3_SECRET` to copy each dump and the recipe pictures to an S3-compatible bucket. The copy is encrypted with `RESTIC_PASSWORD`. Keep that password in a second place: without it the copy cannot be read. With no repository set, the dumps stay on the server only.

On the first day of each month the service restores the newest dump into a scratch database, compares it with the live one, and drops it. The log line starts with `restore drill:`.

Run either step by hand:

```
docker exec <backup container> backup.sh
docker exec <backup container> restore-drill.sh
```

Restore after a loss:

1. Deploy the stack with the same variables.
2. Get the dump. From the bucket: `docker exec <backup container> restic restore latest --target /`.
3. Stop the `api` service.
4. Load it: `docker exec <backup container> pg_restore --clean --if-exists --no-owner --dbname=snapcook /backups/<newest dump>`.
5. Start the `api` service.

## Logs

The API writes one JSON line for each request, with the path, the status, the time taken and the household. The platform's log viewer shows them.

## Phone builds

`apps/mobile/eas.json` has three build profiles: `development`, `preview` and `production`. Each has an update channel of the same name.

1. Create an Expo account and run `bunx eas-cli init` in `apps/mobile`.
2. Set the bundle identifier for iOS and the package name for Android in `apps/mobile/app.json`.
3. Set `EXPO_PUBLIC_API_URL` for each profile with `bunx eas-cli env:create`.
4. Build: `bunx eas-cli build --profile development --platform ios` (or `android`).
5. Send a JavaScript-only change to installed builds: `bunx eas-cli update --channel production`.

A change to native code or to a native dependency needs a new build.
