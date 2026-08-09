const FEED_FOLDER_TITLE = "RSS Feeds";
const MARKER = "● ";

browser.runtime.onMessage.addListener((msg) => {
  switch (msg?.type) {
    case "get-state":
      return getPopupState();
    case "check-feeds":
      return checkFeedsOnce();
    case "save-feed":
      return saveFeedForBookmark(msg.bookmarkId, msg.feedUrl);
    case "add-current-site":
      return addCurrentSite(msg.feedUrl);
    case "clear-all-markers":
      return clearAllMarkers();
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  await clearMarkerIfVisited(tab.url);
});

async function getPopupState() {
  const bookmarks = await getFeedBookmarks();
  const feeds = await getFeedsStore();

  return {
    folderTitle: FEED_FOLDER_TITLE,
    bookmarks: bookmarks.map(bm => ({
      id: bm.id,
      title: stripMarker(bm.title),
      url: bm.url,
      marked: bm.title.startsWith(MARKER),
      feedUrl: feeds[bm.id]?.feedUrl || "",
      unread: !!feeds[bm.id]?.unread
    }))
  };
}

async function checkFeedsOnce() {
  const bookmarks = await getFeedBookmarks();
  const feeds = await getFeedsStore();

  let checked = 0;
  let updated = 0;
  const errors = [];

  for (const bm of bookmarks) {
    const cleanTitle = stripMarker(bm.title);
    const info = feeds[bm.id] || {
      siteUrl: bm.url,
      feedUrl: "",
      cleanTitle,
      lastSeenEntryId: null,
      unread: false
    };

    info.siteUrl = bm.url;
    info.cleanTitle = cleanTitle;

    if (!info.feedUrl) {
      errors.push(`${cleanTitle}: no feed URL saved`);
      feeds[bm.id] = info;
      continue;
    }

    try {
      const latestId = await fetchLatestEntryId(info.feedUrl);
      checked++;

      if (!latestId) {
        errors.push(`${cleanTitle}: could not find latest entry`);
        feeds[bm.id] = info;
        continue;
      }

      const firstRun = !info.lastSeenEntryId;
      const hasNew = !firstRun && latestId !== info.lastSeenEntryId;

      if (hasNew) {
        info.unread = true;
        updated++;
        await browser.bookmarks.update(bm.id, {
          title: MARKER + info.cleanTitle
        });
      }

      info.lastSeenEntryId = latestId;
      feeds[bm.id] = info;
    } catch (err) {
      errors.push(`${cleanTitle}: ${err.message}`);
      feeds[bm.id] = info;
    }
  }

  await setFeedsStore(feeds);

  return {
    checked,
    updated,
    errors
  };
}

async function saveFeedForBookmark(bookmarkId, feedUrl) {
  const bm = await browser.bookmarks.get(bookmarkId).then(items => items[0]);
  if (!bm || !bm.url) {
    throw new Error("Bookmark not found");
  }

  const feeds = await getFeedsStore();
  const cleanTitle = stripMarker(bm.title);

  feeds[bookmarkId] = {
    ...(feeds[bookmarkId] || {}),
    siteUrl: bm.url,
    feedUrl: feedUrl.trim(),
    cleanTitle,
    unread: !!feeds[bookmarkId]?.unread,
    lastSeenEntryId: feeds[bookmarkId]?.lastSeenEntryId || null
  };

  await setFeedsStore(feeds);
  return { ok: true };
}

async function addCurrentSite(feedUrl) {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    throw new Error("Current tab is not a normal web page");
  }

  const folder = await ensureFeedFolder();
  const title = tab.title || new URL(tab.url).hostname;

  const bm = await browser.bookmarks.create({
    parentId: folder.id,
    title,
    url: tab.url
  });

  const feeds = await getFeedsStore();
  feeds[bm.id] = {
    siteUrl: tab.url,
    feedUrl: feedUrl.trim(),
    cleanTitle: title,
    lastSeenEntryId: null,
    unread: false
  };

  await setFeedsStore(feeds);

  return {
    ok: true,
    bookmarkId: bm.id,
    title,
    siteUrl: tab.url
  };
}

async function clearAllMarkers() {
  const bookmarks = await getFeedBookmarks();
  const feeds = await getFeedsStore();

  for (const bm of bookmarks) {
    const info = feeds[bm.id];
    if (!info) continue;

    info.unread = false;
    await browser.bookmarks.update(bm.id, {
      title: info.cleanTitle || stripMarker(bm.title)
    });
    feeds[bm.id] = info;
  }

  await setFeedsStore(feeds);
  return { ok: true };
}

async function clearMarkerIfVisited(url) {
  const bookmarks = await getFeedBookmarks();
  const feeds = await getFeedsStore();
  let changed = false;

  for (const bm of bookmarks) {
    const info = feeds[bm.id];
    if (!info || !info.unread) continue;

    if (sameUrl(url, bm.url)) {
      info.unread = false;
      await browser.bookmarks.update(bm.id, {
        title: info.cleanTitle || stripMarker(bm.title)
      });
      feeds[bm.id] = info;
      changed = true;
    }
  }

  if (changed) {
    await setFeedsStore(feeds);
  }
}

async function ensureFeedFolder() {
  const matches = await browser.bookmarks.search({ title: FEED_FOLDER_TITLE });
  let folder = matches.find(item => !item.url);

  if (!folder) {
    const toolbar = await browser.bookmarks.getToolbar();
    folder = await browser.bookmarks.create({
      parentId: toolbar.id,
      title: FEED_FOLDER_TITLE
    });
  }

  return folder;
}

async function getFeedBookmarks() {
  const folder = await ensureFeedFolder();
  const children = await browser.bookmarks.getChildren(folder.id);
  return children.filter(item => !!item.url);
}

async function getFeedsStore() {
  const data = await browser.storage.local.get("feeds");
  return data.feeds || {};
}

async function setFeedsStore(feeds) {
  await browser.storage.local.set({ feeds });
}

async function fetchLatestEntryId(feedUrl) {
  const res = await fetch(feedUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();
  const xml = new DOMParser().parseFromString(text, "application/xml");

  if (xml.querySelector("parsererror")) {
    throw new Error("Invalid XML");
  }

  const atomEntry = xml.querySelector("feed > entry");
  if (atomEntry) {
    return (
      atomEntry.querySelector("id")?.textContent?.trim() ||
      atomEntry.querySelector("link")?.getAttribute("href") ||
      atomEntry.querySelector("title")?.textContent?.trim() ||
      null
    );
  }

  const rssItem = xml.querySelector("channel > item");
  if (rssItem) {
    return (
      rssItem.querySelector("guid")?.textContent?.trim() ||
      rssItem.querySelector("link")?.textContent?.trim() ||
      rssItem.querySelector("title")?.textContent?.trim() ||
      null
    );
  }

  return null;
}

function stripMarker(title) {
  return title.startsWith(MARKER) ? title.slice(MARKER.length) : title;
}

function sameUrl(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.href === ub.href;
  } catch {
    return a === b;
  }
}
