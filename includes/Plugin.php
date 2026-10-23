<?php
namespace Semera\Folders;

defined( 'ABSPATH' ) || exit;

final class Plugin {

	public static function boot(): void {
		add_action( 'init', array( Folders::class, 'register_taxonomy' ) );
		add_action( 'init', array( self::class, 'load_textdomain' ), 1 );
		add_action( 'rest_api_init', array( Rest::class, 'register_routes' ) );

		Media::init();
		ListView::init();
	}

	public static function load_textdomain(): void {
		load_plugin_textdomain( 'semera-folders', false, dirname( plugin_basename( SEMERA_FOLDERS_FILE ) ) . '/languages' );
	}
}
