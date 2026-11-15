-- Run as ADMIN in Oracle Database Actions before importing historical odds.
-- Legacy sheet contains observation DATE but no observation TIME.
-- Do not insert these rows into DS_ODDS_HISTORY (requires a real timestamp).
CREATE TABLE DS_ODDS_DAILY_LEGACY (
 observation_id VARCHAR2(200) PRIMARY KEY,
 observed_date DATE NOT NULL,
 match_date DATE NOT NULL,
 match_label NVARCHAR2(600) NOT NULL,
 league NVARCHAR2(250),
 kickoff_local VARCHAR2(5),
 selection_label NVARCHAR2(600) NOT NULL,
 decimal_odds NUMBER(12,5) NOT NULL,
 confidence_label NVARCHAR2(100),
 source_selection_id NVARCHAR2(1000),
 source_row NUMBER NOT NULL,
 source_label VARCHAR2(80) DEFAULT 'ИСТОРИЯ КОЕФ.' NOT NULL,
 imported_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
 CONSTRAINT DS_ODDS_DAILY_LEGACY_CK CHECK (decimal_odds > 1)
);
CREATE INDEX DS_ODDS_DAILY_LEGACY_DATE_IDX ON DS_ODDS_DAILY_LEGACY(match_date,observed_date);
-- Grant separately as ADMIN:
GRANT SELECT, INSERT ON ADMIN.DS_ODDS_DAILY_LEGACY TO DEEPSTATS_APP;
