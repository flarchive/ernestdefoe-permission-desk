<?php

namespace ErnestDefoe\PermissionDesk;

use Flarum\Group\Group;
use Flarum\Group\Permission;

/**
 * The group_permission table as `permission => sorted group ids`, read in one query.
 */
class PermissionMap
{
    /** @return array<string, int[]> */
    public function current(): array
    {
        $map = [];

        foreach (Permission::query()->toBase()->get(['permission', 'group_id']) as $row) {
            $map[(string) $row->permission][] = (int) $row->group_id;
        }

        return array_map([self::class, 'normalize'], $map);
    }

    /**
     * Sorted, unique ints, never the Admin group (admins pass every check, so core never stores them).
     *
     * @param array<mixed> $ids
     * @return int[]
     */
    public static function normalize(array $ids): array
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        $ids = array_values(array_filter($ids, fn (int $id) => $id !== Group::ADMINISTRATOR_ID));
        sort($ids);

        return $ids;
    }

    /**
     * Every permission whose group list differs between two maps.
     *
     * @param array<string, int[]> $before
     * @param array<string, int[]> $after
     * @return array<string, array{before: int[], after: int[]}>
     */
    public static function diff(array $before, array $after): array
    {
        $out = [];

        foreach (array_unique(array_merge(array_keys($before), array_keys($after))) as $key) {
            $b = $before[$key] ?? [];
            $a = $after[$key] ?? [];

            if ($a !== $b) {
                $out[$key] = ['before' => $b, 'after' => $a];
            }
        }

        ksort($out);

        return $out;
    }
}
