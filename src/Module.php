<?php

namespace Fisharebest\Webtrees\Module\Custom\TimeTravelMap;

use Fisharebest\Webtrees\Contracts\ElementInterface;
use Fisharebest\Webtrees\Elements\UnknownElement;
use Fisharebest\Webtrees\FlashMessages;
use Fisharebest\Webtrees\I18N;
use Illuminate\Support\Collection;
use Fisharebest\Webtrees\Individual;
use Fisharebest\Webtrees\Menu;
use Fisharebest\Localization\Translation;
use Fisharebest\Webtrees\Module\AbstractModule;
use Fisharebest\Webtrees\Module\ModuleChartInterface;
use Fisharebest\Webtrees\Module\ModuleConfigInterface;
use Fisharebest\Webtrees\Module\ModuleConfigTrait;
use Fisharebest\Webtrees\Module\ModuleCustomInterface;
use Fisharebest\Webtrees\Module\ModuleCustomTrait;
use Fisharebest\Webtrees\Registry;
use Fisharebest\Webtrees\Validator;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

use function redirect;
use function view;

/**
 * Class Module
 */
class Module extends AbstractModule implements ModuleCustomInterface, ModuleChartInterface, ModuleConfigInterface
{
    use ModuleCustomTrait;
    use ModuleConfigTrait;

    public const DEFAULT_INDI_TAGS = ['BIRT', 'CHR', 'BAPM', 'DEAT', 'BURI', 'CREM', 'RESI', 'EDUC', 'OCCU', 'CENS', 'EVEN'];
    public const DEFAULT_FAM_TAGS = ['MARR', 'DIV', 'CENS', 'RESI', 'EVEN'];

    public const CUSTOM_VERSION = '1.0.6';
    public const CUSTOM_AUTHOR = 'Giulio Marcon';
    public const GITHUB_REPO = 'gmarcon/webtrees-time-travel-map';

    /**
     * @return string
     */
    public function title(): string
    {
        return I18N::translate('Time Travel Map');
    }

    /**
     * @return string
     */
    public function description(): string
    {
        return I18N::translate('Time Travel Map is a module to visualize the geographic history of a family over time.');
    }

    /**
     * @return string
     */
    public function customModuleAuthorName(): string
    {
        return self::CUSTOM_AUTHOR;
    }

    /**
     * @return string
     */
    public function customModuleVersion(): string
    {
        return self::CUSTOM_VERSION;
    }

    /**
     * @return string
     */
    public function customModuleLatestVersionUrl(): string
    {
        return 'https://raw.githubusercontent.com/' . self::GITHUB_REPO . '/main/latest-version.txt';
    }

