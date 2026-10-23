<?php
namespace Semera\Folders;

defined( 'ABSPATH' ) || exit;

/**
 * The file preview popup of the library's list view.
 *
 * The dialog shell is printed with the page; its content is rendered here, in
 * PHP, and fetched through the REST API when a file is opened (the script
 * prefetches on hover, so it opens without a wait).
 */
final class Preview {

	/** The (empty) dialog, printed once at the end of the list view. */
	public static function shell(): void {
		?>
		<dialog class="sf-preview" aria-labelledby="sf-preview-title">
			<div class="sf-preview-frame">
				<header class="sf-preview-head">
					<h2 id="sf-preview-title" class="sf-preview-title"></h2>
					<div class="sf-preview-nav">
						<button type="button" class="sf-preview-prev" aria-label="<?php esc_attr_e( 'Previous file', 'semera-folders' ); ?>" title="<?php esc_attr_e( 'Previous file', 'semera-folders' ); ?>">&lsaquo;</button>
						<button type="button" class="sf-preview-next" aria-label="<?php esc_attr_e( 'Next file', 'semera-folders' ); ?>" title="<?php esc_attr_e( 'Next file', 'semera-folders' ); ?>">&rsaquo;</button>
					</div>
					<button type="button" class="sf-preview-close" autofocus aria-label="<?php esc_attr_e( 'Close', 'semera-folders' ); ?>" title="<?php esc_attr_e( 'Close', 'semera-folders' ); ?>">&times;</button>
				</header>
				<div class="sf-preview-body" aria-live="polite"></div>
			</div>
		</dialog>
		<?php
	}

	/**
	 * Title and HTML of the popup for one attachment.
	 *
	 * @return array{title:string, html:string}|\WP_Error
	 */
	public static function render( int $id ) {
		$post = get_post( $id );
		if ( ! $post || 'attachment' !== $post->post_type ) {
			return new \WP_Error( 'semera_folders_not_found', __( 'The file does not exist.', 'semera-folders' ), array( 'status' => 404 ) );
		}

		$url  = (string) wp_get_attachment_url( $id );
		$mime = (string) get_post_mime_type( $id );
		$file = (string) get_attached_file( $id );
		$meta = wp_get_attachment_metadata( $id );
		$meta = is_array( $meta ) ? $meta : array();

		$rows   = array();
		$rows[] = array( __( 'File name', 'semera-folders' ), esc_html( $file ? wp_basename( $file ) : wp_basename( $url ) ) );
		$rows[] = array( __( 'File type', 'semera-folders' ), esc_html( $mime ) );

		$size = ! empty( $meta['filesize'] ) ? (int) $meta['filesize'] : (int) wp_filesize( $file );
		if ( $size ) {
			$rows[] = array( __( 'File size', 'semera-folders' ), esc_html( size_format( $size, 1 ) ) );
		}
		if ( ! empty( $meta['width'] ) && ! empty( $meta['height'] ) ) {
			$rows[] = array( __( 'Dimensions', 'semera-folders' ), esc_html( sprintf( '%d × %d px', $meta['width'], $meta['height'] ) ) );
		}
		if ( ! empty( $meta['length_formatted'] ) ) {
			$rows[] = array( __( 'Length', 'semera-folders' ), esc_html( $meta['length_formatted'] ) );
		}

		$rows[] = array( __( 'Uploaded', 'semera-folders' ), esc_html( get_the_date( '', $post ) . ' ' . get_the_time( '', $post ) ) );
		$author = get_the_author_meta( 'display_name', (int) $post->post_author );
		if ( $author ) {
			$rows[] = array( __( 'Uploaded by', 'semera-folders' ), esc_html( $author ) );
		}
		// "Uploaded to", with the Attach / Detach actions the list view no longer shows.
		if ( $post->post_parent && get_post( $post->post_parent ) ) {
			$parent_title = get_the_title( $post->post_parent );
			$parent_link  = current_user_can( 'edit_post', $post->post_parent ) ? get_edit_post_link( $post->post_parent ) : '';
			$detach_url   = add_query_arg(
				array(
					'parent_post_id' => (int) $post->post_parent,
					'media[]'        => $id,
					'_wpnonce'       => wp_create_nonce( 'bulk-media' ),
				),
				admin_url( 'upload.php' )
			);
			$uploaded_to  = ( $parent_link ? sprintf( '<a href="%s">%s</a>', esc_url( $parent_link ), esc_html( $parent_title ) ) : esc_html( $parent_title ) )
				. sprintf( ' <a class="sf-preview-inline" href="%s">%s</a>', esc_url( $detach_url ), esc_html__( 'Detach', 'semera-folders' ) );
		} else {
			// Core's find-posts dialog does the attaching; the script closes the popup before opening it.
			$uploaded_to = esc_html__( 'Unattached', 'semera-folders' )
				. sprintf( ' <a class="sf-preview-inline" href="#the-list" data-sf-attach="%d">%s</a>', $id, esc_html__( 'Attach', 'semera-folders' ) );
		}
		$rows[] = array( __( 'Uploaded to', 'semera-folders' ), $uploaded_to );

		$path   = Folders::path( Folders::folder_of( $id ) );
		$rows[] = array( __( 'Folder', 'semera-folders' ), esc_html( '' !== $path ? $path : __( 'No folder', 'semera-folders' ) ) );

		$alt = (string) get_post_meta( $id, '_wp_attachment_image_alt', true );
		foreach ( array(
			array( __( 'Alt text', 'semera-folders' ), $alt ),
			array( __( 'Caption', 'semera-folders' ), (string) $post->post_excerpt ),
			array( __( 'Description', 'semera-folders' ), (string) $post->post_content ),
		) as $text ) {
			$value = trim( wp_strip_all_tags( $text[1] ) );
			if ( '' !== $value ) {
				$rows[] = array( $text[0], nl2br( esc_html( $value ) ) );
			}
		}

		$sizes = self::sizes( $id, $meta );
		if ( $sizes ) {
			$rows[] = array( __( 'Sizes', 'semera-folders' ), $sizes );
		}

		$rows[] = array(
			__( 'File URL', 'semera-folders' ),
			sprintf(
				'<span class="sf-preview-url"><input type="text" readonly value="%s" onfocus="this.select()" aria-label="%s" /><button type="button" class="button button-small" data-sf-copy>%s</button></span>',
				esc_attr( $url ),
				esc_attr__( 'File URL', 'semera-folders' ),
				esc_html__( 'Copy URL', 'semera-folders' )
			),
		);

		$info = '';
		foreach ( $rows as $row ) {
			$info .= sprintf( '<dt>%s</dt><dd>%s</dd>', esc_html( $row[0] ), $row[1] );
		}

		$edit    = get_edit_post_link( $id );
		$actions = '';
		if ( $edit ) {
			$actions .= sprintf( '<a class="button button-primary" href="%s">%s</a> ', esc_url( $edit ), esc_html__( 'Edit', 'semera-folders' ) );
		}
		$actions .= sprintf( '<a class="button" href="%s" target="_blank" rel="noopener">%s</a> ', esc_url( $url ), esc_html__( 'Open file', 'semera-folders' ) );
		$actions .= sprintf( '<a class="button" href="%s" download>%s</a>', esc_url( $url ), esc_html__( 'Download', 'semera-folders' ) );

		$html = sprintf(
			'<div class="sf-preview-media">%s</div><div class="sf-preview-side"><dl class="sf-preview-info">%s</dl><p class="sf-preview-actions">%s</p></div>',
			self::media( $id, $mime, $url, $alt ),
			$info,
			$actions
		);

		return array(
			'title' => wp_strip_all_tags( get_the_title( $id ) ),
			'html'  => $html,
		);
	}

