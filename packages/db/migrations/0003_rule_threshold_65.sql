-- Reset existing rule thresholds once; preserve other settings and reject stale drafts.
UPDATE guild_settings
SET config = json_set(config, '$.rules', (
    SELECT json_group_array(json_set(value, '$.threshold', 0.65))
    FROM json_each(guild_settings.config, '$.rules')
  )),
  version = version + 1,
  updated_by = 'system:threshold-65',
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE EXISTS (
  SELECT 1 FROM json_each(guild_settings.config, '$.rules')
  WHERE json_extract(value, '$.threshold') != 0.65
);
