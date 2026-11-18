-- ONE-TIME INSTALL. Run in Oracle Database Actions > SQL Worksheet as ADMIN.
-- Preserves every existing object; never deletes or truncates data.
-- The application account cannot CREATE TABLE (ORA-01031).
--
-- If a prior attempt already created the table, do NOT repeat CREATE TABLE.
-- First check: SELECT table_name FROM user_tables WHERE table_name='DS_RAW_SHEET_ROWS';

CREATE TABLE ADMIN.DS_RAW_SHEET_ROWS (
  SNAPSHOT_DAY VARCHAR2(10) NOT NULL,
  SHEET_ID NUMBER NOT NULL,
  SHEET_NAME NVARCHAR2(250) NOT NULL,
  ROW_NUMBER NUMBER NOT NULL,
  COLUMN_COUNT NUMBER NOT NULL,
  RAW_JSON CLOB NOT NULL,
  ROW_SHA256 VARCHAR2(64) NOT NULL,
  ARCHIVED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT DS_RAW_SHEET_ROWS_PK PRIMARY KEY (SNAPSHOT_DAY, SHEET_ID, ROW_NUMBER),
  CONSTRAINT DS_RAW_SHEET_ROWS_JSON CHECK (RAW_JSON IS JSON)
);

-- The app's ORACLE_USER must have SELECT, INSERT, UPDATE on this table.
-- If the configured ORACLE_USER is ADMIN, skip this grant entirely.
-- Otherwise substitute its real Oracle database username below and run as ADMIN:
-- GRANT SELECT, INSERT, UPDATE ON ADMIN.DS_RAW_SHEET_ROWS TO APPLICATION_USERNAME;
--
-- Read-only verification:
SELECT COUNT(*) AS ARCHIVED_ROWS FROM ADMIN.DS_RAW_SHEET_ROWS;
