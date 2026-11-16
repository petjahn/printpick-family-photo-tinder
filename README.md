# PrintPick — Family Photo Tinder for Google Photos

A zero-setup, single-file web application for rapidly culling family photos from **Google Photos** (`Shift + D` `.zip` exports, local folders, or the Google Photos Picker API), comparing burst shots of kids side-by-side, skipping previously printed pictures, and exporting a ready-to-print `.zip` order for your local print shop.

## Features

- **Tinder-Style Swiping & Keyboard Speed-Culling**
  - `→` or `Space`: **Print (1 copy)**
  - `↑` or `S`: **Super-Print (2 copies — e.g. extra copy for grandparents)**
  - `←` or `X`: **Skip / Pass**
  - `Backspace` or `U`: **Undo last swipe**
- **Automatic Burst Grouping & Sharpness Scoring**
  - Groups photos taken within 8 seconds of each other and computes a client-side Laplacian sharpness score to highlight the sharpest shot in each burst.
  - Press **`B`** to compare all burst shots side-by-side and pick the best one (automatically skipping the rest of the burst).
- **4×6 / 5×7 Print Crop Safe-Zone Guide (`C`)**
  - Overlays a 3:2 (4×6") or 7:5 (5×7") crop guide over 4:3 phone photos so you can verify heads and edges won't be trimmed by the print lab.
- **2.2× Face Loupe (`Z`)**
  - Instantly zoom in on faces to spot blinks or motion blur.
- **Already-Printed History Guard**
  - Remembers every photo you have marked as printed (`localStorage` + JSON backup/restore) so even if old photos remain starred in Google Photos, they are automatically skipped in future batches.
- **1-Click Print Shop `.ZIP` & `.CSV` Export**
  - Packages your selected winners into a clean `Print_Order_YYYY-MM-DD.zip` organized by print size and copy count (`4x6_1_copy/`, `4x6_2_copies/`) alongside `PRINT_SHOP_ORDER_SHEET.csv`.

## Quick Start

1. Open `index.html` in any modern browser.
2. In [Google Photos](https://photos.google.com), open your **Favorites (Starred)** or monthly photos, select a batch, and press **`Shift + D`** to download `Photos.zip`.
3. Drag and drop `Photos.zip` (or a folder of images) directly onto the PrintPick window.
4. Swipe through your photos, click **Download Print Shop Order (.ZIP)**, and click **✓ Lock as Printed** so next month's batch automatically skips them.
