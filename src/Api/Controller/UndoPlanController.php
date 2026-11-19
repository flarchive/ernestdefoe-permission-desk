<?php

namespace ErnestDefoe\PermissionDesk\Api\Controller;

use ErnestDefoe\PermissionDesk\Planner;
use ErnestDefoe\PermissionDesk\Watcher;
use Flarum\Http\RequestUtil;
use Illuminate\Support\Arr;
use Laminas\Diactoros\Response\JsonResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * POST /permission-desk/changesets/{id}/undo: what Undo would change, for the review. A POST
 * because it first logs any outside changes, so the plan accounts for them too.
 */
class UndoPlanController implements RequestHandlerInterface
{
    public function __construct(
        protected Planner $planner,
        protected Watcher $watcher,
    ) {
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        RequestUtil::getActor($request)->assertAdmin();
        $this->watcher->check();

        return new JsonResponse($this->planner->undo((int) Arr::get($request->getAttribute('routeParameters', []), 'id')));
    }
}
