<?php

namespace ErnestDefoe\PermissionDesk\Tests\integration\api;

use Carbon\Carbon;
use Flarum\Group\Group;
use Flarum\Testing\integration\RetrievesAuthorizedUsers;
use Flarum\Testing\integration\TestCase;
use Flarum\User\User;
use Illuminate\Database\ConnectionInterface;
use PHPUnit\Framework\Attributes\Test;
use Psr\Http\Message\ResponseInterface;

/**
 * Users: 1 admin, 2 normal (confirmed member), 3 mod (Mods), 4 unconfirmed (in Mods, email not
 * confirmed), 5 suspended (in Mods, suspended for a week), 6 trusted (Trusted group 10).
 * Tag 7 is a restricted tag: `tag7.*` keys hold its permissions.
 */
class PermissionDeskTest extends TestCase
{
    use RetrievesAuthorizedUsers;

    protected function setUp(): void
    {
        parent::setUp();

        $this->extension('flarum-suspend', 'ernestdefoe-permission-desk');

        $user = fn (int $id, string $name, array $extra = []) => $extra + [
            'id' => $id, 'username' => $name, 'email' => "$name@machine.local", 'is_email_confirmed' => 1,
            'joined_at' => Carbon::now()->subDays(30),
        ];

        $this->prepareDatabase([
            User::class => [
                $this->normalUser(),
                $user(3, 'mod'),
                $user(4, 'unconfirmed', ['is_email_confirmed' => 0]),
                $user(5, 'suspended', ['suspended_until' => Carbon::now()->addWeek()]),
                $user(6, 'trusted'),
            ],
            Group::class => [
                ['id' => 10, 'name_singular' => 'Trusted', 'name_plural' => 'Trusted', 'color' => '#1e7a3c', 'icon' => null, 'is_hidden' => 0],
            ],
            'group_user' => [
                ['user_id' => 3, 'group_id' => Group::MODERATOR_ID],
                ['user_id' => 4, 'group_id' => Group::MODERATOR_ID],
                ['user_id' => 5, 'group_id' => Group::MODERATOR_ID],
                ['user_id' => 6, 'group_id' => 10],
            ],
            'group_permission' => [
                ['permission' => 'viewForum', 'group_id' => Group::GUEST_ID],
                ['permission' => 'startDiscussion', 'group_id' => Group::MEMBER_ID],
                ['permission' => 'discussion.reply', 'group_id' => Group::MEMBER_ID],
                ['permission' => 'discussion.hidePosts', 'group_id' => Group::MODERATOR_ID],
                ['permission' => 'tag7.viewForum', 'group_id' => Group::MODERATOR_ID],
                ['permission' => 'tag7.discussion.reply', 'group_id' => Group::MODERATOR_ID],
            ],
        ]);
    }

    /**
     * A save runs core's own SetPermissionController once per changed permission (Ernest's pick:
     * every write goes through core's handler, its admin check and cache flush), so a bulk save
     * repeats its delete + insert per permission by design. Nothing else may repeat.
     *
     * @return string[]
     */
    protected function allowedRepeatedQueries(): array
    {
        return [
            'group_permission" where "permission" = ?',
            'group_permission` where `permission` = ?',
            'group_permission" ("group_id", "permission")',
            'group_permission` (`group_id`, `permission`)',
        ];
    }

    /** @param array<string, mixed> $json */
    protected function call(string $method, string $path, int $as = 1, array $json = []): ResponseInterface
    {
        $opts = ['authenticatedAs' => $as];
        if ($json) {
            $opts['json'] = $json;
        }

        return $this->send($this->request($method, '/api/permission-desk'.$path, $opts));
    }

    /** @return array<string, mixed> */
    protected function json(ResponseInterface $r): array
    {
        return json_decode((string) $r->getBody(), true) ?? [];
    }

    /** @return int[] */
    protected function groupsWith(string $permission): array
    {
        $ids = $this->app()->getContainer()->make(ConnectionInterface::class)
            ->table('group_permission')->where('permission', $permission)->pluck('group_id')->map(fn ($id) => (int) $id)->all();
        sort($ids);

        return $ids;
    }

    /** @param array<int, array{0: string, 1: int[], 2: int[]}> $rows */
    protected function save(array $rows, array $extra = [], int $as = 1): ResponseInterface
    {
        return $this->call('POST', '/changesets', $as, $extra + ['changes' => array_map(fn ($r) => ['permission' => $r[0], 'before' => $r[1], 'after' => $r[2]], $rows)]);
    }

