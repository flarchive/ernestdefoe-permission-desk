<?php

namespace ErnestDefoe\PermissionDesk\Tests\integration\api;

use Flarum\Group\Group;
use Flarum\Testing\integration\RetrievesAuthorizedUsers;
use Flarum\Testing\integration\TestCase;
use Illuminate\Database\ConnectionInterface;
use PHPUnit\Framework\Attributes\Test;

/**
 * With flarum/audit on, each permission a save changes is logged exactly as core's endpoint logs
 * it (`permission_changed`, old and new group ids). Without it, saving still works (PermissionDeskTest).
 */
class AuditTest extends TestCase
{
    use RetrievesAuthorizedUsers;

    protected function setUp(): void
    {
        parent::setUp();

        $this->extension('flarum-audit', 'ernestdefoe-permission-desk');
        $this->prepareDatabase([
            'group_permission' => [['permission' => 'discussion.hidePosts', 'group_id' => Group::MODERATOR_ID]],
        ]);
    }

    #[Test]
    public function every_changed_permission_lands_in_flarums_audit_log(): void
    {
        $r = $this->send($this->request('POST', '/api/permission-desk/changesets', [
            'authenticatedAs' => 1,
            'json' => ['changes' => [
                ['permission' => 'discussion.hidePosts', 'before' => [4], 'after' => [3, 4]],
                ['permission' => 'tag2.discussion.reply', 'before' => [], 'after' => [4]],
            ]],
        ]));
        $this->assertEquals(200, $r->getStatusCode(), (string) $r->getBody());

        $rows = $this->app()->getContainer()->make(ConnectionInterface::class)
            ->table('audit_log')->where('action', 'permission_changed')->orderBy('id')->get();

        // Exactly one entry per permission: our call to core's controller skips audit's HTTP
        // middleware (it only wraps the /permission route), so the Writer's own log is the only one.
        $this->assertCount(2, $rows);
        $perPermission = array_count_values(array_map(fn ($r) => json_decode($r->payload, true)['permission'], $rows->all()));
        $this->assertEquals(['discussion.hidePosts' => 1, 'tag2.discussion.reply' => 1], $perPermission);
        $payload = json_decode($rows[0]->payload, true);
        $this->assertEquals('discussion.hidePosts', $payload['permission']);
        $this->assertEquals([4], $payload['old_group_ids']);
        $this->assertEquals([3, 4], $payload['new_group_ids']);
        $this->assertEquals(1, (int) $rows[0]->actor_id);
    }

    #[Test]
    public function cores_own_endpoint_is_still_logged_once_by_audit_itself(): void
    {
        // Saving through core's grid (POST /api/permission) is audit's middleware path, not ours.
        $r = $this->send($this->request('POST', '/api/permission', [
            'authenticatedAs' => 1,
            'json' => ['permission' => 'discussion.lock', 'groupIds' => [4]],
        ]));
        $this->assertEquals(204, $r->getStatusCode());

        $this->assertEquals(1, $this->app()->getContainer()->make(ConnectionInterface::class)
            ->table('audit_log')->where('action', 'permission_changed')->count());
    }
}
