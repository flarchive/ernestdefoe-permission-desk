<?php

namespace ErnestDefoe\PermissionDesk\Api;

use Carbon\Carbon;
use ErnestDefoe\PermissionDesk\Preset;
use ErnestDefoe\PermissionDesk\Writer;
use Flarum\Api\Endpoint;
use Flarum\Api\Resource\AbstractDatabaseResource;
use Flarum\Api\Schema;
use Flarum\Api\Sort\SortColumn;
use Tobyz\JsonApiServer\Context;

/**
 * Saved presets, as JSON:API type `permission-desk-presets` (/api/permission-desk-presets).
 * Admins only: listed, created and deleted from the Apply preset dialog.
 *
 * @extends AbstractDatabaseResource<Preset>
 */
class PresetResource extends AbstractDatabaseResource
{
    public function type(): string
    {
        return 'permission-desk-presets';
    }

    public function model(): string
    {
        return Preset::class;
    }

    public function endpoints(): array
    {
        return [
            Endpoint\Index::make()->admin()->defaultSort('name'),
            Endpoint\Create::make()->admin(),
            Endpoint\Delete::make()->admin(),
        ];
    }

    public function creating(object $model, Context $context): ?object
    {
        /** @var Preset $model */
        $model->user_id = $context->getActor()->id;
        $model->created_at = Carbon::now();

        return $model;
    }

    public function fields(): array
    {
        return [
            Schema\Str::make('name')
                ->writableOnCreate()
                ->requiredOnCreate()
                ->maxLength(100)
                ->rule('regex:/\S/')
                ->set(fn (Preset $p, string $value) => $p->name = trim($value)),
            // Global permission keys only; anything that isn't a permission name is dropped.
            Schema\Arr::make('permissions')
                ->writableOnCreate()
                ->requiredOnCreate()
                ->get(fn (Preset $p) => $p->keys())
                ->set(fn (Preset $p, array $value) => $p->permissions = (string) json_encode(array_values(array_unique(array_filter(
                    $value,
                    fn ($k) => is_string($k) && preg_match(Writer::KEY, $k)
                ))))),
        ];
    }

    public function sorts(): array
    {
        return [SortColumn::make('name')];
    }
}
