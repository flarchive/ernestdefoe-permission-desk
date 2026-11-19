<?php

namespace ErnestDefoe\PermissionDesk;

use Carbon\Carbon;
use Flarum\User\User;
use Illuminate\Database\ConnectionInterface;

/**
 * Reads and writes History: changesets and the permissions each one touched, plus the snapshot
 * the outside-change check compares against.
 */
class History
{
    public const PAGE = 30;

    public function __construct(
        protected ConnectionInterface $db,
        protected PermissionMap $map,
    ) {
    }

    /**
     * @param array<string, array{before: int[], after: int[]}> $changes
     */
    public function record(?User $actor, string $kind, array $changes, ?string $note = null, ?int $undoOf = null): int
    {
        $id = (int) $this->db->table('permission_desk_changesets')->insertGetId([
            'actor_id' => $actor?->id,
            'kind' => $kind,
            'note' => $note !== null && trim($note) !== '' ? mb_substr(trim($note), 0, 200) : null,
            'undo_of' => $undoOf,
            'created_at' => Carbon::now(),
        ]);

        $rows = [];
        foreach ($changes as $key => $change) {
            $rows[] = [
                'changeset_id' => $id,
                'permission' => $key,
                'before' => json_encode(array_values($change['before'])),
                'after' => json_encode(array_values($change['after'])),
            ];
        }

        foreach (array_chunk($rows, 200) as $chunk) {
            $this->db->table('permission_desk_changes')->insert($chunk);
        }

        if ($undoOf) {
            $this->db->table('permission_desk_changesets')->where('id', $undoOf)->whereNull('undone_by')->update(['undone_by' => $id]);
        }

        return $id;
    }

    /** @return array<string, int[]>|null */
    public function snapshot(): ?array
    {
        $row = $this->db->table('permission_desk_snapshots')->orderBy('id')->first();

        return $row ? (array) json_decode((string) $row->map, true) : null;
    }

    /** @param array<string, int[]> $map */
    public function saveSnapshot(array $map): void
    {
        $json = json_encode((object) $map);
        $row = $this->db->table('permission_desk_snapshots')->orderBy('id')->first();

        if ($row) {
            $this->db->table('permission_desk_snapshots')->where('id', $row->id)->update(['map' => $json, 'taken_at' => Carbon::now()]);
        } else {
            $this->db->table('permission_desk_snapshots')->insert(['map' => $json, 'taken_at' => Carbon::now()]);
        }
    }

    /**
     * A page of changesets, newest first: three queries whatever the page size.
     *
     * @return array{changesets: array<int, array<string, mixed>>, hasMore: bool}
     */
    public function page(int $offset): array
    {
        $sets = $this->db->table('permission_desk_changesets')
            ->orderByDesc('id')
            ->offset(max(0, $offset))
            ->limit(self::PAGE + 1)
            ->get();

        $hasMore = $sets->count() > self::PAGE;
        $sets = $sets->take(self::PAGE);
        $ids = $sets->pluck('id')->all();

        $changes = $ids ? $this->db->table('permission_desk_changes')->whereIn('changeset_id', $ids)->orderBy('id')->get()->groupBy('changeset_id') : collect();

        $actorIds = $sets->pluck('actor_id')->filter()->unique()->all();
        $actors = $actorIds ? User::query()->whereIn('id', $actorIds)->get()->keyBy('id') : collect();

        return [
            'changesets' => $sets->map(fn ($s) => [
                'id' => (int) $s->id,
                'kind' => $s->kind,
                'note' => $s->note,
                'undoOf' => $s->undo_of ? (int) $s->undo_of : null,
                'undoneBy' => $s->undone_by ? (int) $s->undone_by : null,
                'createdAt' => Carbon::parse($s->created_at)->toIso8601String(),
                'actor' => ($a = $actors->get($s->actor_id)) ? ['id' => $a->id, 'displayName' => $a->display_name] : null,
                'changes' => ($changes->get($s->id) ?? collect())->map(fn ($c) => [
                    'permission' => $c->permission,
                    'before' => json_decode($c->before, true),
                    'after' => json_decode($c->after, true),
                ])->values()->all(),
            ])->values()->all(),
            'hasMore' => $hasMore,
        ];
    }
}
