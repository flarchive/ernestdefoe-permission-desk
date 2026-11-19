<?php

namespace ErnestDefoe\PermissionDesk\Api\Controller;

use ErnestDefoe\PermissionDesk\Conflict;
use ErnestDefoe\PermissionDesk\Writer;
use Flarum\Http\RequestUtil;
use Laminas\Diactoros\Response\JsonResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * POST /permission-desk/changesets {changes, note, kind, undoOf}: save reviewed changes as one
 * History entry. 409 with the current groups when any permission changed since the page loaded.
 */
class SaveController implements RequestHandlerInterface
{
    public function __construct(protected Writer $writer)
    {
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        $actor = RequestUtil::getActor($request);
        $actor->assertAdmin();

        $body = (array) $request->getParsedBody();
        $kind = in_array($body['kind'] ?? null, ['undo', 'restore'], true) ? $body['kind'] : 'save';
        $undoOf = $kind === 'undo' && isset($body['undoOf']) ? (int) $body['undoOf'] : null;
        $note = isset($body['note']) && is_string($body['note']) ? $body['note'] : null;

        try {
            $result = $this->writer->save($actor, (array) ($body['changes'] ?? []), $note, $kind === 'undo' && ! $undoOf ? 'save' : $kind, $undoOf);
        } catch (Conflict $e) {
            return new JsonResponse(['conflicts' => (object) $e->current], 409);
        }

        return new JsonResponse(['changeset' => $result['changeset'], 'map' => (object) $result['map']]);
    }
}
