<p align="center">
  <img src="./docs/icon.png" alt="Semera Folders icon" width="80"/>
</p>

<h1 align="center">Semera Folders</h1>

<p align="center"><em>Folders for the WordPress media library, modelled on Windows Explorer.</em></p>

[![Version](https://img.shields.io/badge/version-0.1.2-blue.svg)](./semera-folders.php)
[![License](https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg)](./LICENSE)
[![WordPress](https://img.shields.io/badge/WordPress-6.0%2B-21759b.svg?logo=wordpress)](https://wordpress.org)
[![PHP](https://img.shields.io/badge/PHP-7.4%2B-777bb4.svg?logo=php)](https://php.net)
[![Vanilla JS](https://img.shields.io/badge/frontend-vanilla%20JS-f7df1e.svg?logo=javascript&logoColor=black)](./assets/js/semera-folders.js)
[![No build step](https://img.shields.io/badge/build%20step-none-brightgreen.svg)](#%EF%B8%8F-development)

**Semera Folders** organises the WordPress media library in folders the way you know it from Windows Explorer: you are always *in* a folder, and it shows its subfolders and its files together.
Nothing else: no pro tier, no upsell, no settings page, no build step.

## ✨ Features

* **Like Explorer**

  * The top level shows the top-level folders and the files that are in no folder. Files inside folders only show up in their folder, or in search results.
  * A file lives in **one folder at a time**. A folder shows its own content, not its subfolders'.
  * **Searching or filtering** looks through all folders.

* **Folders**

  * **New folder:** a button in the list view's toolbar (where WordPress puts the bulk actions, which are hidden there); in the grid view and the media modal a dashed "New folder" tile after the folders. A new folder starts in rename mode.
  * **Rename, delete, new subfolder** from the right-click menu or the keyboard (`F2`, `Delete`, `Enter` on a focused folder).
  * **Drag and drop** files onto folders (multi-select works) and onto *Up one level*. Drag folders onto other folders to nest them.
  * Deleting a folder never deletes files: its files and subfolders move up one level.
  * Works without drag and drop too: the *Folder* field in the attachment details.

* **Details list** (the library's list view, the default for users who have not picked a view, 100 rows per page)

  * Compact rows with Type and Size columns (no Comments column), folders first, an "Up one level" row inside folders.
  * Every column but the file name only takes the room its content needs; long author names and post titles are cut off with an ellipsis, so the file name and its row actions get the space.
  * Click selects, Ctrl/Shift extend the selection, double-click opens a folder or a file.
  * The compact styling, the "New folder" button and the folder rows are rendered by the server, so nothing pops in after the page has loaded.

* **Preview popup**

  * A click on a file's name (or a double-click on its row) opens a popup instead of the edit page.
  * The large image, a video/audio player, the PDF in the browser's viewer, or a file type badge.
  * All details: name, type, size, dimensions, length, upload date and author, uploaded to (with Attach / Detach, which are not shown in the list), folder, alt text, caption, description, generated sizes, and the URL with a copy button.
  * Edit, Open file and Download buttons; arrow keys (or the arrows in the header) step through the files; Esc, the × or a click outside closes it.
  * Ctrl-, Shift- or middle-click on the name still goes to the edit page.

* **Grid view and media modal**

  * Subfolders are tiles in the size of the file tiles, in front of the files. Folders, "Up one level" and the "New folder" tile work like the rows in the list view.

* **Uploads go to the open folder**

  * Files can be dragged in from the desktop in every view. In the list view (which core gives no uploader) they are posted to `async-upload.php` by the script; dropping them on a folder row uploads them into that folder.

* **German and English**

  * The German translation is included (`languages/`).

## 🚧 Roadmap / TODOs

- [x] Folders with nesting, rename, delete, drag and drop
- [x] Details list with folder rows, compact rows, server-rendered
- [x] Preview popup with PDF viewer, Attach / Detach
- [x] Upload by drag and drop in the list view
- [ ] Touch devices: drag and drop is not available there (use the *Folder* field); a "Move to…" entry for phones and tablets
- [ ] Delete several selected files at once (the bulk actions are hidden): `Delete` key or a context menu on selected files
- [ ] Test with a large library (thousands of files, hundreds of folders)
- [ ] Test a real multi-file drop from the desktop and very large uploads
- [ ] Preview popup in the grid view (core's own details popup is used there)

## 📦 Project Structure

```
semera-folders/
├── semera-folders.php        # Plugin header, constants, bootstrap
├── uninstall.php             # Removes the folder structure (never the media files)
├── includes/
│   ├── Folders.php           # Folder data layer: taxonomy, create/rename/move/delete, counts
│   ├── Rest.php              # REST API semera-folders/v1
│   ├── Media.php             # Query filtering, uploads, list columns, details field, assets
│   ├── ListView.php          # Server-rendered "New folder" button and folder rows
│   ├── Preview.php           # Preview popup: dialog shell and rendered content
│   └── Plugin.php            # Hooks
├── assets/
│   ├── js/semera-folders.js  # Folder rows/tiles, drag and drop, preview, uploads, wp.media hooks
│   └── css/semera-folders.css
├── docs/icon.png             # Icon for this README (not part of the release zip)
├── languages/                # .pot, German .po/.mo
├── bin/                      # i18n.py, sync-to-studio.ps1, build-zip.ps1
└── README.md
```

## 🧠 How it works

| Piece | Where |
| --- | --- |
| Folders are terms of the hierarchical, non-public taxonomy `semera_folder` on `attachment` | `includes/Folders.php` |
| REST API `semera-folders/v1`: `GET/POST /folders`, `POST/DELETE /folders/<id>`, `POST /move`, `GET /preview/<id>` | `includes/Rest.php` |
| Filtering (`query-attachments`, `upload.php?sf_folder=`), upload assignment, Type/Size columns, details field, list-view body class, assets | `includes/Media.php` |
| "New folder" button and folder rows, spliced into the list view's HTML | `includes/ListView.php` |
| Preview popup: dialog shell and the rendered content | `includes/Preview.php` |
| Folder rows and tiles, drag and drop, preview behaviour, list-view uploads, `wp.media` hooks (no build step) | `assets/js/semera-folders.js` |

* **Top level:** without a folder the library shows only files that are in no folder, unless the request is a search or filter (`s`, month, mime type, `detached`).
* **Grid view and modal:** filtered by setting an `sf_folder` prop on the `wp.media` attachments collection; uploaders send `sf_folder` as a multipart param.
* **List view:** `upload.php?mode=list&sf_folder=<id>`.

## ⚙️ Development

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

## 🛠️ Build

Release zip for **Plugins → Add New → Upload Plugin** (one top-level folder, only runtime files, forward-slash entries):

```powershell
pwsh bin/build-zip.ps1                       # dist/semera-folders-<version>.zip
```

## 🔒 Notes

* **Requirements:** WordPress 6.0+, PHP 7.4+, a current browser (the preview uses `<dialog>`).
* **Permissions:** everything is permitted for users with the `upload_files` capability; change it with the `semera_folders_capability` filter. The preview additionally requires `edit_post` for the file.
* **Uninstalling** the plugin removes the folder structure, never the media files.

## 👤 Author

* **Jan Schulz-Nigmann / Semera**
* Copyright © 2026 Jan Schulz-Nigmann / Semera
* License: [GPL-2.0-or-later](./LICENSE). Free for everyone, including commercial use. Modified versions must stay under the GPL.
