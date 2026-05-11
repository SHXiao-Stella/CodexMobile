# Changelog

All notable changes to CodexMobile are tracked here.

## Unreleased

### Changed

- Changed the composer default permission mode from `bypassPermissions` to `default`, while keeping full access available as an explicit opt-in.
- Marked Codex Desktop IPC handoff turns as steerable so mobile sends can continue an active desktop-owned turn directly.

### Fixed

- Fixed Windows Codex Desktop IPC sends in default permission mode by sending a complete `workspaceWrite` sandbox policy, including `writableRoots`.
- Fixed mobile-to-desktop sends that only appeared in Codex Desktop after restarting the desktop app by requesting a desktop-owned thread snapshot refresh after accepted IPC handoff.
- Fixed stale draft-session handling so existing desktop thread ids are not treated as mobile drafts.
- Fixed desktop-thread owner failures from incorrectly falling back to a background runner for already selected desktop sessions.
- Fixed generic tool `TypeError` messages being mislabeled as browser-operation failures in the mobile activity timeline.

## [1.2.0] - 2026-05-09

### Added

- Added a system theme option so CodexMobile can follow the OS light/dark preference across the main app and file preview flow.
- Added a model speed selector in the composer model menu, with Standard and Fast choices persisted locally.
- Added end-to-end service tier routing so Fast model speed sends `fast` through chat requests, desktop IPC, and headless Codex runs.
- Added compact memory citation cards for `<oai-mem-citation>` blocks in chat output.

### Changed

- Replaced the README screenshots with redacted dark/light demos that show the sidebar, running state, and desktop-style tool activity flow.
- Synced PWA theme color updates with the resolved light/dark mode when following the system theme.

## [1.0.0] - 2026-05-09

### Added

- Added a queue panel for running conversations: queued drafts can be viewed, restored, deleted, or sent immediately as steer input.
- Added composer shortcuts with `/` commands for status, context compaction, code review, and sub-agent workflows.
- Added `$skill` autocomplete backed by the existing skills list.
- Added `@file` search backed by a project-local file search API that ignores generated and dependency directories.
- Added file mention support for chat sends so selected local paths can be attached as context.
- Added an expanded Git panel with status, diff preview, pull, sync, and commit+push actions.
- Added foreground toast notifications for Git progress, task completion, failures, and user-input prompts.
- Added Web Push support for installed HTTPS PWAs, including service worker handling and server-side subscription storage.
- Added a compact connection recovery card for reconnecting, syncing, repairing pairing, and checking status.
- Added desktop thread status badges so mobile can distinguish IPC online, thread pending confirmation, and background execution before sending.
- Added unified sidebar run indicators for desktop-origin and mobile-origin sends.
- Added clean dark and light mode project screenshots for the 1.0 README.

### Changed

- Kept completed task activity collapsed by default while preserving the full execution text when expanded.
- Improved mobile activity rendering and reduced noisy lifecycle messages.
- Unified desktop IPC and background fallback readback so both paths refresh from the same session stream.
- Simplified transient background startup UI to avoid duplicate middle activity cards.
- Matched mobile activity labels and icons more closely to Codex Desktop for commands, files, and skills.
- Split the large server entrypoint into route and service modules for safer extension.
- Rewrote README to describe CodexMobile as a local Codex mobile workbench rather than a thin upstream UI fork.
- Updated package metadata to describe the current mobile workbench scope.

### Fixed

- Fixed mobile abort so it interrupts desktop-side runs instead of only clearing the mobile state.
- Fixed desktop-origin sends not showing running and completed indicators in the mobile sidebar.
- Fixed mobile-created background threads briefly losing their live session during startup.
- Fixed refresh occasionally jumping to another conversation instead of restoring the selected project and session.
- Fixed duplicate running cards during mobile-to-desktop background handoff.
- Fixed a scroll jump that could move the conversation back to the top after a send.

### Notes

- `1.0.0` is the first stable local mobile Codex workbench release.
- iOS background notifications require an HTTPS Home Screen PWA. Local HTTP access still works for chat, sync, and foreground toast.
- `sync` is defined as `pull --ff-only` followed by `push` when the branch is ahead.
