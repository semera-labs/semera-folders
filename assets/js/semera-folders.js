/**
 * Semera Folders – Explorer-style folders for the WordPress media library.
 *
 * One file, no build step. The open folder shows its subfolders next to its
 * files: as rows in the list view, as tiles in the grid view and in the media
 * modal. A "New folder" button (list) or tile (grid, modal) creates folders.
 *
 *   1. helpers            6. drag and drop        10. wp.media (grid + modal)
 *   2. store + actions    7. file drag sources    11. boot
 *   3. toast              8. folder bar
 *   4. icons              9. library list view
 *   5. context menu
 */
( function ( window, document ) {
	'use strict';

	const cfg = window.SemeraFoldersData || {};
	const S = cfg.strings || {};
	const wp = window.wp || {};

	/** Key of the top level of the library (no folder). */
	const ROOT = 'root';
	/** Value the server understands for "files that are in no folder". */
	const NO_FOLDER = 'unsorted';

	/* ------------------------------------------------------------------
	 * 1. helpers
	 * ---------------------------------------------------------------- */

	const storage = {
		get( key, fallback ) {
			try {
				const raw = window.localStorage.getItem( 'semera-folders:' + key );
				return null === raw ? fallback : JSON.parse( raw );
			} catch ( e ) {
				return fallback;
			}
		},
		set( key, value ) {
			try {
				window.localStorage.setItem( 'semera-folders:' + key, JSON.stringify( value ) );
			} catch ( e ) {}
		},
	};

	const collator = new Intl.Collator( undefined, { numeric: true, sensitivity: 'base' } );

	/** Minimal sprintf for %s, %d and %1$s style placeholders. */
	const fmt = ( template, ...args ) => {
		let next = 0;
		return String( template ).replace( /%(?:(\d+)\$)?[sd]/g, ( match, pos ) => String( args[ pos ? pos - 1 : next++ ] ) );
	};

	const clamp = ( value, min, max ) => Math.min( max, Math.max( min, value ) );

	const debounce = ( fn, wait ) => {
		let timer;
		return ( ...args ) => {
			window.clearTimeout( timer );
			timer = window.setTimeout( () => fn( ...args ), wait );
		};
	};

	const el = ( tag, attrs = {}, children = [] ) => {
		const node = document.createElement( tag );
		for ( const [ name, value ] of Object.entries( attrs ) ) {
			if ( false === value || null === value || undefined === value ) {
				continue;
			}
			if ( 'class' === name ) {
				node.className = value;
			} else if ( 'text' === name ) {
				node.textContent = value;
			} else {
				node.setAttribute( name, true === value ? '' : value );
			}
		}
		for ( const child of [].concat( children ) ) {
			if ( child ) {
				node.append( child );
			}
		}
		return node;
	};

	const parseKey = ( key ) => ( ROOT === key ? ROOT : Number( key ) );

	/** Address of the list view for a folder (the list is rendered by the server). */
	const listUrl = ( key ) => {
		const url = new URL( window.location.href );
		url.searchParams.delete( 'paged' );
		[ 's', 'm', 'detached', 'attachment-filter', 'post_mime_type' ].forEach( ( name ) => url.searchParams.delete( name ) );
		if ( ROOT === key ) {
			url.searchParams.delete( 'sf_folder' );
		} else {
			url.searchParams.set( 'sf_folder', key );
		}
		return url.toString();
	};

	const itemsText = ( count ) => ( 1 === count ? S.itemsOne : fmt( S.itemsMany, count ) );

	/* ------------------------------------------------------------------
	 * 2. store + actions
	 * ---------------------------------------------------------------- */

	const request = ( method, path, data ) => wp.apiFetch( { path: '/semera-folders/v1' + path, method, data } );

	const store = {
		folders: [],
		loaded: false,
		loading: null,
		error: false,
		selected: ROOT,
		/** ID of the folder being renamed in place. */
		renaming: null,
		listeners: new Set(),
		map: new Map(),
		kids: new Map(),

		subscribe( fn ) {
			this.listeners.add( fn );
			return () => this.listeners.delete( fn );
		},

		emit( type, payload ) {
			this.listeners.forEach( ( fn ) => fn( type, payload ) );
		},

		apply( snapshot ) {
			this.folders = snapshot.folders || [];
			this.loaded = true;
			this.error = false;

			this.map = new Map( this.folders.map( ( f ) => [ f.id, f ] ) );
			this.kids = new Map();
			for ( const folder of this.folders ) {
				const parent = this.map.has( folder.parent ) ? folder.parent : 0;
				if ( ! this.kids.has( parent ) ) {
					this.kids.set( parent, [] );
				}
				this.kids.get( parent ).push( folder );
			}
			this.kids.forEach( ( list ) => list.sort( ( a, b ) => collator.compare( a.name, b.name ) ) );

			if ( 'number' === typeof this.selected && ! this.map.has( this.selected ) ) {
				this.select( ROOT );
			}
			this.emit( 'data' );
		},

		load() {
			if ( this.loading ) {
				return this.loading;
			}
			this.loading = request( 'GET', '/folders' )
				.then( ( res ) => this.apply( res.snapshot ) )
				.catch( () => {
					this.error = true;
					toast( S.loadError, 'error' );
				} )
				.finally( () => {
					this.loading = null;
				} );
			return this.loading;
		},

		refreshSoon: null,

		select( key ) {
			this.selected = key;
			if ( cfg.onLibrary && ! ListMode.active ) {
				storage.set( 'selected', key );
			}
			this.emit( 'select', key );
		},

		children( parent ) {
			return this.kids.get( parent ) || [];
		},

		/** Folders from the top level down to (and including) the folder. */
		chain( id ) {
			const out = [];
			for ( let cur = this.map.get( id ), guard = 0; cur && guard < 50; cur = this.map.get( cur.parent ), guard++ ) {
				out.unshift( cur );
			}
			return out;
		},

		isDescendant( id, ancestor ) {
			for ( let cur = this.map.get( id ), guard = 0; cur && guard < 50; cur = this.map.get( cur.parent ), guard++ ) {
				if ( cur.parent === ancestor ) {
					return true;
				}
			}
			return false;
		},

		/** Folders in tree order with depth, for <select> options. */
		flat() {
			const out = [];
			const walk = ( parent, depth ) => {
				for ( const folder of this.children( parent ) ) {
					out.push( { folder, depth } );
					if ( depth < 50 ) {
						walk( folder.id, depth + 1 );
					}
				}
			};
			walk( 0, 0 );
			return out;
		},

		uniqueName( base, parent ) {
			const taken = new Set( this.children( parent ).map( ( f ) => f.name.toLowerCase() ) );
			let name = base;
			for ( let i = 2; taken.has( name.toLowerCase() ); i++ ) {
				name = fmt( '%s (%d)', base, i );
			}
			return name;
		},

		labelOf( key ) {
			const folder = this.map.get( key );
			return folder ? folder.name : S.root;
		},
	};
	store.refreshSoon = debounce( () => store.load(), 500 );

	/** Wraps an API call: applies the returned snapshot, toasts failures. */
	const call = async ( method, path, data ) => {
		try {
			const res = await request( method, path, data );
			if ( res.snapshot ) {
				store.apply( res.snapshot );
			}
			return res;
		} catch ( err ) {
			toast( ( err && err.message ) || S.genericError, 'error' );
			return null;
		}
	};

	/** Open a folder: the list view reloads the page, wp.media views re-query. */
	const navigate = ( key ) => {
		if ( ListMode.active ) {
			window.location.href = listUrl( key );
		} else {
			store.select( key );
		}
	};

	const actions = {
		/** Create a folder and let the user name it in place, like Explorer. */
		async create( parent ) {
			const res = await call( 'POST', '/folders', { name: store.uniqueName( S.newFolder, parent ), parent } );
			if ( ! res ) {
				return;
			}
			store.renaming = res.folder.id;
			store.emit( 'rename' );
		},
		async rename( id, name ) {
			return call( 'POST', '/folders/' + id, { name } );
		},
		async moveFolder( id, parent ) {
			const res = await call( 'POST', '/folders/' + id, { parent } );
			if ( res ) {
				toast( S.movedFolder );
			}
			return res;
		},
		async remove( id ) {
			const folder = store.map.get( id );
			const parent = folder && folder.parent ? folder.parent : ROOT;
			const open = store.selected;
			if ( ! ( await call( 'DELETE', '/folders/' + id ) ) ) {
				return;
			}
			if ( open === id ) {
				navigate( parent );
			} else if ( open === parent ) {
				// Its files just landed in the open folder.
				store.emit( 'refresh' );
			}
		},
		async moveFiles( ids, key ) {
			const res = await call( 'POST', '/move', { ids, folder: ROOT === key ? 0 : key } );
			if ( ! res ) {
				return;
			}
			const label = store.labelOf( key );
			toast( 1 === res.moved.length ? fmt( S.movedOne, label ) : fmt( S.movedMany, res.moved.length, label ) );
			store.emit( 'moved', { ids: res.moved, target: key } );
		},
	};

	/* ------------------------------------------------------------------
	 * 3. toast
	 * ---------------------------------------------------------------- */

	let toastNode = null;
	let toastTimer = 0;

	function toast( message, type = 'info', duration = 0 ) {
		if ( ! message ) {
			return;
		}
		if ( ! toastNode ) {
			toastNode = el( 'div', { class: 'sf-toast', role: 'status', 'aria-live': 'polite' } );
			document.body.append( toastNode );
		}
		toastNode.textContent = message;
		toastNode.dataset.type = type;
		toastNode.classList.add( 'is-visible' );
		window.clearTimeout( toastTimer );
		const time = duration || ( 'error' === type ? 5000 : 2600 );
		// A negative duration keeps the message until the next one replaces it.
		if ( time > 0 && duration >= 0 ) {
			toastTimer = window.setTimeout( () => toastNode.classList.remove( 'is-visible' ), time );
		}
	}

	/* ------------------------------------------------------------------
	 * 4. icons
	 * ---------------------------------------------------------------- */

	const ICONS = {
		folder:
			'<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path class="sf-fill" d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4l1.6 1.8h7.4A1.5 1.5 0 0 1 18 7.3v7.2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z"/></svg>',
		up: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 16V5M5.5 9.5L10 5l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
		plus: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
	};

	const icon = ( name, cls = '' ) => {
		const span = el( 'span', { class: ( 'sf-icon ' + cls ).trim(), 'aria-hidden': 'true' } );
		span.innerHTML = ICONS[ name ]; // Static strings defined above.
		return span;
	};

	/* ------------------------------------------------------------------
	 * 5. context menu
	 * ---------------------------------------------------------------- */

	let openMenu = null;

	function closeMenu( restoreFocus = true ) {
		if ( ! openMenu ) {
			return;
		}
		const { node, returnTo, cleanup } = openMenu;
		openMenu = null;
		cleanup();
		node.remove();
		if ( restoreFocus && returnTo && returnTo.isConnected ) {
			returnTo.focus( { preventScroll: true } );
		}
	}

	/** @param {Array<{label?:string, run?:Function, separator?:boolean, danger?:boolean}>} items */
	function showMenu( x, y, items, returnTo ) {
		closeMenu( false );

		const node = el( 'div', { class: 'sf-menu', role: 'menu' } );
		const buttons = [];
		for ( const item of items ) {
			if ( item.separator ) {
				node.append( el( 'div', { class: 'sf-menu-sep', role: 'separator' } ) );
				continue;
			}
			const button = el( 'button', { type: 'button', role: 'menuitem', class: item.danger ? 'is-danger' : '', tabindex: '-1', text: item.label } );
			button.addEventListener( 'click', () => {
				closeMenu( false );
				item.run();
			} );
			buttons.push( button );
			node.append( button );
		}
		document.body.append( node );

		const rect = node.getBoundingClientRect();
		node.style.left = clamp( x, 4, window.innerWidth - rect.width - 4 ) + 'px';
		node.style.top = clamp( y, 4, window.innerHeight - rect.height - 4 ) + 'px';

		const onPointerDown = ( e ) => {
			if ( ! node.contains( e.target ) ) {
				closeMenu( false );
			}
		};
		const onKey = ( e ) => {
			const index = buttons.indexOf( document.activeElement );
			if ( 'Escape' === e.key ) {
				closeMenu();
			} else if ( 'ArrowDown' === e.key ) {
				buttons[ ( index + 1 ) % buttons.length ].focus();
			} else if ( 'ArrowUp' === e.key ) {
				buttons[ ( index - 1 + buttons.length ) % buttons.length ].focus();
			} else if ( 'Tab' === e.key ) {
				closeMenu();
				return;
			} else {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
		};
		const onDismiss = () => closeMenu( false );

		document.addEventListener( 'pointerdown', onPointerDown, true );
		document.addEventListener( 'keydown', onKey, true );
		window.addEventListener( 'blur', onDismiss );
		window.addEventListener( 'resize', onDismiss );
		document.addEventListener( 'scroll', onDismiss, true );

		openMenu = {
			node,
			returnTo,
			cleanup() {
				document.removeEventListener( 'pointerdown', onPointerDown, true );
				document.removeEventListener( 'keydown', onKey, true );
				window.removeEventListener( 'blur', onDismiss );
				window.removeEventListener( 'resize', onDismiss );
				document.removeEventListener( 'scroll', onDismiss, true );
			},
		};
		if ( buttons[ 0 ] ) {
			buttons[ 0 ].focus();
		}
	}

	/* -- what a folder offers (rows, tiles) ------------------------------ */

	function confirmDelete( id ) {
		const folder = store.map.get( id );
		if ( folder && window.confirm( fmt( S.confirmDelete, folder.name ) ) ) {
			actions.remove( id );
		}
	}

	function folderMenu( id, open ) {
		return [
			{ label: S.open, run: open },
			{ separator: true },
			{ label: S.newSubfolder, run: () => actions.create( id ) },
			{ label: S.rename, run: () => {
				store.renaming = id;
				store.emit( 'rename' );
			} },
			{ label: S.delete, danger: true, run: () => confirmDelete( id ) },
		];
	}

	/** Keyboard shortcuts of a focused folder row or tile. Returns true if handled. */
	function folderKey( e, id, open, anchor ) {
		switch ( e.key ) {
			case 'Enter':
				open();
				break;
			case 'F2':
				store.renaming = id;
				store.emit( 'rename' );
				break;
			case 'Delete':
				confirmDelete( id );
				break;
			case 'ContextMenu':
			case 'F10': {
				if ( 'F10' === e.key && ! e.shiftKey ) {
					return false;
				}
				const rect = anchor.getBoundingClientRect();
				showMenu( rect.left + 24, rect.bottom, folderMenu( id, open ), anchor );
				break;
			}
			default:
				return false;
		}
		e.preventDefault();
		e.stopPropagation();
		return true;
	}

	/** Input that renames a folder in place; used inside rows and tiles. */
	function renameInput( folder ) {
		const input = el( 'input', { type: 'text', class: 'sf-rename', value: folder.name, maxlength: '100', 'aria-label': S.rename, autocomplete: 'off' } );
		let done = false;
		const finish = async ( save ) => {
			if ( done ) {
				return;
			}
			done = true;
			const value = input.value.trim();
			store.renaming = null;
			if ( save && value && value !== folder.name ) {
				await actions.rename( folder.id, value );
			}
			store.emit( 'rename' );
		};
		input.addEventListener( 'keydown', ( e ) => {
			e.stopPropagation(); // Keep Escape from closing the media modal.
			if ( 'Enter' === e.key ) {
				e.preventDefault();
				finish( true );
			} else if ( 'Escape' === e.key ) {
				e.preventDefault();
				finish( false );
			}
		} );
		input.addEventListener( 'blur', () => finish( true ) );
		return input;
	}

	function focusRenameInput( container ) {
		const input = null !== store.renaming && container.querySelector( '.sf-rename' );
		if ( input ) {
			input.focus();
			input.select();
		}
	}

	/* ------------------------------------------------------------------
	 * 6. drag and drop
	 * ---------------------------------------------------------------- */

	/** What is being dragged right now: { type: 'files', ids } | { type: 'folder', id } | null. */
	let drag = null;

	/** Start an internal drag (files or a folder). The class hides core's "Drop files to upload" overlay. */
	function beginDrag( value ) {
		drag = value;
		document.documentElement.classList.add( 'sf-dragging' );
	}

	/** Core hides its overlay a moment after a drop; keep ours in place until it is gone. */
	const endDragMarker = () => window.setTimeout( () => document.documentElement.classList.remove( 'sf-dragging' ), 500 );

	const ghost = ( text ) => {
		const node = el( 'div', { class: 'sf-ghost', text } );
		document.body.append( node );
		window.setTimeout( () => node.remove(), 0 );
		return node;
	};

	function canDrop( key ) {
		if ( ! drag ) {
			return false;
		}
		if ( 'files' === drag.type ) {
			return ROOT === key || 'number' === typeof key;
		}
		const folder = store.map.get( drag.id );
		if ( ! folder ) {
			return false;
		}
		if ( ROOT === key ) {
			return 0 !== folder.parent;
		}
		return 'number' === typeof key && key !== drag.id && key !== folder.parent && ! store.isDescendant( key, drag.id );
	}

	document.addEventListener( 'dragend', () => {
		drag = null;
		endDragMarker();
		document.querySelectorAll( '.sf-drop' ).forEach( ( node ) => node.classList.remove( 'sf-drop' ) );
	} );
	document.addEventListener( 'drop', () => {
		endDragMarker();
		window.setTimeout( () => {
			drag = null;
		}, 0 );
	} );

	/**
	 * Rows and tiles that stand for a folder (`data-key`): they
	 * receive files and folders, and rows/tiles with `draggable` can be dragged.
	 */
	function bindFolderDnD( container, itemSelector ) {
		let hovered = null;
		const clear = () => {
			if ( hovered ) {
				hovered.classList.remove( 'sf-drop' );
				hovered = null;
			}
		};

		container.addEventListener( 'dragstart', ( e ) => {
			const item = e.target.closest && e.target.closest( itemSelector );
			if ( ! item ) {
				return;
			}
			const key = parseKey( item.dataset.key );
			if ( item.hasAttribute( 'data-sf-up' ) || 'number' !== typeof key ) {
				e.preventDefault();
				return;
			}
			beginDrag( { type: 'folder', id: key } );
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData( 'text/plain', store.labelOf( key ) );
			e.dataTransfer.setDragImage( ghost( fmt( S.moveFolder, store.labelOf( key ) ) ), 12, 12 );
		} );

		container.addEventListener( 'dragover', ( e ) => {
			const item = e.target.closest && e.target.closest( itemSelector );
			if ( ! item || ! canDrop( parseKey( item.dataset.key ) ) ) {
				clear();
				return;
			}
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
			if ( hovered !== item ) {
				clear();
				hovered = item;
				item.classList.add( 'sf-drop' );
			}
		} );

		container.addEventListener( 'dragleave', ( e ) => {
			if ( hovered && ! hovered.contains( e.relatedTarget ) ) {
				clear();
			}
		} );

		container.addEventListener( 'drop', async ( e ) => {
			const item = e.target.closest && e.target.closest( itemSelector );
			clear();
			if ( ! item ) {
				return;
			}
			const key = parseKey( item.dataset.key );
			if ( ! canDrop( key ) ) {
				return;
			}
			e.preventDefault();
			const dropped = drag;
			drag = null;
			if ( 'files' === dropped.type ) {
				await actions.moveFiles( dropped.ids, key );
			} else {
				await actions.moveFolder( dropped.id, ROOT === key ? 0 : key );
			}
		} );
	}

	/* ------------------------------------------------------------------
	 * 7. file drag sources (grid items, list table rows)
	 * ---------------------------------------------------------------- */

	function dragIdsFor( target ) {
		if ( ! target.closest ) {
			return null;
		}
		const item = target.closest( '.attachments-browser li.attachment[data-id]' );
		if ( item ) {
			const selected = [ ...item.parentElement.querySelectorAll( 'li.attachment.selected[data-id]' ) ].map( ( node ) => Number( node.dataset.id ) );
			const id = Number( item.dataset.id );
			return selected.includes( id ) ? selected : [ id ];
		}
		const row = target.closest( 'table.wp-list-table.media tbody tr[id^="post-"]' );
		if ( row ) {
			const id = Number( row.id.replace( 'post-', '' ) );
			const checked = [ ...row.closest( 'tbody' ).querySelectorAll( 'input[name="media[]"]:checked' ) ].map( ( node ) => Number( node.value ) );
			return checked.includes( id ) ? checked : [ id ];
		}
		return null;
	}

	document.addEventListener( 'dragstart', ( e ) => {
		if ( drag || ! e.dataTransfer ) {
			return;
		}
		const ids = dragIdsFor( e.target );
		if ( ! ids || ! ids.length ) {
			return;
		}
		beginDrag( { type: 'files', ids } );
		const text = fmt( 1 === ids.length ? S.moveOne : S.moveMany, ids.length );
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData( 'text/plain', text );
		e.dataTransfer.setDragImage( ghost( text ), 12, 12 );
	} );

	/** Make grid items draggable as they are rendered by Backbone. */
	function watchAttachments() {
		const mark = ( root ) => {
			if ( root.nodeType !== 1 ) {
				return;
			}
			const items = root.matches( 'li.attachment' ) ? [ root ] : [];
			items.push( ...root.querySelectorAll( 'li.attachment' ) );
			for ( const item of items ) {
				if ( item.closest( '.attachments-browser' ) && ! item.classList.contains( 'sf-foldertile' ) && ! item.classList.contains( 'sf-foldertile-new' ) && ! item.hasAttribute( 'draggable' ) ) {
					item.setAttribute( 'draggable', 'true' );
				}
			}
		};
		new MutationObserver( ( records ) => records.forEach( ( record ) => record.addedNodes.forEach( mark ) ) ).observe( document.body, { childList: true, subtree: true } );
		mark( document.body );
	}

	/* ------------------------------------------------------------------
	 * 8. "New folder" button
	 * ---------------------------------------------------------------- */

	function newFolderButton() {
		const button = el( 'button', { type: 'button', class: 'sf-newfolder button', title: S.newFolder } );
		button.append( icon( 'plus' ), el( 'span', { text: S.newFolder } ) );
		return button;
	}

	/** A new folder goes into the open folder. */
	const createHere = () => actions.create( 'number' === typeof store.selected ? store.selected : 0 );

	/** The "up" entry and the subfolders of the open folder. Nothing in search results. */
	function folderEntries( flat ) {
		if ( ! store.loaded || flat ) {
			return [];
		}
		const parent = 'number' === typeof store.selected ? store.selected : 0;
		const entries = [];
		if ( parent ) {
			const current = store.map.get( parent );
			entries.push( { up: true, key: current && current.parent ? current.parent : ROOT, label: S.up } );
		}
		for ( const folder of store.children( parent ) ) {
			entries.push( { key: folder.id, label: folder.name, count: folder.count + store.children( folder.id ).length } );
		}
		return entries;
	}

	/* ------------------------------------------------------------------
	 * 9a. file preview popup of the list view
	 *
	 * The dialog and its content are rendered by PHP; this only fetches the
	 * content (ahead of time, on hover), fills it in and steps through files.
	 * ---------------------------------------------------------------- */

	const Preview = {
		cache: new Map(),
		dialog: null,
		rows: [],
		index: -1,
		token: 0,

		init() {
			this.dialog = document.querySelector( 'dialog.sf-preview' );
			if ( ! this.dialog ) {
				return;
			}
			const d = this.dialog;
			this.title = d.querySelector( '.sf-preview-title' );
			this.body = d.querySelector( '.sf-preview-body' );
			this.prev = d.querySelector( '.sf-preview-prev' );
			this.next = d.querySelector( '.sf-preview-next' );

			d.querySelector( '.sf-preview-close' ).addEventListener( 'click', () => this.close() );
			this.prev.addEventListener( 'click', () => this.step( -1 ) );
			this.next.addEventListener( 'click', () => this.step( 1 ) );
			// A click on the backdrop (the dialog element itself, outside its frame) closes it.
			d.addEventListener( 'click', ( e ) => e.target === d && this.close() );
			// Escape: `cancel` comes first and synchronously; `close` covers everything else.
			d.addEventListener( 'cancel', () => this.unlock() );
			d.addEventListener( 'close', () => this.unlock() );
			d.addEventListener( 'keydown', ( e ) => {
				if ( e.target.matches && e.target.matches( 'input, textarea, select' ) ) {
					return;
				}
				if ( 'ArrowLeft' === e.key || 'ArrowRight' === e.key ) {
					e.preventDefault();
					this.step( 'ArrowLeft' === e.key ? -1 : 1 );
				}
			} );
			this.body.addEventListener( 'click', ( e ) => {
				if ( e.target.closest( '[data-sf-copy]' ) ) {
					this.copyUrl();
					return;
				}
				const attach = e.target.closest( '[data-sf-attach]' );
				if ( attach && window.findPosts ) {
					// Core's "attach to post" dialog would open behind this one, so close the popup first.
					e.preventDefault();
					this.close();
					window.findPosts.open( 'media[]', attach.dataset.sfAttach );
				}
			} );

			// Moving files or renaming folders changes what the popup shows.
			store.subscribe( ( type ) => ( 'data' === type || 'moved' === type ) && this.cache.clear() );
		},

		available() {
			return !! this.dialog;
		},

		close() {
			this.dialog.close();
			this.unlock();
		},

		/** Let the page scroll again. */
		unlock() {
			document.documentElement.classList.remove( 'sf-preview-open' );
		},

		/** Ask the server for the content of a file; cached, and shared by hover prefetch and opening. */
		fetch( id ) {
			if ( ! this.cache.has( id ) ) {
				const promise = request( 'GET', '/preview/' + id );
				promise.catch( () => this.cache.delete( id ) );
				this.cache.set( id, promise );
			}
			return this.cache.get( id );
		},

		/** @param {Element} row A file row of the list table. */
		open( row ) {
			this.rows = ListMode.fileRows();
			this.index = this.rows.indexOf( row );
			if ( this.index < 0 ) {
				return;
			}
			if ( ! this.dialog.open ) {
				document.documentElement.classList.add( 'sf-preview-open' );
				this.dialog.showModal();
			}
			this.show();
		},

		step( delta ) {
			const index = this.index + delta;
			if ( index >= 0 && index < this.rows.length ) {
				this.index = index;
				this.show();
			}
		},

		async show() {
			const row = this.rows[ this.index ];
			const id = Number( row.id.replace( 'post-', '' ) );
			const token = ++this.token;
			this.prev.disabled = 0 === this.index;
			this.next.disabled = this.index === this.rows.length - 1;

			const pending = this.fetch( id );
			// Only show a loading state if the server takes a moment, so cached files switch without a flicker.
			let settled = false;
			pending.then( () => ( settled = true ), () => ( settled = true ) );
			window.setTimeout( () => {
				if ( ! settled && token === this.token ) {
					this.body.textContent = S.loading;
				}
			}, 120 );

			try {
				const { title, html } = await pending;
				if ( token !== this.token ) {
					return;
				}
				this.title.textContent = title;
				this.body.innerHTML = html; // Rendered and escaped by PHP.
				this.body.scrollTop = 0;
				[ this.index - 1, this.index + 1 ].forEach( ( i ) => this.rows[ i ] && this.fetch( Number( this.rows[ i ].id.replace( 'post-', '' ) ) ).catch( () => {} ) );
			} catch ( err ) {
				if ( token === this.token ) {
					this.title.textContent = '';
					this.body.textContent = ( err && err.message ) || S.previewError;
				}
			}
		},

		async copyUrl() {
			const input = this.body.querySelector( '.sf-preview-url input' );
			if ( ! input ) {
				return;
			}
			try {
				await window.navigator.clipboard.writeText( input.value );
			} catch ( e ) {
				input.select();
				document.execCommand( 'copy' );
			}
			toast( S.copied );
		},
	};

	/* ------------------------------------------------------------------
	 * 9b. drag and drop upload in the list view
	 *
	 * Core only has an uploader in the grid view. Here files dropped from the
	 * desktop are posted to async-upload.php, into the open folder or into the
	 * folder row they were dropped on.
	 * ---------------------------------------------------------------- */

	const Uploader = {
		depth: 0,
		busy: false,

		init() {
			if ( ! cfg.upload || ! window.FormData ) {
				return;
			}
			this.zone = el( 'div', { class: 'sf-dropzone', hidden: true }, [ el( 'span', { text: S.dropToUpload } ) ] );
			document.body.append( this.zone );

			// Only files from outside the page: our own drags (files, folders) never show the overlay.
			const external = ( e ) => ! drag && e.dataTransfer && [ ...e.dataTransfer.types ].includes( 'Files' );

			document.addEventListener( 'dragenter', ( e ) => {
				if ( external( e ) ) {
					this.depth++;
					this.zone.hidden = false;
				}
			} );
			document.addEventListener( 'dragover', ( e ) => {
				if ( ! external( e ) ) {
					return;
				}
				e.preventDefault();
				e.dataTransfer.dropEffect = 'copy';
				this.target( e );
			} );
			document.addEventListener( 'dragleave', ( e ) => {
				if ( external( e ) && --this.depth <= 0 ) {
					this.reset();
				}
			} );
			document.addEventListener( 'drop', ( e ) => {
				if ( ! external( e ) ) {
					return;
				}
				e.preventDefault();
				const folder = this.folderAt( e.target );
				this.reset();
				this.upload( [ ...e.dataTransfer.files ], folder );
			} );
		},

		reset() {
			this.depth = 0;
			this.zone.hidden = true;
			document.querySelectorAll( 'tr.sf-folder-row.sf-drop' ).forEach( ( row ) => row.classList.remove( 'sf-drop' ) );
		},

		/** Folder row under the pointer (or the open folder). Returns a folder ID or 0 for the top level. */
		folderAt( target ) {
			const row = target.closest && target.closest( 'tr.sf-folder-row' );
			if ( row ) {
				const key = parseKey( row.dataset.key );
				return 'number' === typeof key ? key : 0;
			}
			return 'number' === typeof store.selected ? store.selected : 0;
		},

		/** Highlight the folder row a file would land in. */
		target( e ) {
			const row = e.target.closest && e.target.closest( 'tr.sf-folder-row' );
			document.querySelectorAll( 'tr.sf-folder-row.sf-drop' ).forEach( ( other ) => other !== row && other.classList.remove( 'sf-drop' ) );
			row && row.classList.add( 'sf-drop' );
		},

		async upload( files, folder ) {
			if ( this.busy || ! files.length ) {
				return;
			}
			this.busy = true;
			let done = 0;
			const errors = [];

			for ( const file of files ) {
				toast( fmt( S.uploadingN, done + errors.length + 1, files.length ), 'info', -1 );
				if ( cfg.upload.max && file.size > cfg.upload.max ) {
					errors.push( fmt( S.tooLarge, file.name ) );
					continue;
				}
				const body = new FormData();
				body.append( 'name', file.name );
				body.append( 'action', 'upload-attachment' );
				body.append( '_wpnonce', cfg.upload.nonce );
				if ( folder ) {
					body.append( 'sf_folder', folder );
				}
				body.append( 'async-upload', file, file.name );

				try {
					const res = await window.fetch( cfg.upload.url, { method: 'POST', body, credentials: 'same-origin' } );
					const json = await res.json();
					if ( json && json.success ) {
						done++;
					} else {
						errors.push( fmt( S.uploadFailed, file.name, ( json && json.data && json.data.message ) || S.genericError ) );
					}
				} catch ( err ) {
					errors.push( fmt( S.uploadFailed, file.name, S.genericError ) );
				}
			}

			this.busy = false;
			if ( errors.length ) {
				toast( errors.join( ' ' ), 'error', 7000 );
			}
			if ( done ) {
				// The list is rendered by the server: reload it to show the new files.
				window.setTimeout( () => window.location.reload(), errors.length ? 2500 : 300 );
			}
		},
	};

	/* ------------------------------------------------------------------
	 * 9. library list view (details list)
	 * ---------------------------------------------------------------- */

	const ListMode = {
		active: false,
		anchor: null,

		init() {
			const table = document.querySelector( 'table.wp-list-table.media' );
			const form = table && table.closest( 'form' );
			if ( ! form ) {
				return false;
			}
			this.active = true;
			this.table = table;

			// The server renders the button and the folder rows; build them only if it could not.
			let button = document.querySelector( '.tablenav.top .sf-newfolder' );
			if ( ! button ) {
				button = newFolderButton();
				const anchor = document.querySelector( '.tablenav.top .bulkactions' );
				const wrap = el( 'div', { class: 'alignleft actions sf-newfolder-wrap' }, [ button ] );
				anchor ? anchor.after( wrap ) : form.prepend( wrap );
			}
			button.addEventListener( 'click', createHere );

			document.body.classList.add( 'sf-details' );
			Preview.init();
			Uploader.init();

			// Long author names and post titles are cut off by the CSS; the full text is the tooltip.
			table.querySelectorAll( 'td.column-author a, td.column-parent strong a' ).forEach( ( link ) => {
				link.title = link.textContent.trim();
			} );
			table.querySelectorAll( 'tbody tr[id^="post-"]' ).forEach( ( row ) => row.setAttribute( 'draggable', 'true' ) );
			if ( ! table.querySelector( 'tr.sf-folder-row' ) ) {
				this.renderFolderRows();
			}
			this.bindRows();

			store.subscribe( ( type, payload ) => {
				if ( 'moved' === type ) {
					this.afterMove( payload );
				} else if ( 'data' === type || 'rename' === type ) {
					this.renderFolderRows();
				}
			} );
			return true;
		},

		/* -- folders as rows ------------------------------------------ */

		renderFolderRows() {
			const tbody = this.table.tBodies[ 0 ];
			if ( ! tbody ) {
				return;
			}
			const selected = tbody.querySelector( 'tr.sf-folder-row.sf-selected' );
			tbody.querySelectorAll( 'tr.sf-folder-row' ).forEach( ( row ) => row.remove() );

			const columns = [ ...this.table.tHead.rows[ 0 ].cells ].map( ( cell ) => ( {
				id: cell.id,
				label: cell.textContent.trim(),
				hidden: cell.classList.contains( 'hidden' ),
			} ) );
			const rows = folderEntries( cfg.flat ).map( ( entry ) => this.buildFolderRow( entry, columns ) );
			tbody.prepend( ...rows );

			if ( selected ) {
				const again = tbody.querySelector( 'tr.sf-folder-row[data-key="' + selected.dataset.key + '"]' );
				again && again.classList.add( 'sf-selected' );
			}
			focusRenameInput( tbody );
		},

		buildFolderRow( entry, columns ) {
			const folder = entry.up ? null : store.map.get( entry.key );
			const renaming = folder && store.renaming === folder.id;
			const row = el( 'tr', {
				class: 'sf-folder-row' + ( entry.up ? ' sf-up-row' : '' ),
				'data-key': String( entry.key ),
				'data-sf-up': entry.up ? '' : null,
				draggable: entry.up || renaming ? null : 'true',
				tabindex: '0',
			} );

			for ( const { id, label, hidden } of columns ) {
				if ( 'cb' === id ) {
					row.append( el( 'th', { scope: 'row', class: 'check-column' } ) );
					continue;
				}
				const cell = el( 'td', { class: 'column-' + id + ( 'title' === id ? ' column-primary' : '' ) + ( hidden ? ' hidden' : '' ), 'data-colname': label } );
				if ( 'title' === id ) {
					const symbol = icon( entry.up ? 'up' : 'folder', entry.up ? 'sf-ico-up' : '' );
					const label = renaming
						? el( 'span', { class: 'sf-folder-edit' }, [ symbol, renameInput( folder ) ] )
						: el( 'a', { class: 'sf-folder-link', href: listUrl( entry.key ) }, [ symbol, document.createTextNode( entry.label ) ] );
					cell.append( el( 'strong', { class: 'has-media-icon' }, [ label ] ) );
				} else if ( 'sf_type' === id && ! entry.up ) {
					cell.textContent = S.folderType;
				} else if ( 'sf_size' === id && ! entry.up ) {
					cell.textContent = itemsText( entry.count );
				}
				row.append( cell );
			}
			return row;
		},

		/* -- Explorer-like row behaviour ------------------------------ */

		fileRows() {
			return [ ...this.table.querySelectorAll( 'tbody tr[id^="post-"]' ) ];
		},

		setChecked( row, checked ) {
			const box = row.querySelector( 'input[name="media[]"]' );
			if ( box && box.checked !== checked ) {
				box.click();
			}
		},

		clearFolderSelection() {
			this.table.querySelectorAll( 'tr.sf-folder-row.sf-selected' ).forEach( ( row ) => row.classList.remove( 'sf-selected' ) );
		},

		selectRow( row, event ) {
			if ( row.classList.contains( 'sf-folder-row' ) ) {
				this.fileRows().forEach( ( file ) => this.setChecked( file, false ) );
				this.clearFolderSelection();
				row.classList.add( 'sf-selected' );
				this.anchor = null;
				return;
			}

			this.clearFolderSelection();
			const rows = this.fileRows();
			if ( event.shiftKey && this.anchor && rows.includes( this.anchor ) ) {
				const [ from, to ] = [ rows.indexOf( this.anchor ), rows.indexOf( row ) ].sort( ( a, b ) => a - b );
				rows.forEach( ( file, index ) => this.setChecked( file, index >= from && index <= to ) );
				return;
			}
			if ( event.ctrlKey || event.metaKey ) {
				this.setChecked( row, ! row.querySelector( 'input[name="media[]"]' ).checked );
			} else {
				rows.forEach( ( file ) => this.setChecked( file, file === row ) );
			}
			this.anchor = row;
		},

		open( row ) {
			if ( row.classList.contains( 'sf-folder-row' ) ) {
				navigate( parseKey( row.dataset.key ) );
				return;
			}
			if ( Preview.available() ) {
				Preview.open( row );
				return;
			}
			const link = row.querySelector( '.column-title a' );
			if ( link ) {
				window.location.href = link.href;
			}
		},

		bindRows() {
			const table = this.table;
			const rowOf = ( target ) => target.closest && target.closest( 'tbody tr' );
			const interactive = 'a, button, input, select, textarea, label, .row-actions';

			table.addEventListener( 'click', ( e ) => {
				const row = rowOf( e.target );
				if ( ! row || row.classList.contains( 'no-items' ) ) {
					return;
				}
				// A plain click on a file's name opens the preview popup; Ctrl/Shift/middle click still go to the edit page.
				const name = e.target.closest( 'td.column-title strong > a:not(.sf-folder-link)' );
				if ( name && Preview.available() && 0 === e.button && ! ( e.ctrlKey || e.metaKey || e.shiftKey || e.altKey ) ) {
					e.preventDefault();
					Preview.open( row );
					return;
				}
				if ( ! e.target.closest( interactive ) ) {
					this.selectRow( row, e );
				}
			} );

			// Load a file's preview while the pointer is on its row, so the popup opens at once.
			let hoverTimer = 0;
			table.addEventListener( 'pointerover', ( e ) => {
				const row = rowOf( e.target );
				window.clearTimeout( hoverTimer );
				if ( row && Preview.available() && row.id && row.id.startsWith( 'post-' ) ) {
					hoverTimer = window.setTimeout( () => Preview.fetch( Number( row.id.replace( 'post-', '' ) ) ).catch( () => {} ), 120 );
				}
			} );

			table.addEventListener( 'dblclick', ( e ) => {
				const row = rowOf( e.target );
				if ( row && ! row.classList.contains( 'no-items' ) && ! e.target.closest( 'input, select, textarea, .row-actions' ) ) {
					window.getSelection().removeAllRanges();
					this.open( row );
				}
			} );

			table.addEventListener( 'contextmenu', ( e ) => {
				const row = e.target.closest && e.target.closest( 'tr.sf-folder-row:not(.sf-up-row)' );
				if ( ! row ) {
					return;
				}
				e.preventDefault();
				this.selectRow( row, e );
				showMenu( e.clientX, e.clientY, folderMenu( parseKey( row.dataset.key ), () => this.open( row ) ), row );
			} );

			table.addEventListener( 'keydown', ( e ) => {
				const row = e.target.matches && e.target.matches( 'tr.sf-folder-row' ) ? e.target : null;
				if ( ! row ) {
					return;
				}
				if ( row.classList.contains( 'sf-up-row' ) ) {
					if ( 'Enter' === e.key ) {
						e.preventDefault();
						this.open( row );
					}
					return;
				}
				folderKey( e, parseKey( row.dataset.key ), () => this.open( row ), row );
			} );

			// Keep the highlight of file rows in sync, whoever changes the checkbox (row click, "select all", ...).
			table.addEventListener( 'change', ( e ) => {
				const box = e.target;
				if ( box.matches && box.matches( 'input[name="media[]"]' ) ) {
					box.closest( 'tr' ).classList.toggle( 'sf-selected', box.checked );
				}
			} );
			document.querySelectorAll( 'input#cb-select-all-1, input#cb-select-all-2' ).forEach( ( box ) =>
				box.addEventListener( 'change', () => this.fileRows().forEach( ( row ) => row.classList.toggle( 'sf-selected', box.checked ) ) )
			);

			bindFolderDnD( table, 'tr.sf-folder-row' );
		},

		afterMove( { ids, target } ) {
			// Files that left the open folder disappear from the list. Search results span all folders.
			const leaves = ! ( cfg.flat && ROOT === store.selected ) && String( store.selected ) !== String( target );
			if ( ! leaves ) {
				return;
			}
			for ( const id of ids ) {
				const row = this.table.querySelector( '#post-' + id );
				row && row.remove();
			}
		},
	};

	/* ------------------------------------------------------------------
	 * 10. wp.media (grid view and media modal)
	 * ---------------------------------------------------------------- */

	/** True while searching or filtering by date/post: results then span all folders, like a search in Explorer. */
	const isFlat = ( props ) => !! ( props.get( 'search' ) || props.get( 'uploadedTo' ) || props.get( 'year' ) || props.get( 'monthnum' ) );

	/** The `sf_folder` query arg for the open folder. */
	function filterFor( collection ) {
		if ( ROOT !== store.selected ) {
			return store.selected;
		}
		return isFlat( collection.props ) ? null : NO_FOLDER;
	}

	function applyFilter( collection, silent = false ) {
		const value = filterFor( collection );
		if ( ( collection.props.get( 'sf_folder' ) ?? null ) !== value ) {
			collection.props.set( { sf_folder: value }, { silent } );
		}
	}

	/** Re-run the open query, bypassing Backbone's query cache. */
	function reloadCollection( collection ) {
		collection.props.set( 'cache', false, { silent: true } );
		collection._requery();
		collection.props.unset( 'cache', { silent: true } );
	}

	/** Subfolders as tiles (and a "New folder" tile) in front of the files of a wp.media attachments browser. */
	class BrowserExplorer {
		constructor( view ) {
			this.view = view;
			this.host = view.el;
			this.collection = view.collection;
			/*
			 * Files that moved out of the open folder. WordPress re-adds a model to the
			 * collection when it changes (e.g. after saving the details field), so keep
			 * them out until the view is reloaded.
			 */
			this.left = new Set();

			this.tiles = el( 'ul', { class: 'sf-foldergrid', role: 'group', 'aria-label': S.folders } );
			this.el = el( 'div', { class: 'sf-explorer' }, [ this.tiles ] );

			this.bindTiles();
			this.collection.on( 'add', ( model ) => this.left.has( model.id ) && this.collection.remove( model ) );
			// Runs before core's own 'change' handler, so the re-query already carries the right folder.
			this.collection.props.on( 'change:search change:uploadedTo change:year change:monthnum', () => {
				applyFilter( this.collection, true );
				this.render();
			} );

			this.unsubscribe = store.subscribe( ( type, payload ) => this.onStore( type, payload ) );
		}

		mount() {
			this.host.classList.add( 'sf-has-explorer' );
			if ( ! store.loaded ) {
				store.load();
			}
			this.render();
			this.place();

			// wp.media re-renders its views and drops children it does not know about.
			new MutationObserver( () => {
				if ( ! this.el.isConnected && this.host.isConnected ) {
					this.place();
				}
			} ).observe( this.host, { childList: true } );

			// The modal lays its content out absolutely; tell it how tall we are.
			if ( window.ResizeObserver ) {
				new ResizeObserver( () => this.host.style.setProperty( '--sf-top', this.el.offsetHeight + 'px' ) ).observe( this.el );
			}
		}

		place() {
			const anchor = this.host.querySelector( ':scope > .attachments-wrapper' ) || this.host.querySelector( ':scope > .attachments' );
			this.host.insertBefore( this.el, anchor );
		}

		onStore( type, payload ) {
			if ( ! this.host.isConnected ) {
				this.unsubscribe();
				return;
			}
			if ( 'data' === type || 'rename' === type ) {
				this.render();
			} else if ( 'select' === type ) {
				this.left.clear();
				applyFilter( this.collection );
				this.render();
			} else if ( 'refresh' === type ) {
				this.left.clear();
				reloadCollection( this.collection );
			} else if ( 'moved' === type ) {
				this.afterMove( payload );
			} else if ( 'uploaded' === type && null !== ( this.collection.props.get( 'sf_folder' ) ?? null ) ) {
				// Core only feeds new uploads into queries it fully understands, so add them to folder views ourselves.
				this.collection.add( payload, { at: 0 } );
			}
		}

		afterMove( { ids, target } ) {
			const open = this.collection.props.get( 'sf_folder' ) ?? null;
			const here = ROOT === target ? NO_FOLDER : target;
			if ( null === open || String( open ) === String( here ) ) {
				ids.forEach( ( id ) => this.left.delete( id ) );
				return;
			}
			ids.forEach( ( id ) => this.left.add( id ) );
			const models = ids.map( ( id ) => this.collection.get( id ) ).filter( Boolean );
			try {
				const selection = this.view.controller.state().get( 'selection' );
				selection && selection.remove( models );
			} catch ( e ) {}
			this.collection.remove( models );
		}

		render() {
			const flat = isFlat( this.collection.props );
			this.tiles.hidden = flat || ! store.loaded;
			const tiles = folderEntries( flat ).map( ( entry ) => this.buildTile( entry ) );
			if ( ! flat && store.loaded ) {
				tiles.push( this.buildNewTile() );
			}
			this.tiles.replaceChildren( ...tiles );
			focusRenameInput( this.tiles );
		}

		/** Same markup as a file tile, so core's grid sizes it like one. */
		tile( classes, label, symbol, attrs = {} ) {
			const preview = el( 'div', { class: 'attachment-preview' }, [
				el( 'div', { class: 'thumbnail' }, [ el( 'div', { class: 'sf-foldertile-icon' }, [ symbol ] ) ] ),
				el( 'div', { class: 'sf-foldertile-label' }, label ),
			] );
			return el( 'li', { class: 'attachment ' + classes, role: 'button', tabindex: '0', ...attrs }, [ preview ] );
		}

		buildTile( entry ) {
			const folder = entry.up ? null : store.map.get( entry.key );
			const renaming = folder && store.renaming === folder.id;
			const label = renaming
				? [ renameInput( folder ) ]
				: [ el( 'span', { class: 'sf-foldertile-name', text: entry.label } ), entry.up ? null : el( 'span', { class: 'sf-foldertile-count', text: String( entry.count ) } ) ];
			return this.tile( 'sf-foldertile' + ( entry.up ? ' sf-uptile' : '' ), label, icon( entry.up ? 'up' : 'folder', entry.up ? 'sf-ico-up' : '' ), {
				'data-key': String( entry.key ),
				'data-sf-up': entry.up ? '' : null,
				draggable: entry.up || renaming ? null : 'true',
				title: entry.label,
			} );
		}

		buildNewTile() {
			return this.tile( 'sf-foldertile-new', [ el( 'span', { class: 'sf-foldertile-name', text: S.newFolder } ) ], icon( 'plus' ), { title: S.newFolder } );
		}

		bindTiles() {
			const tiles = this.tiles;
			const open = ( tile ) => ( tile.classList.contains( 'sf-foldertile-new' ) ? createHere() : navigate( parseKey( tile.dataset.key ) ) );
			const tileOf = ( target ) => target.closest && target.closest( '.sf-foldertile, .sf-foldertile-new' );

			tiles.addEventListener( 'click', ( e ) => {
				const tile = tileOf( e.target );
				tile && ! e.target.closest( 'input' ) && open( tile );
			} );
			tiles.addEventListener( 'keydown', ( e ) => {
				const tile = e.target.matches && e.target.matches( '.sf-foldertile, .sf-foldertile-new' ) ? e.target : null;
				if ( ! tile ) {
					return;
				}
				const plain = tile.classList.contains( 'sf-foldertile-new' ) || tile.hasAttribute( 'data-sf-up' );
				if ( ' ' === e.key || ( plain && 'Enter' === e.key ) ) {
					e.preventDefault();
					e.stopPropagation();
					open( tile );
					return;
				}
				if ( ! plain ) {
					folderKey( e, parseKey( tile.dataset.key ), () => open( tile ), tile );
				}
			} );
			tiles.addEventListener( 'contextmenu', ( e ) => {
				const tile = e.target.closest && e.target.closest( '.sf-foldertile:not([data-sf-up])' );
				if ( tile ) {
					e.preventDefault();
					showMenu( e.clientX, e.clientY, folderMenu( parseKey( tile.dataset.key ), () => open( tile ) ), tile );
				}
			} );
			bindFolderDnD( tiles, '.sf-foldertile' );
		}
	}

	function mountBrowser( view ) {
		const collection = view.collection;
		if ( ! collection || ! collection.props || ! collection.props.get( 'query' ) ) {
			return;
		}
		new BrowserExplorer( view ).mount();
	}

	function patchMedia() {
		const media = wp.media;
		if ( ! media || ! media.view || ! media.view.AttachmentsBrowser ) {
			return;
		}

		const proto = media.view.AttachmentsBrowser.prototype;
		const originalInitialize = proto.initialize;
		proto.initialize = function () {
			// Filter before the first fetch so the open folder costs no extra request.
			try {
				if ( this.collection && this.collection.props && this.collection.props.get( 'query' ) ) {
					applyFilter( this.collection );
				}
			} catch ( e ) {}
			const result = originalInitialize.apply( this, arguments );
			try {
				mountBrowser( this );
			} catch ( e ) {
				window.console && window.console.error( 'Semera Folders:', e );
			}
			return result;
		};

		// Tell every uploader which folder is open.
		if ( media.model && window.wp.Uploader ) {
			const originalInit = wp.Uploader.prototype.init;
			wp.Uploader.prototype.init = function () {
				const result = originalInit && originalInit.apply( this, arguments );
				this.uploader.bind( 'BeforeUpload', ( up ) => {
					if ( 'number' === typeof store.selected ) {
						up.settings.multipart_params.sf_folder = store.selected;
					} else {
						delete up.settings.multipart_params.sf_folder;
					}
				} );
				return result;
			};
			if ( wp.Uploader.queue ) {
				wp.Uploader.queue.on( 'add', ( model ) => store.emit( 'uploaded', model ) );
				wp.Uploader.queue.on( 'change:uploading', ( model ) => ! model.get( 'uploading' ) && store.refreshSoon() );
			}
		}

		watchAttachments();
		bindAttachmentFields();
	}

	/** The "Folder" select in the attachment details panel. */
	function bindAttachmentFields() {
		const hydrate = ( select ) => {
			if ( '1' !== select.dataset.sfLazy ) {
				return;
			}
			const fill = () => {
				const current = select.value;
				select.replaceChildren( el( 'option', { value: '0', text: S.noFolder } ) );
				for ( const { folder, depth } of store.flat() ) {
					select.append( el( 'option', { value: String( folder.id ), text: '— '.repeat( depth ) + folder.name } ) );
				}
				select.value = current;
				select.dataset.sfLazy = '0';
			};
			store.loaded ? fill() : store.load().then( fill );
		};
		document.addEventListener( 'focusin', ( e ) => e.target.matches && e.target.matches( 'select.sf-field-select' ) && hydrate( e.target ) );
		document.addEventListener( 'pointerdown', ( e ) => e.target.matches && e.target.matches( 'select.sf-field-select' ) && hydrate( e.target ) );

		// WordPress saves the field itself; we only keep the open view and the counts in sync.
		document.addEventListener( 'change', ( e ) => {
			const select = e.target;
			if ( ! select.matches || ! select.matches( 'select.sf-field-select' ) ) {
				return;
			}
			const folder = Number( select.value );
			store.emit( 'moved', { ids: [ Number( select.dataset.sfAttachment ) ], target: folder ? folder : ROOT } );
		} );
		if ( window.jQuery ) {
			window.jQuery( document ).on( 'ajaxComplete', ( event, xhr, settings ) => {
				if ( 'string' === typeof settings.data && /action=(save-attachment-compat|delete-post)/.test( settings.data ) ) {
					store.refreshSoon();
				}
			} );
		}
	}

	/* ------------------------------------------------------------------
	 * 11. boot
	 * ---------------------------------------------------------------- */

	function boot() {
		if ( ! wp.apiFetch ) {
			return;
		}

		const isListPage = !! document.querySelector( 'table.wp-list-table.media' );
		if ( 'number' === typeof cfg.selected ) {
			store.selected = cfg.selected;
		} else if ( cfg.onLibrary && ! isListPage ) {
			const remembered = storage.get( 'selected', ROOT );
			store.selected = 'number' === typeof remembered ? remembered : ROOT;
		}
		if ( cfg.snapshot ) {
			store.apply( cfg.snapshot );
		}

		patchMedia();
		if ( isListPage ) {
			ListMode.init();
		}
	}

	// Loaded in the footer: the list table exists already, and wp.media is patched before its frames are built.
	boot();
} )( window, document );
