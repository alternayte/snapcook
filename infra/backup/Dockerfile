# Nightly database dumps, an off-server copy, and a restore drill.
FROM alpine:3.22
RUN apk add --no-cache postgresql17-client restic tzdata
COPY backup.sh restore-drill.sh run.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore-drill.sh /usr/local/bin/run.sh
ENV TZ=Europe/Zurich BACKUP_AT=0300 KEEP_DAYS=14
VOLUME /backups
CMD ["run.sh"]
