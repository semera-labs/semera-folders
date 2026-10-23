<?php
namespace Semera\Folders;

defined( 'ABSPATH' ) || exit;

/**
 * Renders the folder UI of the library's list view on the server: the
 * "New folder" button and the folder rows.
 *
 * WP_List_Table has no hooks for any of these, so they are spliced into the
 * page output. Everything is in the HTML from the first byte; the script then
 * only adopts it. If a marker is not found (different markup, other plugins
 * interfering) nothing is spliced and the script builds the same elements.
 */
final class ListView {

	private const ICONS = array(
		'folder' => '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path class="sf-fill" d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4l1.6 1.8h7.4A1.5 1.5 0 0 1 18 7.3v7.2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z"/></svg>',
		'up'     => '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 16V5M5.5 9.5L10 5l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
		'plus'   => '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
	);

	public static function init(): void {
		add_action( 'load-upload.php', array( self::class, 'start' ) );
	}

	public static function start(): void {
		if ( Folders::can_manage() && Media::is_list_mode() ) {
			ob_start( array( self::class, 'inject' ) );
			add_action( 'admin_footer', array( Preview::class, 'shell' ) );
		}
	}

	public static function inject( string $html ): string {
		// Only the library's list table; admin-ajax or redirects never reach here with these markers.
		$rows = self::rows();

		$html = self::insert( $html, '/<tbody id="the-list"[^>]*>/', $rows, false );
		return self::insert( $html, '/<div class="alignleft actions bulkactions">.*?<\/div>/s', self::new_folder(), false );
	}

	/** Insert $insertion before or after the first match of $pattern; unchanged if there is none. */
	private static function insert( string $html, string $pattern, string $insertion, bool $before ): string {
		if ( '' === $insertion || ! preg_match( $pattern, $html, $match, PREG_OFFSET_CAPTURE ) ) {
			return $html;
		}
		$position = $match[0][1] + ( $before ? 0 : strlen( $match[0][0] ) );
		return substr_replace( $html, $insertion, $position, 0 );
	}

	/* ---------------------------------------------------------------------
	 * Pieces (keep the markup in sync with assets/js/semera-folders.js)
	 * ------------------------------------------------------------------ */

	private static function icon( string $name, string $class = '' ): string {
		return sprintf( '<span class="%s" aria-hidden="true">%s</span>', esc_attr( trim( 'sf-icon ' . $class ) ), self::ICONS[ $name ] );
	}

	/** Address of the list view for a folder (0 = top level). */
	private static function url( int $folder ): string {
		$url = remove_query_arg( array( 'paged', 's', 'm', 'detached', 'attachment-filter', 'post_mime_type', 'sf_folder' ) );
		return $folder ? add_query_arg( 'sf_folder', $folder, $url ) : $url;
	}

	private static function current_folder(): int {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filter.
		$requested = isset( $_GET['sf_folder'] ) ? Folders::parse_filter( wp_unslash( $_GET['sf_folder'] ) ) : null;
		return is_int( $requested ) ? $requested : 0;
	}

	/** The "New folder" button, where the bulk actions used to be. */
	private static function new_folder(): string {
		return sprintf(
			'<div class="alignleft actions sf-newfolder-wrap"><button type="button" class="sf-newfolder button" title="%s">%s<span>%s</span></button></div>',
			esc_attr__( 'New folder', 'semera-folders' ),
			self::icon( 'plus' ),
			esc_html__( 'New folder', 'semera-folders' )
		);
	}

	/** "Up one level" and the subfolders, as table rows. None in search results. */
	private static function rows(): string {
		if ( Media::is_flat_request() ) {
			return '';
		}

		$table = _get_list_table( 'WP_Media_List_Table', array( 'screen' => get_current_screen() ) );
		list( $columns, $hidden, , $primary ) = $table->get_column_info();

		$parent  = self::current_folder();
		$folders = Media::snapshot()['folders'];
		$by_id   = array();
		foreach ( $folders as $folder ) {
			$by_id[ $folder['id'] ] = $folder;
		}
		$kids = static function ( int $of ) use ( $folders ): array {
			$list = array_values(
				array_filter(
					$folders,
					static function ( $folder ) use ( $of ) {
						return $folder['parent'] === $of;
					}
				)
			);
			usort(
				$list,
				static function ( $a, $b ) {
					return strnatcasecmp( $a['name'], $b['name'] );
				}
			);
			return $list;
		};

		$entries = array();
		if ( $parent ) {
			$entries[] = array(
				'up'    => true,
				'key'   => isset( $by_id[ $parent ] ) ? (int) $by_id[ $parent ]['parent'] : 0,
				'label' => __( 'Up one level', 'semera-folders' ),
			);
		}
		foreach ( $kids( $parent ) as $folder ) {
			$entries[] = array(
				'up'    => false,
				'key'   => $folder['id'],
				'label' => $folder['name'],
				'count' => $folder['count'] + count( $kids( $folder['id'] ) ),
			);
		}

		$html = '';
		foreach ( $entries as $entry ) {
			$html .= self::row( $entry, $columns, $hidden, $primary );
		}
		return $html;
	}

	private static function row( array $entry, array $columns, array $hidden, string $primary ): string {
		$cells = '';
		foreach ( $columns as $id => $label ) {
			if ( 'cb' === $id ) {
				$cells .= '<th scope="row" class="check-column"></th>';
				continue;
			}

			$classes = 'column-' . $id . ( $id === $primary ? ' column-primary' : '' ) . ( in_array( $id, $hidden, true ) ? ' hidden' : '' );
			$content = '';
			if ( 'title' === $id ) {
				$content = sprintf(
					'<strong class="has-media-icon"><a class="sf-folder-link" href="%s">%s%s</a></strong>',
					esc_url( self::url( $entry['key'] ) ),
					self::icon( $entry['up'] ? 'up' : 'folder', $entry['up'] ? 'sf-ico-up' : '' ),
					esc_html( $entry['label'] )
				);
			} elseif ( 'sf_type' === $id && ! $entry['up'] ) {
				$content = esc_html__( 'Folder', 'semera-folders' );
			} elseif ( 'sf_size' === $id && ! $entry['up'] ) {
				/* translators: %d: number of items in a folder */
				$content = esc_html( 1 === $entry['count'] ? __( '1 item', 'semera-folders' ) : sprintf( __( '%d items', 'semera-folders' ), $entry['count'] ) );
			}

			$cells .= sprintf( '<td class="%s" data-colname="%s">%s</td>', esc_attr( $classes ), esc_attr( wp_strip_all_tags( (string) $label ) ), $content );
		}

		return sprintf(
			'<tr class="sf-folder-row%s" data-key="%s"%s%s tabindex="0">%s</tr>',
			$entry['up'] ? ' sf-up-row' : '',
			$entry['key'] ? (int) $entry['key'] : 'root',
			$entry['up'] ? ' data-sf-up=""' : '',
			$entry['up'] ? '' : ' draggable="true"',
			$cells
		);
	}
}
