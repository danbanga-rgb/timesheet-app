# QuickBooks Web Connector — Setup Guide

> Full step-by-step for setting up an accountant's Windows machine to sync with the Synergie Timesheet App via QuickBooks Web Connector. Written for a non-technical user. No step assumed obvious.

---

## What we're doing and why

The Synergie Timesheet App runs on the web. QuickBooks Desktop runs on your Windows computer. They can't talk to each other directly. **QuickBooks Web Connector** is a small free program from Intuit that acts as a bridge: it sits on your Windows machine, periodically checks with the Synergie app to see if anything needs to be sent to QuickBooks, and if so it hands the data to QuickBooks and reports back what happened.

You install Web Connector once. After that, it runs quietly in the background.

**Today we're going to test it on a copy of your QuickBooks company file** — not the real one. That way if anything unexpected happens, no real data is touched. Once we're confident the sync works cleanly, we switch to the real company file.

---

## Before we start — what you should have

- A Windows computer with **QuickBooks Desktop 2020 Pro** (or later) installed
- The QuickBooks company file, closed (not currently open in QuickBooks)
- A file called **`synergie-timesheet.qwc`** — Dan will give you this by email or on a thumb drive
- A **password** — Dan will give you this separately (via a text or password manager entry)
- About 30 minutes of quiet time. First-time setup involves several clicks and one Intuit download.

---

## Step 1 — Make a working copy of your company file (10 min)

We do this so today's testing runs against a safe copy, not your real books.

