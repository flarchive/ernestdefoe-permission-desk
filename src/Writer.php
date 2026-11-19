<?php

namespace ErnestDefoe\PermissionDesk;

use ErnestDefoe\PermissionDesk\Audit\AuditRecorder;
use Flarum\Api\Controller\SetPermissionController;
use Flarum\Foundation\ValidationException;
use Flarum\Group\Group;
use Flarum\Http\RequestUtil;
use Flarum\Locale\TranslatorInterface;
use Flarum\User\User;
use Illuminate\Database\ConnectionInterface;
use Laminas\Diactoros\ServerRequest;

/**
 * Saves a reviewed set of changes. Every write is core's own SetPermissionController (the same
 * handler behind POST /api/permission: admin check, full replace of one permission's groups,
 * permission cache flush), called once per permission inside one transaction. Nothing else ever
 * touches group_permission.
 *
 * flarum/audit logs core's endpoint with middleware on the HTTP route, which a direct call skips,
 * so each change also goes to the AuditRecorder (a no-op unless flarum/audit is enabled).
 */
class Writer
{
    public const KEY = '/^[A-Za-z0-9_.\-]{1,100}$/';

    public function __construct(
        protected ConnectionInterface $db,
        protected PermissionMap $map,
        protected History $history,
        protected Watcher $watcher,
        protected SetPermissionController $controller,
        protected AuditRecorder $audit,
        protected TranslatorInterface $translator,
    ) {
    }

    /**
     * @param array<int, array{permission?: mixed, before?: mixed, after?: mixed}> $input
     * @return array{changeset: int, map: array<string, int[]>}
     *
     * @throws Conflict when a permission changed since the admin loaded the page
     */
    public function save(User $actor, array $input, ?string $note = null, string $kind = 'save', ?int $undoOf = null): array
    {
        $actor->assertAdmin();
        $changes = $this->validate($input);

        // Anything changed elsewhere since the last snapshot goes into History first, committed on
        // its own: a conflict below rolls back the save, never the record of those outside changes.
        $this->watcher->check();

        return $this->db->transaction(function () use ($actor, $changes, $note, $kind, $undoOf) {
            $this->assertUnchanged($changes);
            $this->assertUndoable($undoOf);

            foreach ($changes as $key => $change) {
                $this->controller->handle(RequestUtil::withActor(
                    (new ServerRequest([], [], '/permission', 'POST'))->withParsedBody(['permission' => $key, 'groupIds' => $change['after']]),
                    $actor
                ));
                $this->audit->permissionChanged($actor, $key, $change['before'], $change['after']);
            }

            $id = $this->history->record($actor, $kind, $changes, $note, $undoOf);
            $map = $this->map->current();
            $this->history->saveSnapshot($map);

            return ['changeset' => $id, 'map' => $map];
        });
    }

    /**
     * Every change must start from what the admin saw; otherwise nothing is saved.
     *
     * @param array<string, array{before: int[], after: int[]}> $changes
     *
     * @throws Conflict
     */
    protected function assertUnchanged(array $changes): void
    {
        $current = $this->map->current();
        $conflicts = [];
        foreach ($changes as $key => $change) {
            if (($current[$key] ?? []) !== $change['before']) {
                $conflicts[$key] = $current[$key] ?? [];
            }
        }
        if ($conflicts) {
            throw new Conflict($conflicts);
        }
    }

    protected function assertUndoable(?int $undoOf): void
    {
        if ($undoOf === null) {
            return;
        }
        $original = $this->db->table('permission_desk_changesets')->where('id', $undoOf)->first();
        if (! $original || $original->undone_by) {
            $this->fail('undoOf', 'not_undoable');
        }
    }

    /** @return never */
    protected function fail(string $field, string $key, array $params = []): void
    {
        throw new ValidationException([$field => $this->translator->trans('ernestdefoe-permission-desk.api.'.$key, $params)]);
    }

    /**
     * @param array<int, mixed> $input
     * @return array<string, array{before: int[], after: int[]}>
     */
    protected function validate(array $input): array
    {
        if (! $input) {
            $this->fail('changes', 'nothing_to_save');
        }

        $groups = Group::query()->pluck('id')->map(fn ($id) => (int) $id)->all();
        $out = [];

        foreach ($input as $row) {
            $key = is_array($row) ? ($row['permission'] ?? null) : null;
            if (! is_string($key) || ! preg_match(self::KEY, $key)) {
                $this->fail('changes', 'not_a_permission');
            }

            $before = PermissionMap::normalize((array) ($row['before'] ?? []));
            $after = PermissionMap::normalize((array) ($row['after'] ?? []));

            foreach ($after as $id) {
                if (! in_array($id, $groups, true)) {
                    $this->fail('changes', 'no_such_group', ['id' => $id]);
                }
            }

            if ($before !== $after) {
                $out[$key] = ['before' => $before, 'after' => $after];
            }
        }

        if (! $out) {
            $this->fail('changes', 'nothing_to_save');
        }

        ksort($out);

        return $out;
    }
}