    #[Test]
    public function only_admins_can_use_any_endpoint(): void
    {
        foreach ([['GET', '/history'], ['POST', '/check'], ['GET', '/members/2'], ['POST', '/changesets/1/undo'], ['POST', '/changesets/1/restore']] as [$method, $path]) {
            $this->assertEquals(403, $this->call($method, $path, 3)->getStatusCode(), $path);
            $this->assertEquals(403, $this->call($method, $path, 2)->getStatusCode(), $path);
        }
        foreach ([3, 2] as $as) {
            $this->assertEquals(403, $this->send($this->request('GET', '/api/permission-desk-presets', ['authenticatedAs' => $as]))->getStatusCode());
        }

        $this->assertEquals(403, $this->save([['discussion.hidePosts', [4], [4, 10]]], [], 3)->getStatusCode());
        $this->assertEquals([4], $this->groupsWith('discussion.hidePosts'));
    }

    #[Test]
    public function a_save_writes_through_core_and_lands_in_history(): void
    {
        $r = $this->save([
            ['discussion.hidePosts', [4], [4, 10]],
            ['tag7.discussion.reply', [4], [3]],
            ['discussion.deletePosts', [], [4]],
        ], ['note' => 'Trusted helps moderate']);

        $this->assertEquals(200, $r->getStatusCode(), (string) $r->getBody());
        $body = $this->json($r);

        $this->assertEquals([4, 10], $this->groupsWith('discussion.hidePosts'));
        $this->assertEquals([3], $this->groupsWith('tag7.discussion.reply'));
        $this->assertEquals([4], $this->groupsWith('discussion.deletePosts'));
        $this->assertEquals([4, 10], $body['map']['discussion.hidePosts']);

        $history = $this->json($this->call('GET', '/history'));
        $entry = $history['changesets'][0];
        $this->assertEquals($body['changeset'], $entry['id']);
        $this->assertEquals('save', $entry['kind']);
        $this->assertEquals('Trusted helps moderate', $entry['note']);
        $this->assertEquals(1, $entry['actor']['id']);
        $this->assertCount(3, $entry['changes']);
        $byKey = array_column($entry['changes'], null, 'permission');
        $this->assertEquals(['before' => [4], 'after' => [3]], array_intersect_key($byKey['tag7.discussion.reply'], ['before' => 1, 'after' => 1]));

        // The new grant counts straight away (core's permission cache was flushed).
        $this->assertTrue(User::find(6)->hasPermission('discussion.hidePosts'));
    }

    #[Test]
    public function a_permission_changed_since_the_page_loaded_blocks_the_whole_save(): void
    {
        $r = $this->save([
            ['discussion.hidePosts', [], [10]], // the admin saw nobody; Mods have it now
            ['discussion.deletePosts', [], [4]],
        ]);

        $this->assertEquals(409, $r->getStatusCode());
        $this->assertEquals([4], $this->json($r)['conflicts']['discussion.hidePosts']);
        $this->assertEquals([], $this->groupsWith('discussion.deletePosts'), 'nothing is saved');
    }

    #[Test]
    public function bad_input_is_refused_and_admins_are_never_stored(): void
    {
        $this->assertEquals(422, $this->save([['not a key!', [], [4]]])->getStatusCode());
        $this->assertEquals(422, $this->save([['discussion.lock', [], [999]]])->getStatusCode());
        $this->assertEquals(422, $this->save([['discussion.lock', [], []]])->getStatusCode(), 'no change');

        $this->assertEquals(200, $this->save([['discussion.lock', [], [Group::ADMINISTRATOR_ID, 4]]])->getStatusCode());
        $this->assertEquals([4], $this->groupsWith('discussion.lock'));
    }

