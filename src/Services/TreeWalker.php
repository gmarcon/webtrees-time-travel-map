<?php

namespace Fisharebest\Webtrees\Module\Custom\TimeTravelMap\Services;

use Fisharebest\Webtrees\Individual;
use Fisharebest\Webtrees\Fact;
use Fisharebest\Webtrees\Services\ChartService;
use Fisharebest\Webtrees\Gedcom;
use Fisharebest\Webtrees\I18N;
use Fisharebest\Webtrees\Registry;
use function route;

class TreeWalker
{
    private ChartService $chart_service;

    /**
     * TreeWalker constructor.
     * @param ChartService $chart_service
     */
    public function __construct(ChartService $chart_service)
    {
        $this->chart_service = $chart_service;
    }

    /**
     * Get individuals with their events and timespan.
     * 
     * @param Individual $root
     * @param string $direction 'UP' for ancestors or 'DOWN' for descendants
     * @param int $generations
     * @return array
     */
    public function getIndividualsData(Individual $root, string $direction, int $generations): array
    {
        $result = [];
        $individuals = [];

        if ($direction === 'UP') {
            $ancestors = $this->chart_service->sosaStradonitzAncestors($root, $generations);
            $individuals = $ancestors->all();
        } elseif ($direction === 'DOWN') {
            $descendants = $this->chart_service->descendants($root, $generations);
            $individuals = $descendants->all();
        } else {
            $individuals = [$root];
        }

        foreach ($individuals as $person) {
            if (!$person instanceof Individual) {
                continue;
            }

            $data = $this->processIndividual($person, $direction);
            if ($data) {
                $result[] = $data;
            }
        }

        return $result;
    }

    private function processIndividual(Individual $person, string $direction): ?array
    {
        $events = [];
        $this->extractEvents($person, $events);

        // If no events, try to inherit standard location from relatives
        if (empty($events)) {
            $inherited = $this->findInheritedLocation($person, $direction);
            if ($inherited) {
                $events[] = [
                    'event_type' => 'cal',
                    'event_label' => I18N::translate('Estimated Location'),
                    'year' => $inherited['year'],
                    'GEDdate' => '',
                    'coords' => $inherited['coords'],
                    'location' => $inherited['location'],
                ];
            } else {
                return null;
            }
        }

        // Estimate Birth and Death Year
        $birthDate = $person->getBirthDate();
        $deathDate = $person->getDeathDate();

        $yearFrom = $this->extractYear($birthDate, 'min');
        $yearTo = $this->extractYear($deathDate, 'max');

        // Fallback: Estimate from events if missing
        $eventYears = array_column($events, 'year');
        if (!empty($eventYears)) {
            if ($yearFrom === null) {
                $yearFrom = min($eventYears);
            }
            if ($yearTo === null) {
                if ($person->isDead()) {
                    $yearTo = max($eventYears);
                }
            }
        }

        if ($yearFrom === null) {
            // No start year, can't map
            return null;
        }

        // Alive logic
        if (!$person->isDead()) {
            $yearTo = (int) date('Y');
        } elseif ($yearTo === null) {
            // Dead but no date found, use max event year
            if (!empty($eventYears)) {
                $yearTo = max($eventYears);
            } else {
                $yearTo = $yearFrom; // Fallback
            }
        }

        // Parents
        $fatherId = null;
        $motherId = null;
        $families = $person->childFamilies();
        foreach ($families as $family) {
            $husb = $family->husband();
            $wife = $family->wife();
            if ($husb)
                $fatherId = $husb->xref();
            if ($wife)
                $motherId = $wife->xref();
            break; // Usually only one birth family
        }

        // Thumbnail
        $thumbUrl = null;
        $mediaFile = $person->findHighlightedMediaFile();
        if ($mediaFile !== null) {
            $thumbUrl = $mediaFile->imageUrl(80, 80, 'crop');
        }

        return [
            'id' => $person->xref(),
            'url' => $person->url(),
            'name' => strip_tags($person->fullName()),
            'thumb' => $thumbUrl,
            'father' => $fatherId,
            'mother' => $motherId,
            'yearFrom' => $yearFrom,
            'yearTo' => $yearTo,
            'events' => $events,
        ];
    }

    private function extractEvents(Individual $person, array &$events): void
    {
        // Relevant tags for INDI
        $indiTags = array_merge(
            Gedcom::BIRTH_EVENTS,
            Gedcom::DEATH_EVENTS,
            ['RESI', 'BURI', 'EDUC', 'OCCU', 'CENS']
        );

        foreach ($person->facts($indiTags, false, null, true) as $fact) {
            $this->processFact($person, $fact, $events);
        }

        // Relevant tags for FAM
        $famTags = array_merge(
            Gedcom::MARRIAGE_EVENTS,
            ['DIV', 'CENS', 'RESI'] // Census and Residence can also be on FAM
        );

        foreach ($person->spouseFamilies() as $family) {
            foreach ($family->facts($famTags, false, null, true) as $fact) {
                $this->processFact($person, $fact, $events);
            }
        }

        // Sort events by year
        usort($events, function ($a, $b) {
            return $a['year'] <=> $b['year'];
        });
    }

