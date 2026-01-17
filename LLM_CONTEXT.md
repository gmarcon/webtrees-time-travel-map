# Webtrees "Time Travel Map" Module - LLM Context

## 1. Project Overview
**Time Travel Map** is a custom module for **webtrees 2.2.x**. It visualizes the geographic history of a family tree over time.
-   **Core Feature**: An interactive Leaflet map with a timeline slider.
-   **Modes**:
    -   **Ancestors**: Traces back from a starting person into the past.
    -   **Descendants**: Plays forward from a root ancestor to the present.
-   **Goal**: Show how a family moved across the globe generation by generation.

## 2. Technical Environment
-   **Platform**: webtrees 2.2.x (Latest stable).
-   **Language**: PHP 8.3+ (Strict typing `declare(strict_types=1);` required).
-   **Frontend**: Leaflet.js (Map), OpenStreetMap (Tiles). Plain JS (ES6+) for logic.
-   **Namespace**: `Fisharebest\Webtrees\Module\Custom\TimeTravelMap`
-   **Database**: NEVER use raw SQL. Use `Fisharebest\Webtrees\DB` or Webtrees Object methods (e.g., `$individual->facts()`).

## 3. Directory Structure & Architecture
The module is located in: `modules_v4/time-travel-map/`

### Core Classes (`src/`)
| Class | Path | Responsibility |
| :--- | :--- | :--- |
| **Module** | `src/Module.php` | **Entry Point**. Registers the module, menu items, and routes. Implements `ModuleCustomInterface`, `ModuleChartInterface`. |
| **MapPage** | `src/Http/MapPage.php` | **View Controller** (PSR-15). Handles `GET/POST /view`. Validates input (`tree`, `xref`), helps with permissions using `Auth`, and renders the `views/chart.phtml` template. |
| **MapData** | `src/Http/MapData.php` | **Data Controller** (PSR-15). Handles `GET /data`. Calls `TreeWalker` and returns the timeline events as JSON. |
| **TreeWalker** | `src/Services/TreeWalker.php` | **Service**. The brain of the module. Traverses the tree (Ancestors or Descendants) using `ChartService`, extracts facts (`BIRT`, `MARR`, `DEAT`, `RESI`, `OCCU`, etc.), and geocodes them. Handles location inheritance. |

### Views & Resources
-   **Template**: `views/chart.phtml` (Main UI container, Fullscreen wrapper).
-   **Assets**: `resources/js/time-map.js` (Map logic), `resources/css/map-style.css`.

## 4. Data Logic & JSON Format
The `MapData` controller returns a JSON object containing metadata and a list of individuals.

### Structure
```json
{
  "metadata": {
    "min_year": 1700,
    "max_year": 2024
  },
  "individuals": [
    {
      "id": "I123",
      "url": "https://example.com/tree/MyTree/individual/I123/Jane-Doe",
      "name": "Jane Doe",
      "thumb": "https://example.com/thumbs/...",
      "father": "I100",
      "mother": "I101",
      "yearFrom": 1850,
      "yearTo": 1920,
      "events": [
        {
          "event_type": "BIRT",
          "event_label": "Birth",
          "year": 1850,
          "GEDdate": "10 JAN 1850",
          "coords": [51.5074, -0.1278],
          "location": "London, UK"
        }
      ]
    }
  ]
}
```

### Tree Traversal & Logic (TreeWalker)
1.  **Input**: Root Individual (`XREF`), Mode (`ancestors` vs `descendants`), Generations (int).
2.  **Service**: Use `Fisharebest\Webtrees\Services\ChartService` for tree traversal.
3.  **Fact Extraction**:
    -   Standard **INDI Facts**: `BIRT`, `CHR`, `BAPM`, `DEAT`, `BURI`, `CREM`, `RESI`, `EDUC`, `OCCU`, `CENS`, `EVEN`.
    -   Standard **FAM Facts**: `MARR`, `DIV`, `CENS`, `RESI`, `EVEN`.
    -   INDI/FAM extracted facts are configurable in the standard webtrees module configuration.
    -   **Location Inheritance**:
        -   If an individual has **NO** events with coordinates, the system guesses the location from relatives.
        -   **Ancestors Mode (UP)**: Looks at *children* to find the *earliest* event to use as a fallback.
        -   **Descendants Mode (DOWN)**: Looks at *parents* to find the *latest* event to use as a fallback.
        -   Inherited events are types as `cal` (Estimated Location).
4.  **Alive period estimation**:
    -   `yearFrom`: Birth year or min event year.
    -   `yearTo`: Death year, current year (if alive), or max event year.

## 5. Development Constraints (CRITICAL)
1.  **Namespaces**: Adhere strictly to PSR-4.
    -   `Fisharebest\Webtrees\Module\Custom\TimeTravelMap\Http`
    -   `Fisharebest\Webtrees\Module\Custom\TimeTravelMap\Services`
2.  **Dependency Injection**: Do not use `new Class()`. Inject dependencies via `__construct`.
    -   Use `Fisharebest\Webtrees\Registry` factories only when necessary (e.g., `Registry::individualFactory()`).
3.  **Modern Webtrees Patterns**:
    -   Do **NOT** use legacy global functions.
    -   Use `Validator` for request attributes.
    -   Use `ViewResponseTrait` for returning HTML views.
4.  **Frontend**:
    -   Do not assume jQuery is available (use Vanilla JS).
    -   Map logic resides in `resources/js/time-map.js`.

## 6. Current Routing
Routes are defined in `Module::boot()`:
-   `GET  .../time-travel-map/view` -> `Http\MapPage`
-   `POST .../time-travel-map/view` -> `Http\MapPage`
-   `GET  .../time-travel-map/data` -> `Http\MapData`