    #[Test]
    public function effective_permissions_follow_cores_own_groups_and_say_why(): void
    {
        // A confirmed member: Everyone + Members, nothing of Mods.
        $normal = $this->json($this->call('GET', '/members/2'));
        $this->assertEquals([Group::GUEST_ID, Group::MEMBER_ID], $normal['effectiveGroups']);
        $this->assertEquals(Group::GUEST_ID, $normal['granted']['viewForum'], 'inherited from Everyone');
        $this->assertEquals(Group::MEMBER_ID, $normal['granted']['discussion.reply'], 'inherited from Members');
        $this->assertArrayNotHasKey('discussion.hidePosts', $normal['granted']);
        $this->assertArrayNotHasKey('tag7.viewForum', $normal['granted'], 'restricted tag');

        // A moderator: their own group, including in the restricted tag.
        $mod = $this->json($this->call('GET', '/members/3'));
        $this->assertEquals(Group::MODERATOR_ID, $mod['granted']['discussion.hidePosts']);
        $this->assertEquals(Group::MODERATOR_ID, $mod['granted']['tag7.discussion.reply']);
        $this->assertEquals(Group::MEMBER_ID, $mod['granted']['startDiscussion']);

        // In Mods, but the email isn't confirmed: core treats them as a guest.
        $unconfirmed = $this->json($this->call('GET', '/members/4'));
        $this->assertFalse($unconfirmed['user']['isEmailConfirmed']);
        $this->assertEquals([Group::MODERATOR_ID], $unconfirmed['user']['groups']);
        $this->assertEquals([Group::GUEST_ID], $unconfirmed['effectiveGroups']);
        $this->assertEquals(['viewForum' => Group::GUEST_ID], $unconfirmed['granted']);

        // In Mods, but suspended: flarum/suspend's group processor makes them a guest.
        $suspended = $this->json($this->call('GET', '/members/5'));
        $this->assertNotNull($suspended['user']['suspendedUntil']);
        $this->assertEquals([Group::GUEST_ID], $suspended['effectiveGroups']);
        $this->assertEquals(['viewForum' => Group::GUEST_ID], $suspended['granted']);

        $admin = $this->json($this->call('GET', '/members/1'));
        $this->assertTrue($admin['isAdmin']);
    }

    #[Test]
    public function undo_reverses_one_entry_and_skips_rows_changed_since(): void
    {
        $first = $this->json($this->save([
            ['discussion.hidePosts', [4], [4, 10]],
            ['discussion.lock', [], [4]],
        ]))['changeset'];

        // discussion.lock changes again afterwards.
        $this->save([['discussion.lock', [4], [4, 10]]]);

        $plan = $this->json($this->call('POST', "/changesets/$first/undo"));
        $this->assertEquals(['discussion.lock'], $plan['skipped']);
        $this->assertEquals([['permission' => 'discussion.hidePosts', 'before' => [4, 10], 'after' => [4]]], $plan['changes']);

        $r = $this->save(array_map(fn ($c) => [$c['permission'], $c['before'], $c['after']], $plan['changes']), ['kind' => 'undo', 'undoOf' => $first]);
        $this->assertEquals(200, $r->getStatusCode(), (string) $r->getBody());

        $this->assertEquals([4], $this->groupsWith('discussion.hidePosts'));
        $this->assertEquals([4, 10], $this->groupsWith('discussion.lock'), 'the later change is kept');

        $history = $this->json($this->call('GET', '/history'))['changesets'];
        $byId = array_column($history, null, 'id');
        $this->assertEquals('undo', $byId[$this->json($r)['changeset']]['kind']);
        $this->assertEquals($this->json($r)['changeset'], $byId[$first]['undoneBy']);

        // Undone once is undone for good.
        $this->assertEquals(422, $this->call('POST', "/changesets/$first/undo")->getStatusCode());
        $this->assertEquals(422, $this->save([['discussion.hidePosts', [4], [4, 10]]], ['kind' => 'undo', 'undoOf' => $first])->getStatusCode());
    }

    #[Test]
    public function restore_puts_every_permission_back_to_right_after_an_entry(): void
    {
        $a = $this->json($this->save([['discussion.lock', [], [4]]]))['changeset'];
        $this->save([['discussion.lock', [4], [4, 10]], ['discussion.hidePosts', [4], []]]);
        $this->save([['discussion.lock', [4, 10], [10]]]);

        $plan = $this->json($this->call('POST', "/changesets/$a/restore"));
        $byKey = array_column($plan['changes'], null, 'permission');

        $this->assertEquals([10], $byKey['discussion.lock']['before']);
        $this->assertEquals([4], $byKey['discussion.lock']['after']);
        $this->assertEquals([4], $byKey['discussion.hidePosts']['after']);
        $this->assertCount(2, $plan['changes']);
    }

