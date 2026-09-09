-- §4 calls out List-Id presence as an automation indicator, but §3's
-- messages schema only listed has_list_unsubscribe. Add the matching column
-- so the classifier can stay faithful to the spec without re-parsing headers.

ALTER TABLE messages ADD COLUMN has_list_id INTEGER NOT NULL DEFAULT 0;
