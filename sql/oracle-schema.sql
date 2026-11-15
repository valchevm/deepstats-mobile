-- DeepStats Oracle Autonomous Database schema (run as the dedicated DeepStats schema owner).
-- Does not modify existing Oracle objects.
CREATE TABLE ds_matches (
 match_id VARCHAR2(160) PRIMARY KEY,
 match_date DATE NOT NULL,
 kickoff_utc TIMESTAMP WITH TIME ZONE,
 league NVARCHAR2(250),
 home_team NVARCHAR2(250),
 away_team NVARCHAR2(250),
 match_label NVARCHAR2(600),
 final_score NVARCHAR2(60),
 created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE INDEX ds_matches_date_idx ON ds_matches(match_date);
CREATE TABLE ds_selections (
 selection_id VARCHAR2(200) PRIMARY KEY,
 match_id VARCHAR2(160),
 match_date DATE NOT NULL,
 source_type VARCHAR2(40) NOT NULL,
 selection_label NVARCHAR2(600) NOT NULL,
 odds NUMBER(12,5),
 level_label NVARCHAR2(100),
 result_label NVARCHAR2(100),
 result_status VARCHAR2(12) DEFAULT 'pending' NOT NULL,
 profit_units NUMBER(14,5),
 source_row_json CLOB CHECK (source_row_json IS JSON),
 archived_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
 CONSTRAINT ds_sel_match_fk FOREIGN KEY(match_id) REFERENCES ds_matches(match_id),
 CONSTRAINT ds_sel_status_ck CHECK(result_status IN ('win','loss','void','pending'))
);
CREATE INDEX ds_sel_date_idx ON ds_selections(match_date);
CREATE INDEX ds_sel_source_idx ON ds_selections(source_type,match_date);
CREATE TABLE ds_builders (
 builder_id VARCHAR2(200) PRIMARY KEY,
 builder_date DATE NOT NULL,
 builder_type VARCHAR2(40) NOT NULL,
 odds NUMBER(14,6),
 result_status VARCHAR2(12) DEFAULT 'pending' NOT NULL,
 profit_units NUMBER(14,5),
 source_row_json CLOB CHECK (source_row_json IS JSON),
 archived_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
 CONSTRAINT ds_builder_status_ck CHECK(result_status IN ('win','loss','void','pending'))
);
CREATE INDEX ds_builders_date_idx ON ds_builders(builder_date);
CREATE TABLE ds_builder_legs (
 builder_id VARCHAR2(200) NOT NULL,
 leg_number NUMBER(5) NOT NULL,
 selection_id VARCHAR2(200),
 match_label NVARCHAR2(600),
 selection_label NVARCHAR2(600),
 odds NUMBER(12,5),
 result_status VARCHAR2(12),
 CONSTRAINT ds_legs_pk PRIMARY KEY(builder_id,leg_number),
 CONSTRAINT ds_legs_builder_fk FOREIGN KEY(builder_id) REFERENCES ds_builders(builder_id)
);
CREATE TABLE ds_strategies (
 strategy_id VARCHAR2(80) PRIMARY KEY,
 strategy_name NVARCHAR2(250) NOT NULL,
 configuration_json CLOB CHECK (configuration_json IS JSON),
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE TABLE ds_selection_strategies (
 selection_id VARCHAR2(200) NOT NULL,
 strategy_id VARCHAR2(80) NOT NULL,
 CONSTRAINT ds_ss_pk PRIMARY KEY(selection_id,strategy_id),
 CONSTRAINT ds_ss_selection_fk FOREIGN KEY(selection_id) REFERENCES ds_selections(selection_id),
 CONSTRAINT ds_ss_strategy_fk FOREIGN KEY(strategy_id) REFERENCES ds_strategies(strategy_id)
);
CREATE TABLE ds_archive_batches (
 batch_id VARCHAR2(120) PRIMARY KEY,
 business_date DATE NOT NULL,
 source_sheet VARCHAR2(120) NOT NULL,
 expected_rows NUMBER NOT NULL,
 confirmed_rows NUMBER DEFAULT 0 NOT NULL,
 status VARCHAR2(20) DEFAULT 'staging' NOT NULL,
 started_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
 confirmed_at TIMESTAMP WITH TIME ZONE,
 CONSTRAINT ds_batch_status_ck CHECK(status IN ('staging','verified','cleaned','failed'))
);
-- Archive jobs should use MERGE keyed by stable IDs; never blindly INSERT duplicates.
-- Do not remove source Sheet rows until Oracle counts and checksums are verified.
