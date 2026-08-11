# QuickBooks Web Connector — Setup Guide

> One-page reference for setting up the accountant's Windows machine to sync with the Synergie Timesheet App via QuickBooks Web Connector.

---

## Before you start

- Windows machine with **QuickBooks Desktop 2020 Pro** (or later) installed
- The QuickBooks company file you want to sync with, opened in QuickBooks
- **Back up the company file first:** in QuickBooks → **File → Back Up Company → Local Backup**. Save it somewhere you can find later.
- The two things Dan gave you:
  1. The `synergie-timesheet.qwc` config file
  2. The Web Connector password (in a plaintext note or password manager entry)

---

## Step 1 — Install QuickBooks Web Connector (~5 min, one-time)

QuickBooks Web Connector is a free tool from Intuit that lets our app talk to QuickBooks Desktop.

1. Open a browser and go to Intuit's install page:
   **https://developer.intuit.com/app/developer/qbdesktop/docs/develop/tutorials/install-web-connector**
2. Download the latest installer (`QBWebConnectorInstaller.exe`).
3. Run it. Accept the default install location.
4. When the installer finishes, launch **QuickBooks Web Connector** from the Start menu. It will open a small window listing installed applications (empty at first).

> `[Screenshot placeholder — Web Connector empty state]`

---

## Step 2 — Add the Synergie app

1. In the Web Connector window, click **Add an Application** (button at the bottom-right).
2. A file picker opens. Select the `synergie-timesheet.qwc` file that Dan gave you.
3. A confirmation dialog appears — click **OK** / **Yes**.
4. A password prompt appears. Paste the password from your password manager and click **OK**.
5. When Web Connector asks *"Do you want to save this password?"* — click **Yes**. Otherwise you'd have to re-enter it every sync.

> `[Screenshot placeholder — Add Application dialog]`
> `[Screenshot placeholder — password prompt]`

---

## Step 3 — Grant QuickBooks access (one-time prompt)

The **very first** time Web Connector tries to talk to QuickBooks, QuickBooks will show a security prompt asking whether to allow this application to access your company file.

1. Make sure QuickBooks Desktop is **already open** with the company file loaded.
2. In Web Connector, click **Update Selected** (the green arrow, next to the Synergie app row) to trigger the first sync.
3. QuickBooks pops up an SDK permission dialog. Select:
   - **Yes, always; allow access even if QuickBooks is not running**
   - **Do you want to allow this application to read and modify this company file?** → Yes
4. Click **Continue** → **Done**.

> `[Screenshot placeholder — QB SDK permission prompt]`

You'll only see this prompt once per company file.

---

## Step 4 — Verify the first sync

After Step 3, the Web Connector row will show a status message. Look for:
- **Green checkmark** or **"Update completed successfully"** → you're done, everything is working.
- **Red X** or an error message → note the exact text and send it to Dan. Common causes: password typo (redo Step 2), company file not open, wrong QB Desktop version.

---

## Ongoing use

- Web Connector runs in the background. It will automatically sync every **15 minutes** by default.
- To force a sync right now: click **Update Selected** on the Synergie row.
- To stop syncs temporarily: uncheck the box on the Synergie row. Re-check to resume.

You don't have to do anything else. When Dan (or you) submits invoices or payments in the Synergie app that are ready for QuickBooks, they'll flow across on the next sync.

---

## If something goes wrong

- **Password rejected:** re-check you copied the full password including any special characters. If unsure, ask Dan to reset it — he can do so in the app's admin panel.
- **"App URL rejected" / "Cannot connect":** the internet connection is down, or a firewall is blocking `mimlatvdwxqtgxrgcins.supabase.co`. Ask IT to whitelist that domain.
- **Web Connector shows an application that isn't Synergie:** ignore it. You can have multiple apps in Web Connector; ours is labelled **Synergie Timesheet App**.
- **You accidentally clicked "No" on the QuickBooks security prompt in Step 3:** open QuickBooks → **Edit → Preferences → Integrated Applications → Company Preferences → Synergie Timesheet App → Properties** and re-enable access.

For anything else, message Dan.