    private function processFact(Individual $person, Fact $fact, array &$events): void
    {
        $date = $fact->date();
        // Use conservative approach: we want the event to appear "at" a specific time.
        // For range dates in events, usually "FROM X TO Y", the event start is X.
        $year = $this->extractYear($date, 'min');

        if ($year === null) {
            return;
        }

        $place = $fact->place();
        if (!$place || $place->gedcomName() === '') {
            return;
        }

        $lat = $fact->latitude();
        $lng = $fact->longitude();

        if ($lat === null || $lng === null) {
            $location = new \Fisharebest\Webtrees\PlaceLocation($place->gedcomName());
            $lat = $location->latitude();
            $lng = $location->longitude();
        }

        if ($lat === null || $lng === null) {
            return;
        }

        $eventTag = $fact->tag();
        $eventInfo = $this->getEventInfo($eventTag);
        $eventLabel = $eventInfo['label'];

        // Format Gedcom date string for display (raw)
        $gedDate = $date->isOk() ? $fact->attribute('DATE') : '';

        $events[] = [
            'event_type' => $eventTag,
            'event_label' => $eventLabel,
            'year' => $year,
            'GEDdate' => $gedDate,
            'coords' => [(float) $lat, (float) $lng],
            'location' => $place->gedcomName(),
        ];
    }

    private function getEventInfo(string $eventTag): array
    {
        // Map from GEDCOM tag to Webtrees I18N standard translation keys:
        $label = $eventTag;
        switch ($eventTag) {
            case 'BIRT':
            case 'INDI:BIRT':
                $label = I18N::translate('Birth');
                break;
            case 'CHR':
            case 'INDI:CHR':
                $label = I18N::translate('Christening');
                break;
            case 'BAPM':
            case 'INDI:BAPM':
                $label = I18N::translate('Baptism');
                break;
            case 'MARR':
            case 'INDI:MARR':
            case 'FAM:MARR':
                $label = I18N::translate('Marriage');
                break;
            case 'DIV':
            case 'FAM:DIV':
                $label = I18N::translate('Divorce');
                break;
            case 'RESI':
            case 'INDI:RESI':
            case 'FAM:RESI':
                $label = I18N::translate('Residence');
                break;
            case 'DEAT':
            case 'INDI:DEAT':
                $label = I18N::translate('Death');
                break;
            case 'BURI':
            case 'INDI:BURI':
                $label = I18N::translate('Burial');
                break;
            case 'CENS':
            case 'INDI:CENS':
            case 'FAM:CENS':
                $label = I18N::translate('Census');
                break;
            case 'OCCU':
            case 'INDI:OCCU':
                $label = I18N::translate('Occupation');
                break;
            case 'EDUC':
            case 'INDI:EDUC':
                $label = I18N::translate('Education');
                break;
            case 'EVEN':
            case 'INDI:EVEN':
                $label = I18N::translate('Event');
                break;
            default:
                $label = $eventTag;
                break;
        }

        return [
            'label' => $label,
        ];
    }

    /**
     * Extract year from Date object using min/max strategy
     * e.g. "BET 1800 AND 1810" -> min=1800, max=1810
     * e.g. "FROM 1800 TO 1810" -> min=1800, max=1810
     */
    private function extractYear($date, string $strategy): ?int
    {
        if (!$date || !$date->isOk()) {
            return null;
        }
        if ($strategy === 'min') {
            $d = $date->minimumDate();
            return $d ? $d->year() : null;
        } else {
            $d = $date->maximumDate();
            return $d ? $d->year() : null;
        }
    }

    /**
     * Recursive lookup for inherited location.
     * UP (Ancestors) -> Look at Children (Earliest Event)
     * DOWN (Descendants) -> Look at Parents (Latest Event)
     * @param Individual $person
     * @param string $direction
     * @param array $visited
     * @return array|null ['year' => int, 'coords' => [lat,lng], 'location' => string]
     */
    private function findInheritedLocation(Individual $person, string $direction, array $visited = []): ?array
    {
        $xref = $person->xref();
        if (in_array($xref, $visited, true)) {
            return null;
        }
        $visited[] = $xref;

        $candidates = [];

        if ($direction === 'UP') {
            // "first of the child" -> Look at children
            foreach ($person->spouseFamilies() as $family) {
                foreach ($family->children() as $child) {
                    $this->collectCandidate($child, $direction, $visited, $candidates);
                }
            }
        } elseif ($direction === 'DOWN') {
            // "latest of the parents" -> Look at parents
            foreach ($person->childFamilies() as $family) {
                foreach ($family->spouses() as $parent) {
                    // Spouses of my child-family are my parents
                    $this->collectCandidate($parent, $direction, $visited, $candidates);
                }
            }
        }

        if (empty($candidates)) {
            return null;
        }

        // UP: smaller year among all children props
        // DOWN: larger year among parent props
        usort($candidates, function ($a, $b) {
            return $a['year'] <=> $b['year'];
        });

        if ($direction === 'UP') {
            return $candidates[0]; // Min year
        } else {
            return end($candidates); // Max year
        }
    }

    private function collectCandidate(Individual $relative, string $direction, array $visited, array &$candidates): void
    {
        // First check if relative has events
        $events = [];
        $this->extractEvents($relative, $events); // This sorts them by year ASC

        if (!empty($events)) {
            // Found events!
            // UP (looking at Child): want "first/earliest"
            // DOWN (looking at Parent): want "latest"
            if ($direction === 'UP') {
                $targetEvent = $events[0];
            } else {
                $targetEvent = end($events);
            }
            $candidates[] = [
                'year' => $targetEvent['year'],
                'coords' => $targetEvent['coords'],
                'location' => $targetEvent['location'],
            ];
        } else {
            // No events, recurse
            $inherited = $this->findInheritedLocation($relative, $direction, $visited);
            if ($inherited) {
                $candidates[] = $inherited;
            }
        }
    }
}
