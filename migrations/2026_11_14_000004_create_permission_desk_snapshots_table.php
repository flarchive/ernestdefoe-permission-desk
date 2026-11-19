<?php

/*
 * The whole group_permission table as it was after the last change we know about (one row).
 * The outside-change check compares the live table with it and logs any difference to History.
 */

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Schema\Builder;

return [
    'up' => function (Builder $schema) {
        if ($schema->hasTable('permission_desk_snapshots')) {
            return;
        }

        $schema->create('permission_desk_snapshots', function (Blueprint $table) {
            $table->increments('id');
            $table->mediumText('map');
            $table->dateTime('taken_at');
        });
    },

    'down' => function (Builder $schema) {
        $schema->dropIfExists('permission_desk_snapshots');
    },
];
