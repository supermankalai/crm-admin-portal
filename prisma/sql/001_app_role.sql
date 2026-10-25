-- Creates the restricted application role. Run as the database owner (postgres):
--   npm run db:setup-roles
-- The runner substitutes {{APP_PASSWORD}} (escaped literal) and {{DATABASE}} (quoted identifier).
-- Safe to run repeatedly.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gym_app') THEN
    CREATE ROLE gym_app;
  END IF;
END $$;

-- Not a superuser, cannot bypass RLS, cannot create databases/roles, cannot replicate.
ALTER ROLE gym_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
  CONNECTION LIMIT 100 PASSWORD {{APP_PASSWORD}};

-- Only explicitly granted roles may connect to this database.
REVOKE ALL ON DATABASE {{DATABASE}} FROM PUBLIC;
GRANT CONNECT ON DATABASE {{DATABASE}} TO gym_app;

CREATE SCHEMA IF NOT EXISTS "gym-admin-portal";
REVOKE ALL ON SCHEMA "gym-admin-portal" FROM PUBLIC;
-- No CREATE on the schema: the app role cannot create or alter objects.
GRANT USAGE ON SCHEMA "gym-admin-portal" TO gym_app;

-- All sessions in this database use UTC (instants are stored as timestamptz; gym-local
-- times are derived with AT TIME ZONE <gym timezone>).
ALTER DATABASE {{DATABASE}} SET timezone TO 'UTC';

-- Session defaults for the app role in this database.
ALTER ROLE gym_app IN DATABASE {{DATABASE}} SET search_path = "gym-admin-portal";
ALTER ROLE gym_app IN DATABASE {{DATABASE}} SET statement_timeout = '15s';
ALTER ROLE gym_app IN DATABASE {{DATABASE}} SET idle_in_transaction_session_timeout = '30s';
