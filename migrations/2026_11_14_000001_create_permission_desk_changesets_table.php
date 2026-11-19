<?php

/*
 * One row per save (or per batch of changes found made outside Permission Desk).
 * Index names are left to Laravel (prefix_indexes), never hand-named.
 */

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Schema\Builder;

return [
    'up' => function (Builder $schema) {
        if ($schema->hasTable('permission_desk_changesets')) {
            return;
        }

        $schema->create('permission_desk_changesets', function (Blueprint $table) {
            $table->increments('id');
            // null = found by the outside-change check (core's grid, a migration, a command).
            $table->unsignedInteger('actor_id')->nullable();
            // save | undo | restore | outside
            $table->string('kind', 16)->default('save');
            $table->string('note', 200)->nullable();
            $table->unsignedInteger('undo_of')->nullable();
            $table->unsignedInteger('undone_by')->nullable();
            $table->dateTime('created_at');

            $table->index('created_at');
            $table->foreign('actor_id')->references('id')->on('users')->nullOnDelete();
        });
    },

    'down' => function (Builder $schema) {
        $schema->dropIfExists('permission_desk_changesets');
    },
];
