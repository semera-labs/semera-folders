<?php
namespace Semera\Folders;

defined( 'ABSPATH' ) || exit;

/**
 * REST API used by the folder tree. Every mutation answers with a fresh
 * snapshot so the client never has to patch counts by hand.
 */
final class Rest {

	private const NAMESPACE = 'semera-folders/v1';

	public static function register_routes(): void {
		$permission = array( Folders::class, 'can_manage' );

		register_rest_route(
			self::NAMESPACE,
			'/folders',
			array(
				array(
					'methods'             => \WP_REST_Server::READABLE,
					'callback'            => array( self::class, 'index' ),
					'permission_callback' => $permission,
				),
				array(
					'methods'             => \WP_REST_Server::CREATABLE,
					'callback'            => array( self::class, 'create' ),
					'permission_callback' => $permission,
					'args'                => array(
						'name'   => array(
							'type'     => 'string',
							'required' => true,
						),
						'parent' => array(
							'type'    => 'integer',
							'default' => 0,
						),
					),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/folders/(?P<id>\d+)',
			array(
				array(
					'methods'             => \WP_REST_Server::EDITABLE,
					'callback'            => array( self::class, 'update' ),
					'permission_callback' => $permission,
					'args'                => array(
						'name'   => array( 'type' => 'string' ),
						'parent' => array( 'type' => 'integer' ),
					),
				),
				array(
					'methods'             => \WP_REST_Server::DELETABLE,
					'callback'            => array( self::class, 'delete' ),
					'permission_callback' => $permission,
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/preview/(?P<id>\d+)',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( self::class, 'preview' ),
				'permission_callback' => static function ( \WP_REST_Request $request ) {
					return current_user_can( 'edit_post', (int) $request['id'] );
				},
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/move',
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( self::class, 'move_files' ),
				'permission_callback' => $permission,
				'args'                => array(
					'ids'    => array(
						'type'     => 'array',
						'required' => true,
						'items'    => array( 'type' => 'integer' ),
					),
					'folder' => array(
						'type'     => 'integer',
						'required' => true,
					),
				),
			)
		);
	}

	public static function index(): \WP_REST_Response {
		return rest_ensure_response( array( 'snapshot' => Folders::snapshot() ) );
	}

	public static function create( \WP_REST_Request $request ) {
		$folder = Folders::create( (string) $request['name'], (int) $request['parent'] );
		if ( is_wp_error( $folder ) ) {
			return $folder;
		}
		return self::respond( array( 'folder' => $folder ), 201 );
	}

	public static function update( \WP_REST_Request $request ) {
		$id     = (int) $request['id'];
		$folder = null;

		if ( null !== $request->get_param( 'name' ) ) {
			$folder = Folders::rename( $id, (string) $request['name'] );
			if ( is_wp_error( $folder ) ) {
				return $folder;
			}
		}
		if ( null !== $request->get_param( 'parent' ) ) {
			$folder = Folders::move_folder( $id, (int) $request['parent'] );
			if ( is_wp_error( $folder ) ) {
				return $folder;
			}
		}
		if ( null === $folder ) {
			return new \WP_Error( 'semera_folders_nothing_to_do', __( 'Nothing to update.', 'semera-folders' ), array( 'status' => 400 ) );
		}
		return self::respond( array( 'folder' => $folder ) );
	}

	public static function delete( \WP_REST_Request $request ) {
		$result = Folders::delete( (int) $request['id'] );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return self::respond( array( 'deleted' => (int) $request['id'] ) );
	}

	public static function preview( \WP_REST_Request $request ) {
		$preview = Preview::render( (int) $request['id'] );
		return is_wp_error( $preview ) ? $preview : rest_ensure_response( $preview );
	}

	public static function move_files( \WP_REST_Request $request ) {
		$moved = Folders::assign( (array) $request['ids'], (int) $request['folder'] );
		if ( is_wp_error( $moved ) ) {
			return $moved;
		}
		return self::respond( array( 'moved' => $moved ) );
	}

	private static function respond( array $data, int $status = 200 ): \WP_REST_Response {
		$data['snapshot'] = Folders::snapshot();
		return new \WP_REST_Response( $data, $status );
	}
}
