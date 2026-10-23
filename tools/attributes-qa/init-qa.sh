#!/usr/bin/env bash
set -euo pipefail
# Runs once on a fresh dedicated volume. No reset, shared database, or dynamic
# SQL identifiers. psql literal quoting protects the generated password value.
if [[ ${#QA_MIGRATOR_PASSWORD} -lt 12 ]]; then
  echo 'QA password is too short' >&2
  exit 1
fi
psql --username "$POSTGRES_USER" --dbname postgres --set=ON_ERROR_STOP=1 --set=qa_password="$QA_MIGRATOR_PASSWORD" <<'SQL'
CREATE ROLE bckl_attributes_qa LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'qa_password';
CREATE DATABASE bckl_order_resolution_test_attributes_20261019_v1 OWNER bckl_attributes_qa;
REVOKE ALL ON DATABASE bckl_order_resolution_test_attributes_20261019_v1 FROM PUBLIC;
SQL
