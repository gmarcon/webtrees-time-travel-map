<?php

namespace Fisharebest\Webtrees\Module\Custom\TimeTravelMap;

use Fisharebest\Webtrees\I18N;
use Fisharebest\Webtrees\Individual;
use Fisharebest\Webtrees\Menu;
use Fisharebest\Webtrees\Module\AbstractModule;
use Fisharebest\Webtrees\Module\ModuleChartInterface;
use Fisharebest\Webtrees\Module\ModuleCustomInterface;
use Fisharebest\Webtrees\Registry;

/**
 * Class Module
 */
class Module extends AbstractModule implements ModuleCustomInterface, ModuleChartInterface
{
    /**
     * @return string
     */
    public function title(): string
    {
        return 'Time Travel Map';
    }

    /**
     * @return string
     */
    public function description(): string
    {
        return 'Pedigree/Descendants map over time.';
    }

    /**
     * @return string
     */
    public function customModuleImage(): string
    {
        return '';
    }

    /**
     * @return string
     */
    public function customModuleAuthorName(): string
    {
        return 'Giulio Marcon';
    }

    /**
     * @return string
     */
    public function customModuleVersion(): string
    {
        return '1.0.0';
    }

    /**
     * @return string
     */
    public function customModuleLatestVersionUrl(): string
    {
        return 'https://raw.githubusercontent.com/gmarcon/webtrees-time-travel-map/refs/heads/main/latest-version.txt';
    }

    /**
     * @return string
     */
    public function customModuleLatestVersion(): string
    {
        return '1.0.0';
    }

    /**
     * @return string
     */
    public function customModuleSupportUrl(): string
    {
        return '';
    }

    /**
     * @param string $language
     * @return array
     */
    public function customTranslations(string $language): array
    {
        return [];
    }

    /**
     * A menu item for this chart for an individual box in a chart.
     *
     * @param Individual $individual
     *
     * @return Menu|null
     */
    public function chartBoxMenu(Individual $individual): Menu|null
    {
        return new Menu(
            $this->title(),
            $this->chartUrl($individual),
            'chart-time-travel-map'
        );
    }

    /**
     * A main menu item for this chart.
     *
     * @param Individual $individual
     *
     * @return Menu
     */
    public function chartMenu(Individual $individual): Menu
    {
        return new Menu(
            $this->title(),
            $this->chartUrl($individual),
            'chart-time-travel-map'
        );
    }

    /**
     * CSS class for the menu.
     *
     * @return string
     */
    public function chartMenuClass(): string
    {
        return 'chart-time-travel-map';
    }

    /**
     * The title for a specific instance of this chart.
     *
     * @param Individual $individual
     *
     * @return string
     */
    public function chartTitle(Individual $individual): string
    {
        return $this->title();
    }

    /**
     * The URL for a page showing chart options.
     *
     * @param Individual                                $individual
     * @param array<bool|int|string|array<string>|null> $parameters
     *
     * @return string
     */
    public function chartUrl(Individual $individual, array $parameters = []): string
    {
        return route(self::class . '::view', [
            'tree' => $individual->tree()->name(),
            'xref' => $individual->xref(),
        ] + $parameters);
    }

    /**
     * Attributes for the URL.
     *
     * @return array<string>
     */
    public function chartUrlAttributes(): array
    {
        return [];
    }

    /**
     * Boot the module.
     */
    public function boot(): void
    {
        // Register GET and POST routes for the view page
        Registry::routeFactory()->routeMap()
            ->get(self::class . '::view', '/tree/{tree}/time-travel-map/view', Http\MapPage::class);

        Registry::routeFactory()->routeMap()
            ->post(self::class . '::view-post', '/tree/{tree}/time-travel-map/view', Http\MapPage::class);

        // Register GET route for data endpoint
        Registry::routeFactory()->routeMap()
            ->get(self::class . '::data', '/tree/{tree}/time-travel-map/data', Http\MapData::class);

        \Fisharebest\Webtrees\View::registerNamespace('modules/time-travel-map', __DIR__ . '/../views/');
    }
}