    #[Test]
    public function changes_made_outside_are_logged_before_anything_else(): void
    {
        $db = $this->app()->getContainer()->make(ConnectionInterface::class);

        // History only reads; the check is its own POST, which the History tab sends when it opens.
        $this->assertNull($this->json($this->call('POST', '/check'))['changeset'], 'the first check only takes the snapshot');
        $this->assertEquals([], $this->json($this->call('GET', '/history'))['changesets']);

        // Someone uses core's classic grid / a migration writes directly.
        $db->table('group_permission')->insert(['permission' => 'discussion.sticky', 'group_id' => 10]);
        $db->table('group_permission')->where('permission', 'startDiscussion')->delete();

        $this->assertEquals([], $this->json($this->call('GET', '/history'))['changesets'], 'a GET never writes');
        $this->assertIsInt($this->json($this->call('POST', '/check'))['changeset']);
        $sets = $this->json($this->call('GET', '/history'))['changesets'];
        $this->assertCount(1, $sets);
        $this->assertEquals('outside', $sets[0]['kind']);
        $this->assertNull($sets[0]['actor']);
        $byKey = array_column($sets[0]['changes'], null, 'permission');
        $this->assertEquals(['permission' => 'discussion.sticky', 'before' => [], 'after' => [10]], $byKey['discussion.sticky']);
        $this->assertEquals(['permission' => 'startDiscussion', 'before' => [3], 'after' => []], $byKey['startDiscussion']);

        // Seen once, logged once.
        $this->assertNull($this->json($this->call('POST', '/check'))['changeset']);
        $this->assertCount(1, $this->json($this->call('GET', '/history'))['changesets']);

        // A change outside, then a save: the outside entry comes first, then ours.
        $db->table('group_permission')->insert(['permission' => 'discussion.rename', 'group_id' => 10]);
        $this->save([['discussion.lock', [], [4]]]);
        $sets = $this->json($this->call('GET', '/history'))['changesets'];
        $this->assertEquals(['save', 'outside', 'outside'], array_column($sets, 'kind'));
        $this->assertEquals('discussion.rename', $sets[1]['changes'][0]['permission']);

        // The nightly check (permission-desk:check) runs the same Watcher.
        $db->table('group_permission')->insert(['permission' => 'discussion.tag', 'group_id' => 4]);
        $this->assertNotNull($this->app()->getContainer()->make(\ErnestDefoe\PermissionDesk\Watcher::class)->check());
        $this->assertNull($this->app()->getContainer()->make(\ErnestDefoe\PermissionDesk\Watcher::class)->check());
    }

    #[Test]
    public function a_check_waits_while_another_runs_so_nothing_is_logged_twice(): void
    {
        $container = $this->app()->getContainer();
        $db = $container->make(ConnectionInterface::class);
        $this->call('POST', '/check');
        $db->table('group_permission')->insert(['permission' => 'discussion.sticky', 'group_id' => 10]);

        // Another admin's check holds the lock: this one waits, then gives up rather than racing it.
        $lock = $container->make('cache.store')->getStore()->lock('permission-desk.check', 30);
        $this->assertTrue($lock->get());
        try {
            $this->expectException(\Illuminate\Contracts\Cache\LockTimeoutException::class);
            $container->make(\ErnestDefoe\PermissionDesk\Watcher::class)->check();
        } finally {
            $lock->release();
            $this->assertEquals(0, $db->table('permission_desk_changesets')->where('kind', 'outside')->count());
        }
    }

    #[Test]
    public function outside_changes_are_kept_even_when_the_save_conflicts(): void
    {
        $db = $this->app()->getContainer()->make(ConnectionInterface::class);
        $this->call('POST', '/check'); // takes the snapshot

        // Changed outside, and it's the very permission the admin's stale page is about to save.
        $db->table('group_permission')->insert(['permission' => 'discussion.lock', 'group_id' => 10]);
        $r = $this->save([['discussion.lock', [4], [4, 3]]]);
        $this->assertEquals(409, $r->getStatusCode());

        // Read the table directly: opening History would run the check again and hide a lost entry.
        $outside = $db->table('permission_desk_changesets')->where('kind', 'outside')->pluck('id')->all();
        $this->assertCount(1, $outside, 'the outside change was logged and survived the rollback');
        $change = $db->table('permission_desk_changes')->where('changeset_id', $outside[0])->first();
        $this->assertEquals('discussion.lock', $change->permission);
        $this->assertEquals([10], json_decode($change->after, true));
        $this->assertEquals(0, $db->table('permission_desk_changesets')->where('kind', 'save')->count(), 'nothing of the save');
    }

    #[Test]
    public function refused_saves_say_why(): void
    {
        // flarum/testing doesn't load extension locales, so the key stands in for the text here.
        $r = $this->call('POST', '/changesets', 1, ['changes' => []]);
        $this->assertEquals(422, $r->getStatusCode());
        $this->assertMatchesRegularExpression('/Nothing to save\.|api\.nothing_to_save/', (string) $r->getBody());

        $r = $this->save([['discussion.lock', [], [999]]]);
        $this->assertEquals(422, $r->getStatusCode());
        $this->assertMatchesRegularExpression('/There is no group 999\.|api\.no_such_group/', (string) $r->getBody());
    }

