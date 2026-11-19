<?php

namespace ErnestDefoe\PermissionDesk;

use Flarum\Foundation\ValidationException;
use Flarum\Locale\TranslatorInterface;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Collection;

/**
 * Works out what Undo and Restore would change, for the admin to review before saving.
 */
class Planner
{
    public function __construct(
        protected ConnectionInterface $db,
        protected PermissionMap $map,
        protected TranslatorInterface $translator,
    ) {
    }

    /**
     * Reverse one changeset. A permission that changed again since (so its current groups are not
     * what that changeset left) is skipped and named, never overwritten.
     *
     * @return array{changes: array<int, array{permission: string, before: int[], after: int[]}>, skipped: string[]}
     */
    public function undo(int $id): array
    {
        $set = $this->db->table('permission_desk_changesets')->where('id', $id)->first();

        if (! $set) {
            throw $this->invalid('no_such_entry');
        }
        if ($set->undone_by) {
            throw $this->invalid('already_undone');
        }

        $current = $this->map->current();
        $changes = [];
        $skipped = [];

        foreach ($this->changes([$id]) as $c) {
            $now = $current[$c->permission] ?? [];
            if ($now !== $this->ids($c->after)) {
                $skipped[] = $c->permission;
                continue;
            }
            $changes[] = ['permission' => $c->permission, 'before' => $now, 'after' => $this->ids($c->before)];
        }

        return ['changes' => $changes, 'skipped' => $skipped];
    }

    /**
     * Every permission back to how it was right after the given changeset: for each permission a
     * later changeset touched, the "before" of the earliest of those later changes.
     *
     * @return array{changes: array<int, array{permission: string, before: int[], after: int[]}>, skipped: string[]}
     */
    public function restore(int $id): array
    {

        if (! $this->db->table('permission_desk_changesets')->where('id', $id)->exists()) {
            throw $this->invalid('no_such_entry');
        }

        $later = $this->db->table('permission_desk_changesets')->where('id', '>', $id)->pluck('id')->all();
        $target = [];

        // Oldest first, so the first "before" seen for a permission is the one that wins.
        foreach ($this->changes($later)->sortBy('changeset_id') as $c) {
            $target[$c->permission] ??= $this->ids($c->before);
        }

        $current = $this->map->current();
        $changes = [];

        foreach ($target as $key => $ids) {
            $now = $current[$key] ?? [];
            if ($now !== $ids) {
                $changes[] = ['permission' => $key, 'before' => $now, 'after' => $ids];
            }
        }

        return ['changes' => $changes, 'skipped' => []];
    }

    protected function invalid(string $key): ValidationException
    {
        return new ValidationException(['id' => $this->translator->trans('ernestdefoe-permission-desk.api.'.$key)]);
    }

    /** @param int[] $ids */
    protected function changes(array $ids): Collection
    {
        return $ids ? $this->db->table('permission_desk_changes')->whereIn('changeset_id', $ids)->orderBy('id')->get() : collect();
    }

    /** @return int[] */
    protected function ids(string $json): array
    {
        return PermissionMap::normalize((array) json_decode($json, true));
    }
}
