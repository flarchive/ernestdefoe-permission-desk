# Permission Desk: working rules

- **PUBLIC, free MIT (Ernest, 2026-11-19):** released on GitHub + Packagist, installed on all five live forums. Announced on ernestdefoe.online ONLY for now: no Discuss thread (leave the repo's DISCUSS_DISCUSSION_ID variable unset) and no showcase until Ernest says so.
- Commit straight to `main`; never open a pull request. Subjects `feat:` / `fix:`.
- `js/dist` is committed and is what forums load. After any change under `js/src`, `npm run build` in `js/` (from a fresh `npm ci`) and commit the bundle; CI fails if it is stale.
- Every change goes to the Command Center (`local_f246f111-…`) for review first.
- Scope and Ernest's decisions: `~/github/command-center/scopes/permissions.md`. Mockup: https://claude.ai/artifact/TNes129aUwrkwrbmCPo9LE

## Design rules that exist for a reason

- **Only core writes group_permission.** `Writer` calls core's own `SetPermissionController` (the handler behind `POST /api/permission`) once per permission inside ONE transaction. Never `Permission::insert` ourselves.
- flarum/audit logs core's endpoint with HTTP middleware, which a direct controller call skips, so `Writer` logs the same `permission_changed` payload itself (guarded: enabled + class_exists).
- **Conflicts refuse the whole save (409):** each change carries the `before` the admin saw; any mismatch with the live table saves nothing.
- **Outside changes are history too:** `Watcher::check()` diffs the live table against the snapshot; runs before every save (OUTSIDE the save transaction, so a 409 never rolls back the outside entry), when History opens, and nightly (`permission-desk:check`). First run only snapshots.
- **One audit entry per permission:** our direct controller call skips audit's HTTP middleware (it only wraps `/permission`), so Writer's own log is the only one; AuditTest pins it.
- **Undo skips rows changed since** (current ≠ what that entry left), never overwrites them; an entry can be undone once.
- Effective permissions use core's own `User::permissionGroupIds()` (unconfirmed email and flarum/suspend's processor make a member a guest). Never re-implement it.
- Rows come from `app.registry` per extension, like core's grid; tag scoping follows flarum/tags' own rule. Guard tags, audit, suspend and Member Desk.
- Member Desk's button comes through its `MemberView.heroActions()` ItemList (added in member-desk for this).
- extend.php: string literals only. Index names: let Laravel generate them.

## Testing

- `touch /tmp/pd_test.sqlite; DB_DRIVER=sqlite DB_DATABASE=/tmp/pd_test.sqlite composer test:setup && composer test`, then `~/github/scopes/permission-desk/dbtests.sh` (MySQL `dev_` + PostgreSQL `t_`, prints driver + prefix). `composer analyse:phpstan`.
- Browser: `~/github/scopes/permission-desk/flows.mjs [1280|390] [dark]` on the local forum `~/Herd/deskdev` (https://deskdev.test, prefix `md_`), every flow + database checks.
