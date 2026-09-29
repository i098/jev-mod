-- Custom SQL migration file, put your code below! --
CREATE TRIGGER guild_settings_insert_audit AFTER INSERT ON guild_settings
BEGIN
  INSERT INTO settings_audit (guild_id, actor_id, event, created_at)
  VALUES (NEW.guild_id, NEW.updated_by, 'Saved settings; mode=' || json_extract(NEW.config, '$.mode'), NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER guild_settings_update_audit AFTER UPDATE ON guild_settings
BEGIN
  INSERT INTO settings_audit (guild_id, actor_id, event, created_at)
  VALUES (NEW.guild_id, NEW.updated_by, 'Saved settings; mode=' || json_extract(NEW.config, '$.mode'), NEW.updated_at);
END;
