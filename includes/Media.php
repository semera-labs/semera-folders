<?php
namespace Semera\Folders;

defined( 'ABSPATH' ) || exit;

/**
 * Hooks into the media library: filtering, uploads, list table columns,
 * the attachment "Folder" field and the admin assets.
 */
final class Media {

	private const HANDLE = 'semera-folders';

	public static function init(): void {
		add_filter( 'ajax_query_attachments_args', array( self::class, 'filter_ajax_query' ) );
		add_action( 'pre_get_posts', array( self::class, 'filter_list_query' ) );
		add_action( 'add_attachment', array( self::class, 'assign_upload' ) );

		add_filter( 'get_user_option_media_library_mode', array( self::class, 'default_list_mode' ) );
		add_filter( 'get_user_option_upload_per_page', array( self::class, 'default_per_page' ) );

		add_filter( 'admin_body_class', array( self::class, 'body_class' ) );

		add_filter( 'manage_media_columns', array( self::class, 'add_column' ) );
		add_action( 'manage_media_custom_column', array( self::class, 'render_column' ), 10, 2 );

		add_filter( 'attachment_fields_to_edit', array( self::class, 'add_field' ), 10, 2 );
		add_filter( 'attachment_fields_to_save', array( self::class, 'save_field' ), 10, 2 );

		add_action( 'wp_enqueue_media', array( self::class, 'enqueue_for_media' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue_for_list' ) );
	}

	/* ---------------------------------------------------------------------
	 * Queries and uploads
	 * ------------------------------------------------------------------ */

	/** Grid view and media modal: the JS sends `query[sf_folder]`. */
	public static function filter_ajax_query( array $query ): array {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- core verifies the nonce for query-attachments.
		$raw = isset( $_REQUEST['query']['sf_folder'] ) ? wp_unslash( $_REQUEST['query']['sf_folder'] ) : null;
		$filter = Folders::parse_filter( $raw );
		if ( null !== $filter ) {
			$query['tax_query'] = Folders::apply_to_tax_query( $query['tax_query'] ?? array(), $filter );
		}
		return $query;
	}

	/**
	 * List view of upload.php: `?sf_folder=<id>` shows that folder. Without it
	 * the top level is shown, i.e. only files that are in no folder, unless the
	 * user searches or filters: those results span all folders.
	 */
	public static function filter_list_query( \WP_Query $query ): void {
		global $pagenow;
		if ( ! is_admin() || ! $query->is_main_query() || 'upload.php' !== $pagenow ) {
			return;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filter.
		$filter = Folders::parse_filter( isset( $_GET['sf_folder'] ) ? wp_unslash( $_GET['sf_folder'] ) : null );
		if ( null === $filter && ! self::is_flat_request() ) {
			$filter = Folders::UNSORTED;
		}
		if ( null !== $filter ) {
			$query->set( 'tax_query', Folders::apply_to_tax_query( $query->get( 'tax_query' ), $filter ) );
		}
	}

	/** A search or filter on the list view of upload.php. */
	public static function is_flat_request(): bool {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only filters.
		foreach ( array( 's', 'attachment-filter', 'post_mime_type' ) as $name ) {
			if ( ! empty( $_GET[ $name ] ) ) {
				return true;
			}
		}
		$month = isset( $_GET['m'] ) ? (string) wp_unslash( $_GET['m'] ) : '';
		return isset( $_GET['detached'] ) || ( '' !== $month && '0' !== $month );
		// phpcs:enable
	}

	/** New uploads land in the folder the uploader was told about. */
	public static function assign_upload( int $attachment_id ): void {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- piggybacks on the upload request, which core has verified.
		if ( empty( $_REQUEST['sf_folder'] ) || ! Folders::can_manage() ) {
			return;
		}
		$filter = Folders::parse_filter( wp_unslash( $_REQUEST['sf_folder'] ) );
		if ( is_int( $filter ) ) {
			Folders::assign( array( $attachment_id ), $filter );
		}
	}

	/* ---------------------------------------------------------------------
	 * List table column
	 * ------------------------------------------------------------------ */

	public static function add_column( array $columns ): array {
		$extra = array(
			'sf_type' => __( 'Type', 'semera-folders' ),
			'sf_size' => __( 'Size', 'semera-folders' ),
		);

		// Comments on media files are rarely used and take room the file name can use.
		unset( $columns['comments'] );

		$out = array();
		foreach ( $columns as $key => $label ) {
			$out[ $key ] = $label;
			if ( 'title' === $key ) {
				$out += $extra;
			}
		}
		return $out + $extra;
	}

	public static function render_column( string $column, int $post_id ): void {
		switch ( $column ) {
			case 'sf_type':
				$file = get_attached_file( $post_id );
				$ext  = $file ? strtoupper( pathinfo( $file, PATHINFO_EXTENSION ) ) : '';
				echo '' !== $ext ? esc_html( $ext ) : '<span aria-hidden="true">&mdash;</span>';
				break;

			case 'sf_size':
				$meta = wp_get_attachment_metadata( $post_id );
				$size = is_array( $meta ) && ! empty( $meta['filesize'] ) ? (int) $meta['filesize'] : (int) wp_filesize( (string) get_attached_file( $post_id ) );
				echo $size ? esc_html( size_format( $size, 1 ) ) : '<span aria-hidden="true">&mdash;</span>';
				break;
		}
	}

	/**
	 * Marks the list view of the library in the server-rendered <body>, so the
	 * compact rows apply from the first paint instead of after the script ran.
	 */
	public static function body_class( string $classes ): string {
		global $pagenow;
		return 'upload.php' === $pagenow && Folders::can_manage() && self::is_list_mode() ? $classes . ' sf-details' : $classes;
	}

	/** Whether upload.php shows the list view (same rule as core: ?mode=, else the user's choice, else grid). */
	public static function is_list_mode(): bool {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only.
		$mode = isset( $_GET['mode'] ) ? sanitize_key( wp_unslash( $_GET['mode'] ) ) : '';
		if ( ! in_array( $mode, array( 'grid', 'list' ), true ) ) {
			$mode = get_user_option( 'media_library_mode', get_current_user_id() ) ?: 'grid';
		}
		return 'list' === $mode;
	}

	/** The folders with counts, computed once per page load. */
	public static function snapshot(): array {
		static $snapshot = null;
		return $snapshot ?? $snapshot = Folders::snapshot();
	}

	/** An Explorer-style details list is the better default than the grid, and 20 rows per page is too few for it. */
	public static function default_list_mode( $value ) {
		return ( false === $value || '' === $value ) && Folders::can_manage() ? 'list' : $value;
	}

	public static function default_per_page( $value ) {
		return false === $value ? 100 : $value;
	}

	/* ---------------------------------------------------------------------
	 * "Folder" field in the attachment details (modal, grid, edit screen)
	 * ------------------------------------------------------------------ */

	public static function add_field( array $fields, \WP_Post $post ): array {
		if ( ! Folders::can_manage() ) {
			return $fields;
		}

		$current = Folders::folder_of( $post->ID );
		$name    = sprintf( 'attachments[%d][sf_folder]', $post->ID );
		$options = array();

		/*
		 * The compat markup is rendered for every attachment of a media query.
		 * Over AJAX we only print the current value and let the JS fill in the
		 * other options on demand, which keeps the response small.
		 */
		$lazy = wp_doing_ajax();
		$options[] = sprintf( '<option value="0"%s>%s</option>', selected( $current, 0, false ), esc_html__( 'No folder', 'semera-folders' ) );
		foreach ( Folders::flat_tree() as $folder ) {
			if ( $lazy && $folder['id'] !== $current ) {
				continue;
			}
			$options[] = sprintf(
				'<option value="%d"%s>%s%s</option>',
				$folder['id'],
				selected( $current, $folder['id'], false ),
				esc_html( str_repeat( "\u{2014} ", $folder['depth'] ) ),
				esc_html( $folder['name'] )
			);
		}

		$fields['sf_folder'] = array(
			'label' => __( 'Folder', 'semera-folders' ),
			'input' => 'html',
			'html'  => sprintf(
				'<select name="%s" id="%s" class="sf-field-select" data-sf-attachment="%d" data-sf-lazy="%d">%s</select>',
				esc_attr( $name ),
				esc_attr( sprintf( 'attachments-%d-sf_folder', $post->ID ) ),
				$post->ID,
				$lazy ? 1 : 0,
				implode( '', $options )
			),
		);
		return $fields;
	}

	public static function save_field( array $post, array $attachment ): array {
		if ( isset( $attachment['sf_folder'] ) && ! empty( $post['ID'] ) && Folders::can_manage() ) {
			Folders::assign( array( (int) $post['ID'] ), (int) $attachment['sf_folder'] );
		}
		return $post;
	}

	/* ---------------------------------------------------------------------
	 * Assets
	 * ------------------------------------------------------------------ */

	/** Media modal and grid view (anything that loads wp.media). */
	public static function enqueue_for_media(): void {
		if ( ! Folders::can_manage() ) {
			return;
		}
		self::enqueue( true );
	}

	/** List view of the media library, which does not load wp.media. */
	public static function enqueue_for_list( string $hook ): void {
		if ( 'upload.php' !== $hook || ! Folders::can_manage() ) {
			return;
		}
		self::enqueue( false );
	}

	private static function enqueue( bool $with_media ): void {
		if ( ! wp_script_is( self::HANDLE, 'registered' ) ) {
			wp_register_script(
				self::HANDLE,
				SEMERA_FOLDERS_URL . 'assets/js/semera-folders.js',
				array( 'wp-api-fetch' ),
				self::asset_version( 'assets/js/semera-folders.js' ),
				true
			);
			wp_register_style( self::HANDLE, SEMERA_FOLDERS_URL . 'assets/css/semera-folders.css', array(), self::asset_version( 'assets/css/semera-folders.css' ) );
		}

		if ( $with_media ) {
			$script = wp_scripts()->registered[ self::HANDLE ];
			if ( ! in_array( 'media-views', $script->deps, true ) ) {
				$script->deps[] = 'media-views';
			}
		}

		// On the library page our hooks must be in place before the grid frame is built.
		global $pagenow;
		if ( 'upload.php' === $pagenow && isset( wp_scripts()->registered['media-grid'] ) ) {
			$grid = wp_scripts()->registered['media-grid'];
			if ( ! in_array( self::HANDLE, $grid->deps, true ) ) {
				$grid->deps[] = self::HANDLE;
			}
		}

		if ( ! wp_script_is( self::HANDLE, 'enqueued' ) ) {
			wp_add_inline_script( self::HANDLE, 'window.SemeraFoldersData = ' . wp_json_encode( self::client_data() ) . ';', 'before' );
		}
		wp_enqueue_script( self::HANDLE );
		wp_enqueue_style( self::HANDLE );
	}

	/** While developing (WP_DEBUG) the file time busts the browser cache. */
	private static function asset_version( string $file ): string {
		$path = SEMERA_FOLDERS_DIR . $file;
		return ( defined( 'WP_DEBUG' ) && WP_DEBUG && file_exists( $path ) ) ? (string) filemtime( $path ) : SEMERA_FOLDERS_VERSION;
	}

	private static function client_data(): array {
		global $pagenow;
		$on_library = 'upload.php' === $pagenow;

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filter.
		$requested = isset( $_GET['sf_folder'] ) ? Folders::parse_filter( wp_unslash( $_GET['sf_folder'] ) ) : null;

		return array(
			'onLibrary' => $on_library,
			// Inline, so the folders are there when the media modal opens.
			'snapshot'  => self::snapshot(),
			'selected'  => is_int( $requested ) ? $requested : 'root',
			'flat'      => $on_library && self::is_flat_request(),
			// The list view has no uploader of its own; the script posts dropped files to async-upload.php.
			'upload'    => $on_library && current_user_can( 'upload_files' ) ? array(
				'url'   => admin_url( 'async-upload.php' ),
				'nonce' => wp_create_nonce( 'media-form' ),
				'max'   => (int) wp_max_upload_size(),
			) : null,
			'strings'   => array(
				'folders'         => __( 'Folders', 'semera-folders' ),
				'root'            => __( 'Media Library', 'semera-folders' ),
				'noFolder'        => __( 'No folder', 'semera-folders' ),
				'newFolder'       => __( 'New folder', 'semera-folders' ),
				'newSubfolder'    => __( 'New subfolder', 'semera-folders' ),
				'rename'          => __( 'Rename', 'semera-folders' ),
				'delete'          => __( 'Delete', 'semera-folders' ),
				'open'            => __( 'Open', 'semera-folders' ),
				'up'              => __( 'Up one level', 'semera-folders' ),
				'loadError'       => __( 'The folders could not be loaded.', 'semera-folders' ),
				'genericError'    => __( 'Something went wrong. Please try again.', 'semera-folders' ),
				'confirmDelete'   => __( 'Delete the folder "%s"? Its files and subfolders are not deleted; they move up one level.', 'semera-folders' ),
				'moveOne'         => __( 'Move 1 file', 'semera-folders' ),
				/* translators: %d: number of files */
				'moveMany'        => __( 'Move %d files', 'semera-folders' ),
				'moveFolder'      => __( 'Move folder "%s"', 'semera-folders' ),
				'movedOne'        => __( '1 file moved to "%s".', 'semera-folders' ),
				/* translators: 1: number of files, 2: folder name */
				'movedMany'       => __( '%1$d files moved to "%2$s".', 'semera-folders' ),
				'movedFolder'     => __( 'Folder moved.', 'semera-folders' ),
				'loading'         => __( 'Loading…', 'semera-folders' ),
				'dropToUpload'    => __( 'Drop files to upload', 'semera-folders' ),
				/* translators: 1: number of the file being uploaded, 2: total number of files */
				'uploadingN'      => __( 'Uploading %1$d of %2$d …', 'semera-folders' ),
				/* translators: %s: file name */
				'tooLarge'        => __( '"%s" is larger than the upload limit.', 'semera-folders' ),
				/* translators: 1: file name, 2: reason */
				'uploadFailed'    => __( 'Upload of "%1$s" failed: %2$s', 'semera-folders' ),
				'previewError'    => __( 'The preview could not be loaded.', 'semera-folders' ),
				'copied'          => __( 'URL copied.', 'semera-folders' ),
				'folderType'      => __( 'Folder', 'semera-folders' ),
				'itemsOne'        => __( '1 item', 'semera-folders' ),
				/* translators: %d: number of items in a folder */
				'itemsMany'       => __( '%d items', 'semera-folders' ),
			),
		);
	}
}
