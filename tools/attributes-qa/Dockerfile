# Build a Linux-owned init hook. Host bind mounts can ignore Git executable bits
# on Docker Desktop (notably macOS), so never execute the host file directly.
FROM postgres:17
COPY --chmod=0755 init-qa.sh /docker-entrypoint-initdb.d/10-attributes-qa.sh
