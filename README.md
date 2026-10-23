# Semera Folders

Folders for the WordPress media library, modelled on Windows Explorer. Nothing else: no pro tier, no upsell, no settings page.

## What it does

### Folders

- **Like Explorer:** you are always *in* a folder, and it shows its subfolders and its files together. The top level shows the top-level folders and the files that are in no folder. Files inside folders only show up in their folder, or in search results.
- A file lives in **one folder at a time**. A folder shows its own content, not its subfolders'.
- **New folder:** a button in the list view's toolbar, where WordPress puts the bulk actions (those are hidden in this view); in the grid view and the media modal a dashed "New folder" tile after the folders. A new folder is created in the open folder and starts in rename mode.
- **Rename, delete, new subfolder** from the right-click menu or the keyboard (`F2`, `Delete`, `Enter` on a focused folder).
- **Drag and drop** files onto folders (multi-select works) and onto *Up one level*. Drag folders onto other folders to nest them.
- Deleting a folder never deletes files: its files and subfolders move up one level.
- **Searching or filtering** looks through all folders.
- **Uploads go to the open folder.** Files can be dragged in from the desktop in every view; in the list view (which core gives no uploader) they are posted to `async-upload.php` by the script, and dropping them on a folder row uploads them into that folder.
- Works without drag and drop too: the *Folder* field in the attachment details.

### List view (details list)

The library's list view is the default for users who have not picked a view, with 100 rows per page.

- Compact rows with Type and Size columns (no Comments column), folders first, an "Up one level" row inside folders. Every column but the file name only takes the room its content needs, and long author names and post titles are cut off with an ellipsis, so the file name and its row actions get the space.
- Click selects, Ctrl/Shift extend the selection, double-click opens a folder or a file.
- The compact styling, the "New folder" button and the folder rows are rendered by the server, so nothing pops in after the page has loaded.

### Preview popup

A click on a file's name (or a double-click on its row) opens a popup instead of the edit page:

- the large image, a video/audio player, the PDF in the browser's viewer, or a file type badge;
- all details: name, type, size, dimensions, length, upload date and author, uploaded to (with Attach / Detach, which are not shown in the list), folder, alt text, caption, description, generated sizes, and the URL with a copy button;
- Edit, Open file and Download buttons;
- arrow keys (or the arrows in the header) step through the files, Esc, the × or a click outside closes it.

Ctrl-, Shift- or middle-click on the name still goes to the edit page.

### Grid view and media modal

Subfolders are tiles in the size of the file tiles, in front of the files. Folders, "Up one level" and the "New folder" tile work like the rows in the list view.

## How it works

| Piece | Where |
| --- | --- |
| Folders are terms of the hierarchical, non-public taxonomy `semera_folder` on `attachment` | `includes/Folders.php` |
| REST API `semera-folders/v1`: `GET/POST /folders`, `POST/DELETE /folders/<id>`, `POST /move`, `GET /preview/<id>` | `includes/Rest.php` |
| Filtering (`query-attachments`, `upload.php?sf_folder=`), upload assignment, Type/Size columns, details field, list-view body class, assets | `includes/Media.php` |
| "New folder" button and folder rows, spliced into the list view's HTML | `includes/ListView.php` |
| Preview popup: dialog shell and the rendered content | `includes/Preview.php` |
| Folder rows and tiles, drag and drop, preview behaviour, `wp.media` hooks (no build step) | `assets/js/semera-folders.js` |

- **Top level:** without a folder the library shows only files that are in no folder, unless the request is a search or filter (`s`, month, mime type, `detached`).
- **Grid view and modal:** filtered by setting an `sf_folder` prop on the `wp.media` attachments collection; uploaders send `sf_folder` as a multipart param.
- **List view:** `upload.php?mode=list&sf_folder=<id>`.

Everything is permitted for users with the `upload_files` capability; change it with the `semera_folders_capability` filter. The preview additionally requires `edit_post` for the file.

## Requirements

WordPress 6.0+, PHP 7.4+, a current browser (the preview uses `<dialog>`).

## Development

No build step. Copy the folder into `wp-content/plugins/`. With [WordPress Studio](https://developer.wordpress.com/studio/) (its PHP only sees the site folder, so a symlink does not work):

```powershell
pwsh bin/sync-to-studio.ps1                  # default site: ~/Studio/semera-dev
pwsh bin/sync-to-studio.ps1 -Site C:\path\to\site
```

With `WP_DEBUG` on, the plugin busts the browser cache of its scripts and styles by file time.

Translations (no gettext needed; German is included):

```bash
python bin/i18n.py pot   # refresh languages/semera-folders.pot
python bin/i18n.py mo    # compile languages/*.po
```

Uninstalling the plugin removes the folder structure, never the media files.
