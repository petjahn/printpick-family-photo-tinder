# PrintPick v2 — Family Photo Culler for Google Photos & Firebase

A mobile-first swipe culler and desktop admin console connected directly to **Google Photos** (via the Google Photos Picker API) and backed by **Firebase (Google Auth + Cloud Firestore)**.

---

## Key Features

### 1. Two Distinct Interfaces
- **Mobile Swipe Interface (`#swipe`)** — Optimized for one-handed phone swiping (`100dvh`), also supporting keyboard and mouse on desktop/iPad:
  - **Swipe Right (`→`):** Mark photo for **Print** (`status: 'print'`).
  - **Swipe Left (`←`):** **Ignore** and mark photo as **Shown** (`status: 'shown'`) in Firestore so neither partner is shown the photo again.
  - **Swipe Up (`↑`):** Mark photo for **Deletion** (`status: 'delete'`).
  - **Undo (`↩` / `Backspace`):** Revert the last swipe in Firestore and animate the card back onto the top of the deck.
- **Admin Console (`#admin`)** — Manage all three photo buckets across devices:
  - **Marked for Print:** Inspect thumbnails, single/bulk **Unmark**, **Download Print ZIP (`.zip`)**, **Refresh Expired 60m Google URLs**, and click **Mark Batch as Printed** (empties the Print queue while permanently keeping those photos marked as already seen/printed).
  - **Marked for Deletion:** Groups photos by capture date (`YYYY-MM-DD`) with **Open Date in Google Photos** deep-links and filename copy helpers so you can quickly trash them in Google Photos, then click **Confirm Deleted** or **Unmark**.
  - **Marked as Shown:** Browse ignored and previously printed photos to rescue accidental left-swipes (**Unmark** back to the swipe deck or **Move to Print**).

### 2. Firestore-Only Shared Family Architecture
- Stores compact (`~8–12 KB`) base64 WebP thumbnails directly in Cloud Firestore (`workspaces/family/photos/{photoId}`), so Admin thumbnails work indefinitely across all devices without needing Firebase Storage.
- Caches full-resolution images opportunistically in local `IndexedDB` and supports 1-click Picker URL refresh when downloading the Print `.zip` after Google's 60-minute `baseUrl` window expires.
- Shared family allowlist (`VITE_ALLOWED_EMAILS` + [firestore.rules](./firestore.rules)) lets you and your partner share one real-time Print / Delete / Shown database.

---

## Setup Guide

### 1. Firebase Project & Firestore
1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Authentication → Sign-in method → Google**.
3. Enable **Cloud Firestore** and publish the security rules from [firestore.rules](./firestore.rules).

### 2. Enable Google Photos Picker API
1. Open the [Google Cloud Console](https://console.cloud.google.com/) for the same project.
2. Go to **APIs & Services → Library** and enable **Google Photos Picker API** (`photospicker.googleapis.com`).
3. Under **OAuth consent screen**, add the scope `https://www.googleapis.com/auth/photospicker.mediaitems.readonly` and add your family emails as Test Users (or set publishing status to Production).

### 3. Configure Credentials
You can either:
- Click the **Settings (gear icon)** in the top-right corner of the running web app and paste your Firebase Project ID, API Key, and allowed family emails (saved in `localStorage`), **or**
- Copy [.env.example](./.env.example) to `.env` for local development / set `VITE_*` repository secrets for the automated GitHub Pages workflow ([.github/workflows/deploy.yml](./.github/workflows/deploy.yml)).

---

## Local Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```