    /**
     * @return string
     */
    public function customModuleSupportUrl(): string
    {
        return 'https://github.com/' . self::GITHUB_REPO;
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
            'menu-chart-pedigreemap'
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
            'menu-chart-pedigreemap'
        );
    }

    /**
     * CSS class for the menu.
     *
     * @return string
     */
    public function chartMenuClass(): string
    {
        return 'menu-chart-pedigreemap';
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

        Registry::routeFactory()->routeMap()
            ->get(self::class . '::data', '/tree/{tree}/time-travel-map/data', Http\MapData::class);

        \Fisharebest\Webtrees\View::registerNamespace('modules/time-travel-map', __DIR__ . '/../views/');
    }

    /**
     * The folder for the module ressources
     * {@inheritDoc}
     *
     * @return string
     *
     * @see \Fisharebest\Webtrees\Module\AbstractModule::resourcesFolder()
     */
    public function resourcesFolder(): string
    {
        return __DIR__ . '/../resources/';
    }

    /**
     * Additional/updated translations.
     *
     * @param string $language
     *
     * @return array
     */
    public function customTranslations(string $language): array
    {
        $lang_dir = $this->resourcesFolder() . 'lang/';
        $file = $lang_dir . $language . '.mo';
        if (file_exists($file)) {
            return (new Translation($file))->asArray();
        } else {
            return [];
        }
    }

    /**
     * @return ResponseInterface
     */
    public function getAdminAction(): ResponseInterface
    {
        $this->layout = 'layouts/administration';

        $magic = '___DEFAULT___';

        $indi_tags = $this->getPreference('indi_tags', $magic);
        if ($indi_tags === $magic) {
            $indi_tags = implode(',', self::DEFAULT_INDI_TAGS);
        }

        $fam_tags = $this->getPreference('fam_tags', $magic);
        if ($fam_tags === $magic) {
            $fam_tags = implode(',', self::DEFAULT_FAM_TAGS);
        }

        return $this->viewResponse('modules/time-travel-map::config', [
            'indi_tags' => explode(',', $indi_tags),
            'fam_tags' => explode(',', $fam_tags),
            'indi_options' => $this->getAllIndiOptions(),
            'fam_options' => $this->getAllFamOptions(),
            'title' => $this->title(),
            'module' => $this,
        ]);
    }

    /**
     * @param ServerRequestInterface $request
     *
     * @return ResponseInterface
     */
    public function postAdminAction(ServerRequestInterface $request): ResponseInterface
    {
        $indi_tags = Validator::parsedBody($request)->array('indi_tags');
        $fam_tags = Validator::parsedBody($request)->array('fam_tags');

        $this->setPreference('indi_tags', implode(',', $indi_tags));
        $this->setPreference('fam_tags', implode(',', $fam_tags));

        FlashMessages::addMessage(I18N::translate('The preferences for the module “%s” have been updated.', $this->title()), 'success');

        return redirect($this->getConfigLink());
    }

    public function getIndiTags(): array
    {
        $magic = '___DEFAULT___';
        $tags = $this->getPreference('indi_tags', $magic);

        if ($tags === $magic) {
            return self::DEFAULT_INDI_TAGS;
        }

        if ($tags === '') {
            return [];
        }

        $result = explode(',', $tags);
        return $result;
    }

    public function getFamTags(): array
    {
        $magic = '___DEFAULT___';
        $tags = $this->getPreference('fam_tags', $magic);

        if ($tags === $magic) {
            return self::DEFAULT_FAM_TAGS;
        }

        if ($tags === '') {
            return [];
        }

        return explode(',', $tags);
    }

    /**
     * @return array<string,string>
     */
    /**
     * @return array<string,string>
     */
    private function getAllIndiOptions(): array
    {
        $ignore_facts = ['CHAN', 'CHIL', 'FAMC', 'FAMS', 'HUSB', 'SUBM', 'WIFE', 'NAME', 'SEX'];

        return Collection::make(Registry::elementFactory()->make('INDI')->subtags())
            ->filter(static fn(string $value, string $key): bool => !in_array($key, $ignore_facts, true))
            ->mapWithKeys(static fn(string $value, string $key): array => [$key => 'INDI:' . $key])
            ->map(static fn(string $tag): ElementInterface => Registry::elementFactory()->make($tag))
            ->filter(static fn(ElementInterface $element): bool => !$element instanceof UnknownElement)
            ->map(static fn(ElementInterface $element, string $tag): string => $element->label() . ' (' . str_replace('INDI:', '', $tag) . ')')
            ->sort(I18N::comparator())
            ->all();
    }

    /**
     * @return array<string,string>
     */
    private function getAllFamOptions(): array
    {
        $ignore_facts = ['CHAN', 'CHIL', 'FAMC', 'FAMS', 'HUSB', 'SUBM', 'WIFE', 'NAME', 'SEX'];

        return Collection::make(Registry::elementFactory()->make('FAM')->subtags())
            ->filter(static fn(string $value, string $key): bool => !in_array($key, $ignore_facts, true))
            ->mapWithKeys(static fn(string $value, string $key): array => [$key => 'FAM:' . $key])
            ->map(static fn(string $tag): ElementInterface => Registry::elementFactory()->make($tag))
            ->filter(static fn(ElementInterface $element): bool => !$element instanceof UnknownElement)
            ->map(static fn(ElementInterface $element, string $tag): string => $element->label() . ' (' . str_replace('FAM:', '', $tag) . ')')
            ->sort(I18N::comparator())
            ->all();
    }
}
