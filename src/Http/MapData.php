<?php

declare(strict_types=1);

namespace Fisharebest\Webtrees\Module\Custom\TimeTravelMap\Http;

use Fisharebest\Webtrees\Module\Custom\TimeTravelMap\Module;
use Fisharebest\Webtrees\Module\Custom\TimeTravelMap\Services\TreeWalker;
use Fisharebest\Webtrees\Registry;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

use function count;
use function json_encode;
use function json_last_error_msg;
use function min;
use function max;
use function response;

class MapData implements RequestHandlerInterface
{
    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        try {
            $tree = \Fisharebest\Webtrees\Validator::attributes($request)->tree();
            $xref = \Fisharebest\Webtrees\Validator::queryParams($request)->string('root_person_id', '');
            $direction = \Fisharebest\Webtrees\Validator::queryParams($request)->string('direction', 'UP');
            $generations = \Fisharebest\Webtrees\Validator::queryParams($request)->isBetween(3, 100)->integer('generations', 5);

            if (!$tree) {
                return response(json_encode(['error' => 'Tree not found']))
                    ->withHeader('Content-Type', 'application/json')->withStatus(404);
            }

            $individual = Registry::individualFactory()->make($xref, $tree);

            if (!$individual) {
                return response(json_encode(['error' => 'Individual not found']))
                    ->withHeader('Content-Type', 'application/json')->withStatus(404);
            }

            // Check for access rights
            $individual = \Fisharebest\Webtrees\Auth::checkIndividualAccess($individual);

            // Get the properly initialized module instance from the module service
            $module_service = Registry::container()->get(\Fisharebest\Webtrees\Services\ModuleService::class);
            $module = $module_service->findByInterface(Module::class)->first(function ($mod) {
                return $mod instanceof Module;
            });

            if (!$module) {
                throw new \Exception('Time Travel Map module not found');
            }

            $walker = new TreeWalker(
                Registry::container()->get(\Fisharebest\Webtrees\Services\ChartService::class),
                $module
            );

            $individualsData = $walker->getIndividualsData($individual, $direction, $generations);

            $minYear = null;
            $maxYear = null;

            if (!empty($individualsData)) {
                // Calculate global min/max year for scale
                $allYears = [];
                foreach ($individualsData as $ind) {
                    if ($ind['yearFrom'])
                        $allYears[] = $ind['yearFrom'];
                    if ($ind['yearTo'])
                        $allYears[] = $ind['yearTo'];
                    foreach ($ind['events'] as $evt) {
                        $allYears[] = $evt['year'];
                    }
                }
                if (!empty($allYears)) {
                    $minYear = min($allYears);
                    $maxYear = max($allYears);
                }
            }

            $json = json_encode([
                'metadata' => [
                    'min_year' => $minYear,
                    'max_year' => $maxYear,
                ],
                // We return the list of individuals, each containing their events
                'individuals' => $individualsData,
            ]);

            if ($json === false) {
                throw new \Exception('JSON Encode Error: ' . json_last_error_msg());
            }

            return response($json)->withHeader('Content-Type', 'application/json');

        } catch (\Throwable $e) {
            return response(json_encode([
                'error' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'trace' => $e->getTraceAsString()
            ]))->withHeader('Content-Type', 'application/json')->withStatus(500);
        }
    }
}
