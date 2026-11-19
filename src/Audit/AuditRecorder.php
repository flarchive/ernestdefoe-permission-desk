<?php

namespace ErnestDefoe\PermissionDesk\Audit;

use Flarum\User\User;

/**
 * Where each saved permission change is also recorded. Does nothing on its own; with flarum/audit
 * enabled, extend.php binds FlarumAuditRecorder instead (Extend\Conditional).
 */
class AuditRecorder
{
    /**
     * @param int[] $before
     * @param int[] $after
     */
    public function permissionChanged(User $actor, string $permission, array $before, array $after): void
    {
    }
}
