<?php

namespace ErnestDefoe\PermissionDesk;

use Carbon\Carbon;
use Flarum\Database\AbstractModel;

/**
 * A saved preset: a name and the global permission keys a group gets when it's applied.
 *
 * @property int $id
 * @property string $name
 * @property string $permissions JSON array of permission keys
 * @property int|null $user_id
 * @property Carbon $created_at
 */
class Preset extends AbstractModel
{
    protected $table = 'permission_desk_presets';

    public $timestamps = false;

    protected $casts = [
        'user_id' => 'integer',
        'created_at' => 'datetime',
    ];

    /** @return string[] */
    public function keys(): array
    {
        return array_values((array) json_decode($this->permissions, true));
    }
}
