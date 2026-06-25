-- Enable pgaudit for 42 CFR Part 2 read-logging backstop.
-- Logs SELECT and DML at the database layer, independent of app-level access_log.
create extension if not exists pgaudit;

-- Hosted Supabase: the `postgres` role is NOT the database owner, so
-- `ALTER DATABASE ... SET pgaudit.log` is denied ("permission denied to set parameter").
-- Instead we scope to the `authenticated` role — every tenant session runs as
-- `authenticated`, so all tenant reads/writes are captured.
alter role authenticated set pgaudit.log = 'read, write';
alter role authenticated set pgaudit.log_relation = 'on';
