#!/bin/sh
# Runs once, when the Postgres volume is first initialised.
# Integration/e2e tests use a separate database so they never touch development data.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE planit_test OWNER "$POSTGRES_USER";
EOSQL
