-- Run these statements once in Oracle Autonomous Database SQL Worksheet
-- while connected as ADMIN (the owner of DeepStats archive tables).
-- Grants only the permissions required by the existing builder importer.
-- Does not modify or delete any archived data.
GRANT SELECT, INSERT, UPDATE ON ADMIN.DS_BUILDERS TO DEEPSTATS_APP;
GRANT SELECT, INSERT, UPDATE, DELETE ON ADMIN.DS_BUILDER_LEGS TO DEEPSTATS_APP;

-- Optional verification while logged in as ADMIN:
SELECT grantee, table_name, privilege
FROM dba_tab_privs
WHERE owner = 'ADMIN'
  AND grantee = 'DEEPSTATS_APP'
  AND table_name IN ('DS_BUILDERS','DS_BUILDER_LEGS')
ORDER BY table_name, privilege;
