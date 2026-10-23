<?php
/**
 * Plugin Name:       Semera Folders
 * Description:       Organise the WordPress media library in folders, the way you know it from Windows Explorer.
 * Version:           0.1.2
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            semera
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       semera-folders
 * Domain Path:       /languages
 */

defined( 'ABSPATH' ) || exit;

define( 'SEMERA_FOLDERS_VERSION', '0.1.2' );
define( 'SEMERA_FOLDERS_FILE', __FILE__ );
define( 'SEMERA_FOLDERS_DIR', plugin_dir_path( __FILE__ ) );
define( 'SEMERA_FOLDERS_URL', plugin_dir_url( __FILE__ ) );

require_once SEMERA_FOLDERS_DIR . 'includes/Folders.php';
require_once SEMERA_FOLDERS_DIR . 'includes/Rest.php';
require_once SEMERA_FOLDERS_DIR . 'includes/Media.php';
require_once SEMERA_FOLDERS_DIR . 'includes/Preview.php';
require_once SEMERA_FOLDERS_DIR . 'includes/ListView.php';
require_once SEMERA_FOLDERS_DIR . 'includes/Plugin.php';

\Semera\Folders\Plugin::boot();
