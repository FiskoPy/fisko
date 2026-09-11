-- Close Supabase's automatic REST API over this schema.
--
-- Supabase publishes the `public` schema through PostgREST to the `anon` and
-- `authenticated` roles, and its default privileges grant them
-- SELECT/INSERT/UPDATE/DELETE (arwdDxtm) on every new table — with row level
-- security OFF. Verified on the live project before this migration existed.
-- So the tables below would have been readable and writable by anyone holding
-- the project's anon key, which Supabase treats as public (it is meant to ship
-- in browsers): user password hashes, encrypted mailbox credentials, and every
-- invoice.
--
-- This app never uses that API. It talks to Postgres directly as the owner of
-- these tables, and a table owner is not subject to (non-forced) RLS. So RLS
-- with no policies denies the REST path completely while leaving the app
-- unaffected.
--
-- Written to be a no-op on plain Postgres (local dev, the test database): the
-- Supabase roles do not exist there, so the revokes are skipped.

DO $$
DECLARE
  t record;
BEGIN
  -- Every table in public, including any added before this ran.
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    -- And for tables created later by this same role, so a future migration
    -- cannot silently re-open the hole. A NEW TABLE STILL NEEDS ITS OWN
    -- "ENABLE ROW LEVEL SECURITY" — default privileges do not cover RLS.
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
  END IF;
END $$;
