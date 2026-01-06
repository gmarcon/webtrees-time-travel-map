<?php

namespace Webtrees\Modules\TimeTravelMap\Controllers;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Webtrees\Modules\TimeTravelMap\Services\TreeWalker;

class MapController
{
    /**
     * Render the map page.
     * 
     * @param ServerRequestInterface $request
     * @param ResponseInterface $response
     * @return ResponseInterface
     */
    public function view(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $params = $request->getQueryParams();

        // Basic template rendering
        ob_start();
        $title = 'Time Travel Map';
        require __DIR__ . '/../../views/map-page.phtml';
        $content = ob_get_clean();

        $response->getBody()->write($content);
        return $response;
    }

    /**
     * Return JSON data for the map.
     * 
     * @param ServerRequestInterface $request
     * @param ResponseInterface $response
     * @return ResponseInterface
     */
    public function data(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $params = $request->getQueryParams();
        $xref = $params['root_person_id'] ?? '';
        $direction = $params['direction'] ?? 'UP';
        $generations = (int) ($params['generations'] ?? 5);

        /** @var \Fisharebest\Webtrees\Tree|null $tree */
        $tree = $request->getAttribute('tree');

        if (!$tree) {
            $response->getBody()->write(json_encode(['error' => 'Tree not found']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(400);
        }

        $individual = $tree->getIndividual($xref);

        if (!$individual) {
            $response->getBody()->write(json_encode(['error' => 'Individual not found']));
            return $response->withHeader('Content-Type', 'application/json')->withStatus(404);
        }

        $walker = new TreeWalker();
        $data = $walker->getEvents($individual, $direction, $generations);

        $response->getBody()->write(json_encode($data));
        return $response->withHeader('Content-Type', 'application/json');
    }
}
