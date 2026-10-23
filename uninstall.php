<?php
/**
 * Removes the folder structure when the plugin is deleted.
 * The media files themselves are never touched.
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

require_once __DIR__ . '/includes/Folders.php';

\Semera\Folders\Folders::register_taxonomy();

$semera_folder_ids = get_terms(
	array(
		'taxonomy'   => \Semera\Folders\Folders::TAXONOMY,
		'hide_empty' => false,
		'fields'     => 'ids',
	)
);

if ( ! is_wp_error( $semera_folder_ids ) ) {
	foreach ( $semera_folder_ids as $semera_folder_id ) {
		wp_delete_term( (int) $semera_folder_id, \Semera\Folders\Folders::TAXONOMY );
	}
}
