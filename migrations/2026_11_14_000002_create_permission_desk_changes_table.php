<?php

/*
 * Each permission a changeset touched: its full group list before and after (JSON arrays of ids),
 * so undo and restore can put it back exactly.
 */

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Schema\Builder;

return [
    'up' => function (Builder $schema) {
        if ($schema->hasTable('permission_desk_changes')) {
            return;
        }

        $schema->create('permission_desk_changes', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('changeset_id');
            // Same length as group_permission.permission.
            $table->string('permission', 100);
            $table->text('before');
            $table->text('after');

            $table->index('changeset_id');
            $table->foreign('changeset_id')->references('id')->on('permission_desk_changesets')->cascadeOnDelete();
        });
    },

    'down' => function (Builder $schema) {
        $schema->dropIfExists('permission_desk_changes');
    },
];
