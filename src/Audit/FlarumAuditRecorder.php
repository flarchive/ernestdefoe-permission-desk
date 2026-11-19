<?php

namespace ErnestDefoe\PermissionDesk\Audit;

use Flarum\Audit\AuditLogger;
use Flarum\User\User;

/**
 * flarum/audit logs core's POST /api/permission with middleware on that HTTP route. Permission Desk
 * calls core's handler directly (src/Writer.php), which that middleware never sees, so this writes
 * the same `permission_changed` entry it would. Bound only while flarum/audit is enabled.
 */
class FlarumAuditRecorder extends AuditRecorder
{
    public function permissionChanged(User $actor, string $permission, array $before, array $after): void
    {
        // The middleware normally sets the actor; outside an HTTP request it is still empty.
        AuditLogger::$actor ??= $actor;
        AuditLogger::log('permission_changed', [
            'permission' => $permission,
            'old_group_ids' => $before,
            'new_group_ids' => $after,
        ]);
    }
}
