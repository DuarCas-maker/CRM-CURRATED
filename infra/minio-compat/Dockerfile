# Repackage the exact MinIO/mc binaries used by the Coolify template on Alpine.
# The source stage is copied from only; its UBI9 shell is never executed.
# Both linux/amd64 binaries were inspected: static ELF, GOAMD64=v1.
FROM ghcr.io/coollabsio/minio@sha256:69b55a1c1c5dc285ce04db96689f5b2102317fc77a50680a1874ca6efd1c87f9 AS source
FROM alpine:3.22

COPY --from=source /usr/bin/minio /usr/bin/minio
COPY --from=source /usr/bin/mc /usr/bin/mc
COPY --from=source /usr/bin/docker-entrypoint.sh /usr/bin/docker-entrypoint.sh
COPY --from=source /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=source /licenses/ /licenses/

ENV MC_CONFIG_DIR=/tmp/.mc
RUN ["/usr/bin/minio", "--version"]
RUN ["/usr/bin/mc", "--version"]

EXPOSE 9000 9001
ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
CMD ["minio"]
