<?php

namespace Fisharebest\Webtrees\Module\Custom\TimeTravelMap;

/**
 * Autoloader for the module classes.
 */
spl_autoload_register(function ($class) {
    $prefix = 'Fisharebest\\Webtrees\\Module\\Custom\\TimeTravelMap\\';
    $base_dir = __DIR__ . '/src/';
    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        return;
    }
    $relative_class = substr($class, $len);
    $file = $base_dir . str_replace('\\', '/', $relative_class) . '.php';
    if (file_exists($file)) {
        require $file;
    }
});

return new Module();
