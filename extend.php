<?php

/*
 * Permission Desk: a group-first replacement for the admin Permissions page (core's grid comes
 * back when it is switched off, and stays one click away at #/permissions/classic).
 *
 * Admins only. Presets are a JSON:API resource; the rest are actions with one controller each
 * under /api/permission-desk (src/Api/Controller). Saves write group_permission ONLY through
 * core's own SetPermissionController (src/Writer.php).
 *
 * 🚨 String literals only below, never a class constant read at load time: it autoloads during
 * boot and fatals every request while a deploy is swapping composer's autoload map.
 */

use ErnestDefoe\PermissionDesk\Api\Controller;
use ErnestDefoe\PermissionDesk\Api\PresetResource;
use ErnestDefoe\PermissionDesk\Audit\AuditServiceProvider;
use ErnestDefoe\PermissionDesk\Console\CheckCommand;
use Flarum\Extend;
use Illuminate\Console\Scheduling\Event as ScheduledEvent;

return [
    (new Extend\Frontend('admin'))
        ->js(__DIR__.'/js/dist/admin.js')
        ->css(__DIR__.'/less/admin.less'),

    new Extend\Locales(__DIR__.'/locale'),

    (new Extend\Routes('api'))
        ->post('/permission-desk/check', 'permission-desk.check', Controller\CheckController::class)
        ->get('/permission-desk/history', 'permission-desk.history', Controller\HistoryController::class)
        ->post('/permission-desk/changesets', 'permission-desk.save', Controller\SaveController::class)
        ->post('/permission-desk/changesets/{id:\d+}/undo', 'permission-desk.undoPlan', Controller\UndoPlanController::class)
        ->post('/permission-desk/changesets/{id:\d+}/restore', 'permission-desk.restorePlan', Controller\RestorePlanController::class)
        ->get('/permission-desk/members/{id:\d+}', 'permission-desk.member', Controller\MemberController::class),

    new Extend\ApiResource(PresetResource::class),

    // flarum/audit logs core's permission endpoint with HTTP middleware that our direct call to
    // core's handler skips; while it's enabled, each change is logged the same way.
    (new Extend\Conditional())
        ->whenExtensionEnabled('flarum-audit', fn () => [
            (new Extend\ServiceProvider())->register(AuditServiceProvider::class),
        ]),

    (new Extend\Console())
        ->command(CheckCommand::class)
        ->schedule(CheckCommand::class, function (ScheduledEvent $event) {
            $event->daily()->withoutOverlapping();
        }),
];