1. Open **File Explorer** (Windows key + E).
2. Navigate to where your QuickBooks company file lives. Common locations:
   - `C:\Users\Public\Public Documents\Intuit\QuickBooks\Company Files\`
   - Or wherever you normally open it from.
3. The file you want has the extension `.QBW` — for example `Synergie Company.QBW`.
4. Right-click that file → **Copy**.
5. Right-click in the same folder → **Paste**. You'll get a new file called something like `Synergie Company - Copy.QBW`.
6. Right-click the copy → **Rename** → change it to `Synergie Company - TEST.QBW`. (Any name that clearly says TEST is fine.)

   > **Why rename?** So you never accidentally confuse it with the real one during testing.

7. Now open QuickBooks Desktop:
   - **File → Open or Restore Company → Open a company file → Next**
   - Navigate to and select `Synergie Company - TEST.QBW`
   - Click **Open**
   - If it asks about "Update Company File" — click **Yes** (it will convert the copy, not the original).
   - Sign in with your usual credentials.

8. Confirm you're in the test copy: the QuickBooks title bar at the top should show something like *"Synergie Company - TEST"*. **Verify this before continuing.** If it says the original company name, close it and re-open the TEST file.

**Leave QuickBooks open with the test company file for the rest of this guide.** We'll need it in Step 3.

---

## Step 2 — Install QuickBooks Web Connector (5 min, one-time)

Web Connector is free from Intuit. You only install it once per computer.

1. In your web browser, go to Intuit's official install page:
   **https://developer.intuit.com/app/developer/qbdesktop/docs/develop/tutorials/install-web-connector**

2. On that page, look for a section called **"Get the latest QBWC installer"** or a button that says **Download QBWC 2.3.x** (the version number will vary — always take the latest). Click it.

   > If the page has changed and you can't find the download button, do a web search for `QuickBooks Web Connector download`. The first result should be an Intuit domain (`developer.intuit.com` or `quickbooks.intuit.com`). Do not download from any other site.

3. Save the installer file. It's called something like `QBWebConnectorInstaller.exe` and is roughly 5 MB.

4. Once downloaded, open your **Downloads** folder and double-click `QBWebConnectorInstaller.exe`.

5. Windows may show a security prompt asking *"Do you want to allow this app to make changes to your device?"* → Click **Yes**.

6. The installer opens. Click through:
   - Welcome screen → **Next**
   - License agreement → check *"I accept the terms"* → **Next**
   - Destination folder — leave as default → **Next**
   - Ready to install → **Install**
   - When it finishes → **Finish**

7. Web Connector is now installed. To launch it:
   - Click the Windows **Start** button
   - Type `QBWebConnector`
   - Click the app when it appears in search results

8. The QuickBooks Web Connector window opens. It's a small window with a list area (empty right now) and several buttons at the bottom: **Add an Application**, **Update Selected**, **Remove**, **Help**, **Hide**.

   Leave this window open. We'll add our app to it in Step 3.

---

## Step 3 — Add the Synergie app to Web Connector (5 min)

1. In the Web Connector window, click **Add an Application** (bottom right corner).

2. A file picker appears. Navigate to where Dan sent you the file. Look for `synergie-timesheet.qwc`. Click it → **Open**.

3. A dialog appears asking *"Authorize New Web Service"*. Read what it says (it will show "Synergie Timesheet App" and the URL). Click **OK**.

4. QuickBooks itself now pops up (in the background) with a security prompt titled something like *"QuickBooks — Application Certificate"*. It asks whether to allow this application to read and modify your company file.

   **Select these options:**
   - **Yes, always; allow access even if QuickBooks is not running**
   - Under "Login as", leave it on your current QuickBooks user
   - Check the box **Allow this application to access personal data such as Social Security Numbers and customer credit card information** (only if it appears — it depends on your QuickBooks version)

   Click **Continue** → the next screen shows a summary → click **Done**.

   > **Important:** if you accidentally clicked **No**, you can fix it. In QuickBooks: **Edit → Preferences → Integrated Applications → Company Preferences**. Find "Synergie Timesheet App" in the list, click **Properties**, and re-check *"Allow this application to log in automatically"* and *"Allow this application to access Social Security Numbers…"*. Then click OK.

5. Back in Web Connector, the Synergie Timesheet App now appears in the list with a checkbox next to it and columns for **Auto Run**, **Every_Min**, **Status**, etc.

6. In the same row, there's a **Password** field (or column). Click into it and paste the password Dan sent you. Press **Tab** or click elsewhere to confirm.

7. Web Connector asks *"Do you want to save this password?"* → click **Yes**. (If you click No, you'll have to re-enter it every 15 minutes.)

You're now set up. The row should show **Status: Ready** or similar.

---

## Step 4 — First sync test (5 min, together with Dan)

**Do this step with Dan on a phone/video call so he can watch what happens on his end.**

1. Make sure QuickBooks is still open with the **TEST** company file (check the title bar).

2. In Web Connector, click the checkbox next to Synergie Timesheet App if it isn't already checked.

3. Click **Update Selected** (the button at the bottom).

4. Web Connector will start talking to the Synergie app. You'll see the Status column change — first to *Connecting*, then *Running*, then *Done*.

5. What Dan will see on his end: a job move from *pending* to *done* in the sync queue. He'll confirm this out loud to you.

6. What you might see on your end:
   - **Green checkmark** or **"Update completed successfully"** → all good.
   - **"No work to do"** → the Synergie app didn't have anything queued for you. This is fine; it means the connection works.
   - **Red X** with an error message → note the exact wording, screenshot it if you can, and send to Dan. Common causes: password typo (redo Step 3.6), company file not open, wrong version of QuickBooks.

---

## Step 5 — What happens from here on

Once the first test works, Web Connector will run automatically **every 15 minutes** in the background. You don't have to do anything.

If Dan queues up bills or payments to be sent to QuickBooks, they'll appear in your QuickBooks the next time Web Connector runs — or immediately, if you click **Update Selected**.

**To leave Web Connector running:** just close the Web Connector window with the **Hide** button (bottom right). It keeps running in your system tray (the small icons near the clock). You'll see a small green Q icon there.

**To stop syncing temporarily:** open Web Connector, uncheck the box on the Synergie row. Re-check to resume.

**To quit Web Connector entirely:** right-click the system tray icon → **Exit**. Next time you want it to run, launch from the Start menu again.

---

## Switching from the test copy to the real company file

Once we're confident everything is working (probably later today or tomorrow), we switch to the real books:

1. In QuickBooks: **File → Close Company** to close the TEST file.
2. **File → Open or Restore Company → Open a company file → Next**, then open the **real** `Synergie Company.QBW`.
3. Sign in.
4. Back in Web Connector — this is important — **remove** the Synergie app from the list and re-add it:
   - Highlight the Synergie Timesheet App row → click **Remove**.
   - Click **Add an Application** again → select the same `synergie-timesheet.qwc` file.
   - You'll go through the QuickBooks permission prompt (Step 3.4) one more time — this time it's granting access to the real company file. Same answers as before.
   - Re-enter the password (Step 3.6).

The reason we re-add is because the permission grant is tied to a specific company file. Skipping this would mean Web Connector still points at the TEST copy.

---

## If something goes wrong

**Password rejected / "Invalid User Name and/or Password":**
- Re-check the password. It's case-sensitive. If you're pasting from a text message, make sure no invisible spaces snuck in at the start or end.
- If unsure, ask Dan to send it again. If still stuck, Dan can rotate the password in the app admin panel and give you the new one.

**"Cannot connect" or "Web service URL is not reachable":**
- Your internet connection is down, or a firewall is blocking `mimlatvdwxqtgxrgcins.supabase.co`. Ask IT to whitelist that domain.
- If you're on a home network, restart the router and try again.

**QuickBooks says the app doesn't have permission:**
- Open QuickBooks → **Edit → Preferences → Integrated Applications → Company Preferences**.
- Find "Synergie Timesheet App" in the list → click **Properties**.
- Re-check the permission boxes as described in Step 3.4.

**Web Connector shows other applications you don't recognise:**
- Ignore them. Web Connector can host many apps at once. Uncheck any you're not actively syncing with; leave the Synergie row checked.

**"You accidentally chose the wrong company file in Step 1":**
- Close QuickBooks. Delete the TEST copy from File Explorer. Start Step 1 again.

**Windows says "This program can't run on your PC":**
- The Web Connector installer might have been corrupted during download. Delete `QBWebConnectorInstaller.exe`, then re-download from the Intuit link in Step 2.

**Everything else, or Dan needs a screenshot to help you diagnose:** press **Windows + Shift + S** to open the screenshot tool, drag over the Web Connector window (or the error message), and it copies to your clipboard. Paste into an email to Dan.

---

## Reference: what's what

- **QuickBooks Desktop** — the accounting software you already use daily.
- **Company file (`.QBW`)** — your books. There's one for each business you keep books for.
- **QuickBooks Web Connector** — the Intuit-provided bridge program. Free.
- **`.qwc` file** — a small config file that tells Web Connector where the Synergie app lives and what credentials to use. Same file for every Synergie user; not sensitive.
- **The password** — the shared secret Web Connector sends when it authenticates with the Synergie app. Keep it in a password manager. Do not paste into unknown websites.
- **Synergie Timesheet App** — the web app at `time.mysynergie.net` where Dan and the team manage timesheets and invoices.
