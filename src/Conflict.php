<?php

namespace ErnestDefoe\PermissionDesk;

/**
 * Some permissions changed after the admin loaded the page; nothing was saved.
 */
class Conflict extends \RuntimeException
{
    /** @param array<string, int[]> $current the conflicting permissions as they are now */
    public function __construct(public array $current)
    {
        parent::__construct('Changed since you loaded the page: '.implode(', ', array_keys($current)));
    }
}
