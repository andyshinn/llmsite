-- 0010: a merge hides the tool it merges away; remember its status so a split
-- can restore it. Merges before this column existed restore to 'queued'.
ALTER TABLE tool_merges ADD COLUMN from_status TEXT;
