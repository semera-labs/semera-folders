<?php
namespace Semera\Folders;

defined( 'ABSPATH' ) || exit;

/**
 * Folder data layer.
 *
 * Folders are terms of a hierarchical, non-public taxonomy on attachments.
 * Like in a file system, an attachment lives in at most one folder.
 */
final class Folders {

	public const TAXONOMY = 'semera_folder';

	/** Virtual folder key for files that are in no folder. */
	public const UNSORTED = 'unsorted';

	private const MAX_NAME_LENGTH = 100;

	public static function register_taxonomy(): void {
		register_taxonomy(
			self::TAXONOMY,
			'attachment',
			array(
				'labels'                => array(
					'name'          => 'Folders',
					'singular_name' => 'Folder',
				),
				'hierarchical'          => true,
				'public'                => false,
				'show_ui'               => false,
				'show_in_rest'          => false,
				'show_admin_column'     => false,
				'query_var'             => false,
				'rewrite'               => false,
				'update_count_callback' => '_update_generic_term_count',
			)
		);
	}

	public static function capability(): string {
		return (string) apply_filters( 'semera_folders_capability', 'upload_files' );
	}

	public static function can_manage(): bool {
		return current_user_can( self::capability() );
	}

	/**
	 * All folders as a flat list.
	 *
	 * @return array<int, array{id:int, name:string, parent:int}>
	 */
	public static function all(): array {
		$terms = get_terms(
			array(
				'taxonomy'   => self::TAXONOMY,
				'hide_empty' => false,
			)
		);
		if ( is_wp_error( $terms ) ) {
			return array();
		}

		$folders = array();
		foreach ( $terms as $term ) {
			$folders[] = self::to_array( $term );
		}
		return $folders;
	}

	private static function to_array( \WP_Term $term ): array {
		return array(
			'id'     => (int) $term->term_id,
			'name'   => wp_specialchars_decode( $term->name, ENT_QUOTES ),
			'parent' => (int) $term->parent,
		);
	}

	public static function find( int $id ): ?\WP_Term {
		if ( $id <= 0 ) {
			return null;
		}
		$term = get_term( $id, self::TAXONOMY );
		return ( $term instanceof \WP_Term ) ? $term : null;
	}

