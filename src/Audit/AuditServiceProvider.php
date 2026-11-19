<?php

namespace ErnestDefoe\PermissionDesk\Audit;

use Flarum\Foundation\AbstractServiceProvider;

/** Registered only while flarum/audit is enabled (extend.php). */
class AuditServiceProvider extends AbstractServiceProvider
{
    public function register(): void
    {
        $this->container->bind(AuditRecorder::class, FlarumAuditRecorder::class);
    }
}
