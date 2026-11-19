<?php

namespace ErnestDefoe\PermissionDesk\Console;

use ErnestDefoe\PermissionDesk\Watcher;
use Flarum\Console\AbstractCommand;

/**
 * Nightly: log permission changes made outside Permission Desk to History.
 */
class CheckCommand extends AbstractCommand
{
    public function __construct(protected Watcher $watcher)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->setName('permission-desk:check')
            ->setDescription('Log permission changes made outside Permission Desk to its History');
    }

    protected function fire(): int
    {
        $id = $this->watcher->check();
        $this->info($id ? "Logged outside changes as History entry $id." : 'No outside changes.');

        return 0;
    }
}