	/** Folders with the number of files directly inside each, which is all the UI needs. */
	public static function snapshot(): array {
		global $wpdb;

		$counts = array();
		$rows   = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT tt.term_id AS id, COUNT(DISTINCT p.ID) AS n
				FROM {$wpdb->term_relationships} tr
				INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
				INNER JOIN {$wpdb->posts} p ON p.ID = tr.object_id
				WHERE tt.taxonomy = %s AND p.post_type = 'attachment' AND p.post_status <> 'trash'
				GROUP BY tt.term_id",
				self::TAXONOMY
			)
		);
		foreach ( (array) $rows as $row ) {
			$counts[ (int) $row->id ] = (int) $row->n;
		}

		$folders = self::all();
		foreach ( $folders as &$folder ) {
			$folder['count'] = $counts[ $folder['id'] ] ?? 0;
		}
		unset( $folder );

		return array( 'folders' => $folders );
	}

	/* ---------------------------------------------------------------------
	 * Folder mutations
	 * ------------------------------------------------------------------ */

	/** @return array|\WP_Error The new folder. */
	public static function create( string $name, int $parent = 0 ) {
		$name = self::clean_name( $name );
		if ( is_wp_error( $name ) ) {
			return $name;
		}
		if ( $parent > 0 && ! self::find( $parent ) ) {
			return new \WP_Error( 'semera_folders_not_found', __( 'The parent folder does not exist.', 'semera-folders' ), array( 'status' => 404 ) );
		}
		if ( self::name_taken( $name, $parent ) ) {
			return self::duplicate_error( $name );
		}

		$result = wp_insert_term(
			$name,
			self::TAXONOMY,
			array(
				'parent' => $parent,
				'slug'   => self::unique_slug( $name ),
			)
		);
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return self::to_array( get_term( (int) $result['term_id'], self::TAXONOMY ) );
	}

	/** @return array|\WP_Error The updated folder. */
	public static function rename( int $id, string $name ) {
		$term = self::find( $id );
		if ( ! $term ) {
			return self::not_found();
		}
		$name = self::clean_name( $name );
		if ( is_wp_error( $name ) ) {
			return $name;
		}
		if ( self::name_taken( $name, (int) $term->parent, $id ) ) {
			return self::duplicate_error( $name );
		}

		$result = wp_update_term(
			$id,
			self::TAXONOMY,
			array(
				'name' => $name,
				'slug' => self::unique_slug( $name, $id ),
			)
		);
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return self::to_array( get_term( $id, self::TAXONOMY ) );
	}

	/** @return array|\WP_Error The updated folder. */
	public static function move_folder( int $id, int $parent ) {
		$term = self::find( $id );
		if ( ! $term ) {
			return self::not_found();
		}
		if ( $parent > 0 && ! self::find( $parent ) ) {
			return self::not_found();
		}
		if ( $parent === $id || ( $parent > 0 && in_array( $parent, self::descendant_ids( $id ), true ) ) ) {
			return new \WP_Error( 'semera_folders_cycle', __( 'A folder cannot be moved into itself.', 'semera-folders' ), array( 'status' => 400 ) );
		}

		$name = wp_specialchars_decode( $term->name, ENT_QUOTES );
		if ( $parent !== (int) $term->parent && self::name_taken( $name, $parent, $id ) ) {
			return self::duplicate_error( $name );
		}

		$result = wp_update_term( $id, self::TAXONOMY, array( 'parent' => $parent ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return self::to_array( get_term( $id, self::TAXONOMY ) );
	}

	/**
	 * Delete a folder. Files and subfolders are never deleted: they move up to
	 * the parent folder (or become unsorted / top level).
	 *
	 * @return true|\WP_Error
	 */
	public static function delete( int $id ) {
		$term = self::find( $id );
		if ( ! $term ) {
			return self::not_found();
		}
		$parent = (int) $term->parent;

		foreach ( self::children_of( $id ) as $child ) {
			$name = self::free_name( $child['name'], $parent, $child['id'] );
			wp_update_term(
				$child['id'],
				self::TAXONOMY,
				array(
					'parent' => $parent,
					'name'   => $name,
					'slug'   => self::unique_slug( $name, $child['id'] ),
				)
			);
		}

		$object_ids = get_objects_in_term( $id, self::TAXONOMY );
		if ( ! is_wp_error( $object_ids ) ) {
			foreach ( $object_ids as $object_id ) {
				if ( $parent > 0 ) {
					wp_set_object_terms( (int) $object_id, array( $parent ), self::TAXONOMY );
				} else {
					wp_delete_object_term_relationships( (int) $object_id, self::TAXONOMY );
				}
			}
		}

		$result = wp_delete_term( $id, self::TAXONOMY );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		if ( ! $result ) {
			return self::not_found();
		}
		return true;
	}

	/* ---------------------------------------------------------------------
	 * File assignment
	 * ------------------------------------------------------------------ */

	/**
	 * Put attachments into a folder (0 = no folder). Attachments the current
	 * user may not edit are skipped.
	 *
	 * @param int[] $attachment_ids
	 * @return int[]|\WP_Error IDs that were moved.
	 */
	public static function assign( array $attachment_ids, int $folder ) {
		if ( $folder > 0 && ! self::find( $folder ) ) {
			return self::not_found();
		}

		$moved = array();
		foreach ( array_unique( array_map( 'absint', $attachment_ids ) ) as $attachment_id ) {
			if ( ! $attachment_id || 'attachment' !== get_post_type( $attachment_id ) || ! current_user_can( 'edit_post', $attachment_id ) ) {
				continue;
			}
			if ( $folder > 0 ) {
				wp_set_object_terms( $attachment_id, array( $folder ), self::TAXONOMY );
			} else {
				wp_delete_object_term_relationships( $attachment_id, self::TAXONOMY );
			}
			$moved[] = $attachment_id;
		}
		return $moved;
	}

	public static function folder_of( int $attachment_id ): int {
		$terms = wp_get_object_terms( $attachment_id, self::TAXONOMY, array( 'fields' => 'ids' ) );
		return ( ! is_wp_error( $terms ) && $terms ) ? (int) $terms[0] : 0;
	}

	/* ---------------------------------------------------------------------
	 * Queries
	 * ------------------------------------------------------------------ */

	/**
	 * Parse a folder filter coming from the client ("unsorted" or a folder ID).
	 *
	 * @param mixed $value
	 * @return int|string|null Folder ID, self::UNSORTED, or null for "everything".
	 */
	public static function parse_filter( $value ) {
		if ( self::UNSORTED === $value ) {
			return self::UNSORTED;
		}
		if ( is_scalar( $value ) && ctype_digit( (string) $value ) ) {
			$id = (int) $value;
			return self::find( $id ) ? $id : null;
		}
		return null;
	}

	/**
	 * Add the folder filter to a tax_query array. Only the folder's direct
	 * content is shown, like in a file explorer.
	 *
	 * @param int|string|null $filter Result of parse_filter().
	 */
	public static function apply_to_tax_query( $existing, $filter ): array {
		$tax_query = is_array( $existing ) ? $existing : array();
		if ( null === $filter ) {
			return $tax_query;
		}

		if ( self::UNSORTED === $filter ) {
			$clause = array(
				'taxonomy' => self::TAXONOMY,
				'operator' => 'NOT EXISTS',
			);
		} else {
			$clause = array(
				'taxonomy'         => self::TAXONOMY,
				'field'            => 'term_id',
				'terms'            => array( $filter ),
				'include_children' => false,
			);
		}

		$tax_query[] = $clause;
		if ( count( $tax_query ) > 1 && empty( $tax_query['relation'] ) ) {
			$tax_query['relation'] = 'AND';
		}
		return $tax_query;
	}

	/* ---------------------------------------------------------------------
	 * Presentation helpers
	 * ------------------------------------------------------------------ */

	/** "Projects / 2024" style path, empty string for no folder. */
	public static function path( int $id ): string {
		$names = array();
		$byid  = array();
		foreach ( self::all() as $folder ) {
			$byid[ $folder['id'] ] = $folder;
		}
		$guard = 0;
		while ( $id > 0 && isset( $byid[ $id ] ) && $guard++ < 50 ) {
			array_unshift( $names, $byid[ $id ]['name'] );
			$id = $byid[ $id ]['parent'];
		}
		return implode( ' / ', $names );
	}

	/**
	 * Folders in tree order with their depth, for building indented <select>s.
	 *
	 * @return array<int, array{id:int, name:string, depth:int}>
	 */
	public static function flat_tree(): array {
		$by_parent = array();
		foreach ( self::all() as $folder ) {
			$by_parent[ $folder['parent'] ][] = $folder;
		}
		foreach ( $by_parent as &$siblings ) {
			usort(
				$siblings,
				static function ( $a, $b ) {
					return strnatcasecmp( $a['name'], $b['name'] );
				}
			);
		}
		unset( $siblings );

		$out  = array();
		$walk = static function ( int $parent, int $depth ) use ( &$walk, &$out, $by_parent ) {
			foreach ( $by_parent[ $parent ] ?? array() as $folder ) {
				$out[] = array(
					'id'    => $folder['id'],
					'name'  => $folder['name'],
					'depth' => $depth,
				);
				if ( $depth < 50 ) {
					$walk( $folder['id'], $depth + 1 );
				}
			}
		};
		$walk( 0, 0 );
		return $out;
	}

	/* ---------------------------------------------------------------------
	 * Internals
	 * ------------------------------------------------------------------ */

	/** @return string|\WP_Error */
	private static function clean_name( string $name ) {
		$name = trim( (string) preg_replace( '/\s+/u', ' ', wp_strip_all_tags( $name ) ) );
		if ( '' === $name ) {
			return new \WP_Error( 'semera_folders_empty_name', __( 'Please enter a folder name.', 'semera-folders' ), array( 'status' => 400 ) );
		}
		if ( mb_strlen( $name ) > self::MAX_NAME_LENGTH ) {
			return new \WP_Error( 'semera_folders_name_too_long', __( 'The folder name is too long.', 'semera-folders' ), array( 'status' => 400 ) );
		}
		return $name;
	}

	/** @return int[] */
	private static function descendant_ids( int $id ): array {
		$children = get_term_children( $id, self::TAXONOMY );
		return is_wp_error( $children ) ? array() : array_map( 'intval', $children );
	}

	private static function children_of( int $parent ): array {
		return array_values(
			array_filter(
				self::all(),
				static function ( $folder ) use ( $parent ) {
					return $folder['parent'] === $parent;
				}
			)
		);
	}

	private static function name_taken( string $name, int $parent, int $exclude = 0 ): bool {
		$needle = mb_strtolower( $name );
		foreach ( self::children_of( $parent ) as $sibling ) {
			if ( $sibling['id'] !== $exclude && mb_strtolower( $sibling['name'] ) === $needle ) {
				return true;
			}
		}
		return false;
	}

	/** "Name", then "Name (2)", "Name (3)" ... until it is free under $parent. */
	private static function free_name( string $name, int $parent, int $exclude = 0 ): string {
		$candidate = $name;
		for ( $i = 2; self::name_taken( $candidate, $parent, $exclude ); $i++ ) {
			$candidate = sprintf( '%s (%d)', $name, $i );
		}
		return $candidate;
	}

	/** Slugs are never shown; they only have to be unique across the taxonomy. */
	private static function unique_slug( string $name, int $exclude = 0 ): string {
		$base = sanitize_title( $name );
		if ( '' === $base ) {
			$base = 'folder';
		}
		$slug = $base;
		for ( $i = 2; ; $i++ ) {
			$existing = get_term_by( 'slug', $slug, self::TAXONOMY );
			if ( ! $existing || (int) $existing->term_id === $exclude ) {
				return $slug;
			}
			$slug = $base . '-' . $i;
		}
	}

	private static function not_found(): \WP_Error {
		return new \WP_Error( 'semera_folders_not_found', __( 'The folder does not exist.', 'semera-folders' ), array( 'status' => 404 ) );
	}

	private static function duplicate_error( string $name ): \WP_Error {
		return new \WP_Error(
			'semera_folders_duplicate',
			/* translators: %s: folder name */
			sprintf( __( 'A folder named "%s" already exists here.', 'semera-folders' ), $name ),
			array( 'status' => 409 )
		);
	}
}
