---
name: wallpaper-control
description: Use when the user wants to enable or adjust Codex Wallpaper, open its independent Windows manager, or diagnose wallpaper connection and update compatibility errors.
---

Use wallpaper_status to inspect current state before reporting that a theme is enabled. desired.enabled is a preference; only observed.applied confirms the current host has received the effects.

Use wallpaper_open_manager to show the independent manager. It remains the source of visible status when host integration is unavailable. Use wallpaper_set_enabled or wallpaper_set_settings for requested changes, and wallpaper_reconnect for requested re-detection. Do not change settings merely to test connectivity.

When HOST_NEEDS_MANAGED_LAUNCH appears, explain that the current ordinary window has no connection endpoint. The manager can wait for the user to exit normally. Never force-close the host or claim that a restart has happened.

For update errors, report the current version, compatibility classification and fixed error code. Structural compatibility is not the same as manual validation. Do not add a version to an allowlist to hide an error.

Only export diagnostics when useful for the user's requested troubleshooting. Do not read or send chats, request credentials, modify the installed host, or create a new chat to refresh the plugin without an explicit user request.
