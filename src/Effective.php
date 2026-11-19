<?php

namespace ErnestDefoe\PermissionDesk;

use Carbon\Carbon;
use Flarum\Extension\ExtensionManager;
use Flarum\Group\Group;
use Flarum\User\User;

/**
 * What one member's groups let them do, and which group grants each permission. The groups that
 * count come from core's own User::permissionGroupIds(), so its rules (unconfirmed email = guest)
 * and every extension's group processors (flarum/suspend: suspended = guest) apply exactly as they
 * do on the forum. Three queries: the member, their groups, group_permission.
 */
class Effective
{
    public function __construct(
        protected PermissionMap $map,
        protected ExtensionManager $extensions,
    ) {
    }

    /** @return array<string, mixed> */
    public function forUser(User $user): array
    {
        $own = $user->groups->pluck('id')->map(fn ($id) => (int) $id)->all();
        $effective = array_values(array_unique(array_map('intval', $user->permissionGroupIds())));
        $isAdmin = $user->isAdmin();

        $granted = [];
        foreach ($this->map->current() as $key => $ids) {
            $via = $this->via($ids, $effective);
            if ($via !== null) {
                $granted[$key] = $via;
            }
        }

        $suspendedUntil = null;
        $raw = $this->extensions->isEnabled('flarum-suspend') ? $user->getAttribute('suspended_until') : null;
        if ($raw) {
            $until = Carbon::parse($raw);
            $suspendedUntil = $until->isFuture() ? $until->toIso8601String() : null;
        }

        return [
            'user' => [
                'id' => (int) $user->id,
                'username' => $user->username,
                'displayName' => $user->display_name,
                'avatarUrl' => $user->avatar_url,
                'groups' => $own,
                'isEmailConfirmed' => (bool) $user->is_email_confirmed,
                'suspendedUntil' => $suspendedUntil,
            ],
            'isAdmin' => $isAdmin,
            // The groups whose permissions count right now (core's own answer).
            'effectiveGroups' => $effective,
            // permission => the group it comes through (Guests first, then Members, then the lowest id)
            'granted' => (object) $granted,
        ];
    }

    /**
     * @param int[] $ids groups that have the permission
     * @param int[] $effective the member's groups that count
     */
    protected function via(array $ids, array $effective): ?int
    {
        foreach ([Group::GUEST_ID, Group::MEMBER_ID] as $special) {
            if (in_array($special, $ids, true) && in_array($special, $effective, true)) {
                return $special;
            }
        }

        $hits = array_values(array_intersect($ids, $effective));
        sort($hits);

        return $hits[0] ?? null;
    }
}
