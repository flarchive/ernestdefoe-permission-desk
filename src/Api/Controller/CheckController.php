<?php

namespace ErnestDefoe\PermissionDesk\Api\Controller;

use ErnestDefoe\PermissionDesk\Watcher;
use Flarum\Http\RequestUtil;
use Laminas\Diactoros\Response\JsonResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * POST /permission-desk/check: log permission changes made outside Permission Desk to History
 * (the same check the nightly command runs). The History tab calls it when it opens.
 */
class CheckController implements RequestHandlerInterface
{
    public function __construct(protected Watcher $watcher)
    {
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        RequestUtil::getActor($request)->assertAdmin();

        return new JsonResponse(['changeset' => $this->watcher->check()]);
    }
}
