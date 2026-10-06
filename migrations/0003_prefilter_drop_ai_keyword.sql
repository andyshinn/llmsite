-- 0003: drop "ai" from the pre-filter keywords. On a 7-day HN sample it added
-- ~126 posts/day (284 -> 410), almost all general AI news, which is out of scope.
-- Removes only that entry, so any other edits to the list are kept.
UPDATE settings
SET value = (SELECT json_group_array(j.value) FROM json_each(settings.value) AS j WHERE j.value != 'ai')
WHERE key = 'prefilter_keywords';