    #[Test]
    public function presets_can_be_saved_listed_and_deleted(): void
    {
        $preset = fn (array $attributes) => $this->send($this->request('POST', '/api/permission-desk-presets', [
            'authenticatedAs' => 1,
            'json' => ['data' => ['type' => 'permission-desk-presets', 'attributes' => $attributes]],
        ]));
        $list = fn () => $this->json($this->send($this->request('GET', '/api/permission-desk-presets', ['authenticatedAs' => 1])))['data'];

        $r = $preset(['name' => ' Helpers ', 'permissions' => ['discussion.lock', 'discussion.editPosts', 'bad key!']]);
        $this->assertEquals(201, $r->getStatusCode(), (string) $r->getBody());
        $created = $this->json($r)['data'];
        $this->assertEquals('Helpers', $created['attributes']['name']);
        $this->assertEquals(['discussion.lock', 'discussion.editPosts'], $created['attributes']['permissions']);

        $this->assertEquals('Helpers', $list()[0]['attributes']['name']);
        $this->assertEquals(422, $preset(['name' => ' ', 'permissions' => []])->getStatusCode());
        $this->assertEquals(422, $preset(['name' => str_repeat('x', 101), 'permissions' => []])->getStatusCode());

        $this->assertEquals(204, $this->send($this->request('DELETE', '/api/permission-desk-presets/'.$created['id'], ['authenticatedAs' => 1]))->getStatusCode());
        $this->assertEquals([], $list());
    }

    #[Test]
    public function history_and_member_pages_are_a_fixed_number_of_queries(): void
    {
        $count = function (string $path): int {
            $db = $this->app()->getContainer()->make(ConnectionInterface::class);
            $db->flushQueryLog();
            $db->enableQueryLog();
            $this->call('GET', $path);
            $n = count($db->getQueryLog());
            $db->disableQueryLog();

            return $n;
        };

        $this->call('POST', '/check');
        $this->save([['discussion.lock', [], [4]]]);
        $one = $count('/history');

        $lock = [4];
        $tag = [];
        foreach (range(1, 12) as $i) {
            $nextLock = $lock === [4] ? [4, 10] : [4];
            $nextTag = $tag === [] ? [10] : [];
            $this->assertEquals(200, $this->save([['discussion.lock', $lock, $nextLock], ['discussion.tag', $tag, $nextTag]])->getStatusCode());
            [$lock, $tag] = [$nextLock, $nextTag];
        }
        $this->assertEquals($one, $count('/history'), 'history: same queries for 1 or 13 entries');

        $this->assertLessThanOrEqual($count('/members/2') + 0, $count('/members/3'));
    }

    #[Test]
    public function one_save_across_hundreds_of_tag_permissions_is_one_changeset_with_bounded_queries(): void
    {
        $db = $this->app()->getContainer()->make(ConnectionInterface::class);
        $rows = function (int $tags, array $before, array $after): array {
            $out = [];
            foreach (range(100, 99 + $tags) as $tag) {
                foreach (['viewForum', 'startDiscussion', 'discussion.reply'] as $p) {
                    $out[] = ["tag$tag.$p", $before, $after];
                }
            }

            return $out;
        };
        $queries = function (array $changes) use ($db): int {
            $db->flushQueryLog();
            $db->enableQueryLog();
            $r = $this->save($changes);
            $this->assertEquals(200, $r->getStatusCode(), substr((string) $r->getBody(), 0, 300));
            $n = count($db->getQueryLog());
            $db->disableQueryLog();

            return $n;
        };

        $this->call('POST', '/check');
        $small = $queries($rows(2, [], [3]));
        $big = $queries(array_slice($rows(152, [], [3]), 6));

        // 450 permissions (150 tags x 3) in one save: every row written, one History entry.
        $this->assertEquals([3], $this->groupsWith('tag251.discussion.reply'));
        $this->assertEquals(456, $db->table('group_permission')->where('permission', 'like', 'tag1__.%')->orWhere('permission', 'like', 'tag2__.%')->count());
        $entry = $this->json($this->call('GET', '/history'))['changesets'][0];
        $this->assertCount(450, $entry['changes']);

        // Cost grows only with the rows written (core's handler per permission), never per tag looked up.
        $perChange = ($big - $small) / (450 - 6);
        $this->assertLessThanOrEqual(4, $perChange, "queries per changed permission: $perChange ($small for 6, $big for 450)");
    }
}
