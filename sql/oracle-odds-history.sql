-- DeepStats odds observation history; execute after oracle-schema.sql.
-- Append-only snapshots preserve every distinct observed quote.
CREATE TABLE ds_odds_history (
 observation_id VARCHAR2(200) PRIMARY KEY,
 match_id VARCHAR2(160) NOT NULL,
 selection_id VARCHAR2(200),
 bookmaker VARCHAR2(80) NOT NULL,
 market NVARCHAR2(200) NOT NULL,
 outcome NVARCHAR2(250) NOT NULL,
 decimal_odds NUMBER(12,5) NOT NULL,
 observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
 source_label VARCHAR2(80),
 imported_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
 CONSTRAINT ds_odds_match_fk FOREIGN KEY (match_id) REFERENCES ds_matches(match_id),
 CONSTRAINT ds_odds_value_ck CHECK (decimal_odds > 1)
);
CREATE INDEX ds_odds_match_time_idx ON ds_odds_history(match_id,observed_at);
CREATE INDEX ds_odds_book_market_idx ON ds_odds_history(bookmaker,market,observed_at);
-- Deterministic observation_id from source ID + bookmaker + market + outcome + timestamp.
-- Never fabricate observed_at for old rows that lack a real capture timestamp.
-- Retain future match quotes in Google Sheets until match_date < today in Europe/Sofia.
