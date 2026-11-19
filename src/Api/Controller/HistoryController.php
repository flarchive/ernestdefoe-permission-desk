<?php

namespace ErnestDefoe\PermissionDesk\Api\Controller;

use ErnestDefoe\PermissionDesk\History;
use Flarum\Http\RequestUtil;
use Illuminate\Support\Arr;
use Laminas\Diactoros\Response\JsonResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * GET /permission-desk/history?offset=: one page of History, newest first, each entry with every
 * permission it changed (src/History.php: three queries whatever the page size). Plain JSON
 * rather than an API resource: an entry and its changes are one record to the admin, never
 * fetched or edited on their own.
 */
class HistoryController implements RequestHandlerInterface
{
    public function __construct(protected History $history)
    {
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        RequestUtil::getActor($request)->assertAdmin();

        return new JsonResponse($this->history->page((int) Arr::get($request->getQueryParams(), 'offset', 0)));
    }
}
