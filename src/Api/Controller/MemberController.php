<?php

namespace ErnestDefoe\PermissionDesk\Api\Controller;

use ErnestDefoe\PermissionDesk\Effective;
use Flarum\Http\RequestUtil;
use Flarum\User\User;
use Illuminate\Support\Arr;
use Laminas\Diactoros\Response\JsonResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * GET /permission-desk/members/{id}: what one member can do right now and through which group
 * (src/Effective.php, core's own permissionGroupIds()).
 */
class MemberController implements RequestHandlerInterface
{
    public function __construct(protected Effective $effective)
    {
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        RequestUtil::getActor($request)->assertAdmin();
        $user = User::query()->with('groups')->findOrFail((int) Arr::get($request->getAttribute('routeParameters', []), 'id'));

        return new JsonResponse($this->effective->forUser($user));
    }
}
