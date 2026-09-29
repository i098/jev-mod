# Jev-Mod: moderation bot references

Research date: 2026-09-28.
Sources are project repositories, project documentation, and project websites.
No source code was copied, installed, or executed.
Maintenance dates below are repository signals, not security or reliability audits.

## Recommendation

Use YAGPDB as the main product reference for familiar moderation configuration, Red for filter scopes and moderation records, and Zeppelin for rule overrides.
Build a focused Jev-Mod rather than adopting an entire general-purpose bot.
Treat Modmail as an optional future appeals reference, not a message-filtering baseline.

Zeppelin is currently **source available under Elastic License 2.0**, which includes a hosted-service restriction.
Do not describe it as unrestricted OSS or use its code as the basis for a public hosted bot without a license review.
Its behavior remains a useful product reference.
[Current Zeppelin license](https://github.com/ZeppelinBot/Zeppelin/blob/master/LICENSE.md).

## Compared projects

### YAGPDB — strongest direct reference

- License: MIT, as reported by the repository metadata.
- Moderation: warnings, message cleanup, temporary mutes and bans, action notifications, moderation logs, and automated actions after repeated violations within a time window.
- Dashboard: Discord login, server selection, and a web control panel; setup requires Manage Server permission.
- Configuration: per-server rules; its Automod design document separates triggers, conditions, effects, user filters, and channel filters.
- Maintenance: repository last pushed 2026-09-27; latest release `v2.87.1` published 2026-09-27.
- Borrow: one rule has a detection condition, an action, and exceptions; show enforcement status and a readable incident history.
- Avoid: copying its broad feature set, plugin architecture, or PostgreSQL-plus-Redis deployment just to deliver message moderation.

The Automod README calls itself a design brainstorm; it is useful architecture evidence, but does not prove every listed option ships.
The live control panel now directs users to slash commands after disabling built-in prefix commands on 2026-09-15.

Sources: [repository and license metadata](https://github.com/botlabs-gg/yagpdb), [moderation feature list](https://yagpdb.xyz/), [control panel and permissions](https://yagpdb.xyz/manage), [Automod design](https://github.com/botlabs-gg/yagpdb/blob/master/automod/README.md), [latest observed release](https://github.com/botlabs-gg/yagpdb/releases/tag/v2.87.1).

### Red DiscordBot + Red-Web-Dashboard — useful self-hosted reference

- Licenses: Red is GPL-3.0; the separately maintained Red-Web-Dashboard is AGPL-3.0.
- Moderation: server and channel word filters, repeated-message deletion, mention-spam controls, kicks, bans, slowmode, and moderation cases.
- Dashboard: an additional webserver and companion cog use Discord OAuth; the dashboard exposes controls according to the logged-in user's permission.
- Configuration: server-wide settings and channel-specific filters; the dashboard also supports per-guild extension pages.
- Permissions: filter editing requires a moderator role; filter settings require an administrator role; moderation configuration can require the server owner.
- Maintenance: Red last pushed 2026-09-07; stable release `3.5.24` published 2026-03-06; dashboard last pushed 2026-07-02.
- Borrow: channel exceptions, explicit moderation roles, action reasons, case IDs, and per-member case history.
- Avoid: needing third-party cogs or a plugin ecosystem for basic Jev-Mod settings.

Red checks moderator role hierarchy by default; the documentation warns that disabling it lets moderators target higher roles.
Its ban notification settings support an appeal link.

Sources: [Red repository](https://github.com/Cog-Creators/Red-DiscordBot), [filter guide](https://docs.discord.red/en/stable/cog_guides/filter.html), [moderation guide](https://docs.discord.red/en/stable/cog_guides/mod.html), [case guide](https://docs.discord.red/en/stable/cog_guides/modlog.html), [dashboard repository and OAuth model](https://github.com/AAA3A-AAA3A/Red-Web-Dashboard), [dashboard extension scopes](https://red-web-dashboard.readthedocs.io/en/latest/third_parties.html), [Red release](https://github.com/Cog-Creators/Red-DiscordBot/releases/tag/3.5.24).

### Zeppelin — focused moderation and policy reference

- License: Elastic License 2.0; this is a source-available comparison, not an unrestricted OSS candidate.
- Moderation: word filters, spam detection, moderation cases and notes, configurable logs, warnings, mutes, kicks, and bans.
- Dashboard: full web configuration with Discord OAuth.
- Configuration: overrides can vary by user, channel, and permission level; Automod connects triggers to actions.
- Permissions: roles map to permission levels and moderation commands have individual permissions.
- Maintenance: repository last pushed 2026-09-09; not archived when checked.
- Borrow: clear rule exclusions, moderator notes, and a record of why an action occurred.
- Avoid: making administrators write YAML for routine Jev-Mod configuration or exposing a large override language in the first version.

Sources: [repository](https://github.com/ZeppelinBot/Zeppelin), [license](https://github.com/ZeppelinBot/Zeppelin/blob/master/LICENSE.md), [Automod configuration](https://zeppelin.gg/docs/plugins/automod/configuration), [moderation permissions](https://zeppelin.gg/docs/setup-guides/moderation), [dashboard and stored-data description](https://zeppelin.gg/privacy-policy).

### Modmail — optional appeals reference only

- License: AGPL-3.0, as reported by repository metadata.
- Function: a shared inbox between members and staff, with private staff notes and saved conversation logs.
- Web interface: a separate read-only Logviewer; this is not a moderation configuration dashboard.
- Configuration: one main guild plus an optional separate staff guild; configuration uses Discord commands and environment settings.
- Permissions: named levels and per-command grants can target roles or individual users.
- Maintenance: repository last pushed 2026-08-29; not archived when checked.
- Borrow later: appeal conversations, staff-only notes, and explicit case closure.
- Avoid now: ticket channels, DM relay, and a separate log application.

Sources: [repository](https://github.com/modmail-dev/Modmail), [usage and read-only Logviewer](https://docs.modmail.dev/usage-guide), [permission model](https://docs.modmail.dev/usage-guide/permissions), [main and staff guild setup](https://docs.modmail.dev/installation).

## Minimum familiar Jev-Mod product

These are recommendations derived from the comparison, not confirmed user requirements.

1. Discord login, a server selector, and a clear connection and permission status.
2. A Rules page with enabled categories, an action per rule, channel and role exceptions, and custom blocked phrases or domains.
3. Jev classification for meaning-based categories, plus simple local controls for repeated messages and excessive mentions.
4. Separate monitoring and automatic-deletion modes; the server administrator must be able to see which mode is active.
5. A test-message panel that displays the proposed rule match and action without posting or deleting a Discord message.
6. A moderation log with case ID, time, channel, member, matched rule, reason, and the actual action outcome.
7. A configurable moderator log channel and explicit access checks for every server-specific dashboard request.
8. A settings audit trail and a clear error when Jev or Discord cannot complete an action.

Keep automatic bans, mass bans, anti-raid systems, member verification, image moderation, appeals, billing, and plugin support outside the first version unless requested.
Prefer slash commands for essential moderator controls, following YAGPDB's current direction.
The selected installation scope is recorded in [the product objective](spec.md#objective).

## Evidence limits

Public documentation and repository metadata were checked; no authenticated dashboard was inspected.
YAGPDB's help site blocked the web fetch, so its public feature page, control panel, and repository design document were used instead.
No claims are made about benchmark speed, classification quality, security audit results, or suitability of copied code.
