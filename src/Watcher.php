<?php

namespace ErnestDefoe\PermissionDesk;

use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Contracts\Cache\Repository as Cache;

/**
 * Catches permission changes made outside Permission Desk (core's classic grid, an extension's
 * migration, a console command, a direct database edit) by comparing the live table with the
 * snapshot taken after our last save, and logs the difference to History as one "outside" entry.
 * Runs nightly, before every save, and when History is opened. The first run only takes a snapshot.
 *
 * Two admins opening History at the same moment would both see the same difference and log it
 * twice, so the check runs under a short cache lock (every Flarum cache store can lock).
 */
class Watcher
{
    public function __construct(
        protected PermissionMap $map,
        protected History $history,
        protected Cache $cache,
    ) {
    }

    /** @return int|null the new changeset's id, if anything had changed */
    public function check(): ?int
    {
        $store = $this->cache->getStore();
        if (! $store instanceof LockProvider) {
            return $this->compare();
        }

        // Waits up to 10 s for another check to finish; the second one then finds nothing new.
        return $store->lock('permission-desk.check', 30)->block(10, fn () => $this->compare());
    }

    protected function compare(): ?int
    {
        $current = $this->map->current();
        $snapshot = $this->history->snapshot();

        if ($snapshot === null) {
            $this->history->saveSnapshot($current);

            return null;
        }

        $snapshot = array_map(fn ($ids) => PermissionMap::normalize((array) $ids), $snapshot);
        $diff = PermissionMap::diff($snapshot, $current);

        if (! $diff) {
            return null;
        }

        $id = $this->history->record(null, 'outside', $diff);
        $this->history->saveSnapshot($current);

        return $id;
    }
}
