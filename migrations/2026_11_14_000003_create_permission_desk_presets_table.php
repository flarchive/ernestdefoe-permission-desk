<?php

/*
 * Presets an admin saved ("Save Mods as a preset"). The built-in ones live in the admin JS.
 */

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Schema\Builder;

return [
    'up' => function (Builder $schema) {
        if ($schema->hasTable('permission_desk_presets')) {
            return;
        }

        $schema->create('permission_desk_presets', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name', 100);
            // JSON array of global permission keys.
            $table->text('permissions');
            $table->unsignedInteger('user_id')->nullable();
            $table->dateTime('created_at');

            $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
        });
    },

    'down' => function (Builder $schema) {
        $schema->dropIfExists('permission_desk_presets');
    },
];
