<?php

namespace Fisharebest\Webtrees\Module\Custom\TimeTravelMap\Http;

use Fig\Http\Message\RequestMethodInterface;
use Fisharebest\Webtrees\Auth;
use Fisharebest\Webtrees\Http\ViewResponseTrait;
use Fisharebest\Webtrees\I18N;
use Fisharebest\Webtrees\Module\Custom\TimeTravelMap\Module;
use Fisharebest\Webtrees\Registry;
use Fisharebest\Webtrees\Validator;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

use function redirect;
use function route;
use function view;

class MapPage implements RequestHandlerInterface
{
    use ViewResponseTrait;

    private \Fisharebest\Webtrees\Services\LeafletJsService $leaflet_js_service;

    public function __construct(\Fisharebest\Webtrees\Services\LeafletJsService $leaflet_js_service)
    {
        $this->leaflet_js_service = $leaflet_js_service;
    }

    /**
     * @param ServerRequestInterface $request
     * @return ResponseInterface
     */
    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        $tree = Validator::attributes($request)->tree();
        $user = Validator::attributes($request)->user();
        $xref = Validator::queryParams($request)->isXref()->string('xref', '');
        $direction = Validator::queryParams($request)->string('direction', 'UP');
        $generations = Validator::queryParams($request)->integer('generations', 5);

        // Convert POST requests into GET requests for pretty URLs.
        if ($request->getMethod() === RequestMethodInterface::METHOD_POST) {
            return redirect(route(Module::class . '::view', [
                'tree' => $tree->name(),
                'xref' => Validator::parsedBody($request)->isXref()->string('xref', ''),
                'direction' => Validator::parsedBody($request)->string('direction', 'UP'),
                'generations' => Validator::parsedBody($request)->integer('generations', 5),
            ]));
        }

        // Get the individual
        $individual = null;
        if ($xref !== '') {
            $individual = Registry::individualFactory()->make($xref, $tree);
            $individual = Auth::checkIndividualAccess($individual, false, true);
        }

        $title = I18N::translate('Time Travel Map');
        if ($individual !== null) {
            $title .= ' - ' . $individual->fullName();
        }

        // Get Leaflet Config (icons, tiles) from Service
        $leafletConfig = $this->leaflet_js_service->config();

        // Render the chart
        $map = view('modules/time-travel-map::chart', [
            'data_url' => route(Module::class . '::data', [
                'tree' => $tree->name(),
            ]),
            'tree_name' => $tree->name(),
            'xref' => $xref,
            'direction' => $direction,
            'generations' => $generations,
            'leaflet_config' => $leafletConfig,
        ]);

        return $this->viewResponse('modules/time-travel-map::page', [
            'title' => $title,
            'tree' => $tree,
            'individual' => $individual,
            'direction' => $direction,
            'generations' => $generations,
            'map' => $map,
        ]);
    }
}