	/** The large image, a player, the PDF viewer, or a file type badge. */
	private static function media( int $id, string $mime, string $url, string $alt ): string {
		if ( 0 === strpos( $mime, 'video/' ) ) {
			return sprintf( '<video class="sf-preview-player" controls preload="metadata" src="%s"></video>', esc_url( $url ) );
		}
		if ( 0 === strpos( $mime, 'audio/' ) ) {
			return sprintf( '<audio class="sf-preview-audio" controls preload="metadata" src="%s"></audio>', esc_url( $url ) );
		}

		// PDFs: the browser's own viewer, so every page can be scrolled. Browsers without one show the note.
		if ( 'application/pdf' === $mime ) {
			return sprintf(
				'<object class="sf-preview-pdf" type="application/pdf" data="%s"><p>%s</p></object>',
				esc_url( $url . '#navpanes=0&view=FitH' ),
				esc_html__( 'Your browser cannot show this PDF. Use "Open file" to view it.', 'semera-folders' )
			);
		}

		$image = wp_get_attachment_image( $id, 'large', false, array( 'class' => 'sf-preview-image', 'alt' => $alt ) );
		if ( $image ) {
			return $image;
		}
		if ( 0 === strpos( $mime, 'image/' ) ) {
			return sprintf( '<img class="sf-preview-image" src="%s" alt="%s" />', esc_url( $url ), esc_attr( $alt ) );
		}

		$file = get_attached_file( $id );
		$ext  = $file ? strtoupper( pathinfo( $file, PATHINFO_EXTENSION ) ) : '';
		return sprintf( '<span class="sf-preview-badge">%s</span>', esc_html( '' !== $ext ? $ext : '?' ) );
	}

	/** The generated sizes of an image as links, e.g. "Medium 300 × 200 px". */
	private static function sizes( int $id, array $meta ): string {
		if ( empty( $meta['sizes'] ) || ! is_array( $meta['sizes'] ) ) {
			return '';
		}
		$items = array();
		foreach ( $meta['sizes'] as $name => $size ) {
			$src = wp_get_attachment_image_url( $id, $name );
			if ( ! $src || empty( $size['width'] ) || empty( $size['height'] ) ) {
				continue;
			}
			$items[] = sprintf(
				'<li><a href="%s" target="_blank" rel="noopener">%s</a> <span>%d × %d px</span></li>',
				esc_url( $src ),
				esc_html( ucwords( str_replace( array( '-', '_' ), ' ', (string) $name ) ) ),
				$size['width'],
				$size['height']
			);
		}
		return $items ? '<ul class="sf-preview-sizes">' . implode( '', $items ) . '</ul>' : '';
	}
}
