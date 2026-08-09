const statusEl = document.getElementById("status");
const bookmarkSelectEl = document.getElementById("bookmarkSelect");
const editFeedUrlEl = document.getElementById("editFeedUrl");
const newFeedUrlEl = document.getElementById("newFeedUrl");
const bookmarkListEl = document.getElementById("bookmarkList");

let currentState = null;

document.getElementById("checkFeeds").addEventListener("click", async () => {
  setStatus("Checking feeds...");
  try {
    const result = await browser.runtime.sendMessage({ type: "check-feeds" });
    const lines = [
      `Checked: ${result.checked}`,
      `Updated: ${result.updated}`
    ];

    if (result.errors.length) {
      lines.push("");
      lines.push("Errors:");
      lines.push(...result.errors.slice(0, 10));
    }

    setStatus(lines.join("\n"));
    await refresh();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

document.getElementById("clearMarkers").addEventListener("click", async () => {
  setStatus("Clearing markers...");
  try {
    await browser.runtime.sendMessage({ type: "clear-all-markers" });
    setStatus("Markers cleared.");
    await refresh();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

document.getElementById("addCurrentSite").addEventListener("click", async () => {
  const feedUrl = newFeedUrlEl.value.trim();
  if (!feedUrl) {
    setStatus("Enter a feed URL first.");
    return;
  }

  setStatus("Adding current site...");
  try {
    const result = await browser.runtime.sendMessage({
      type: "add-current-site",
      feedUrl
    });
    setStatus(`Added: ${result.title}`);
    newFeedUrlEl.value = "";
    await refresh();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

document.getElementById("saveFeedUrl").addEventListener("click", async () => {
  const bookmarkId = bookmarkSelectEl.value;
  const feedUrl = editFeedUrlEl.value.trim();

  if (!bookmarkId) {
    setStatus("Select a bookmark.");
    return;
  }

  if (!feedUrl) {
    setStatus("Enter a feed URL.");
    return;
  }

  setStatus("Saving feed URL...");
  try {
    await browser.runtime.sendMessage({
      type: "save-feed",
      bookmarkId,
      feedUrl
    });
    setStatus("Feed URL saved.");
    await refresh();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

bookmarkSelectEl.addEventListener("change", () => {
  const bm = currentState?.bookmarks.find(b => b.id === bookmarkSelectEl.value);
  editFeedUrlEl.value = bm?.feedUrl || "";
});

async function refresh() {
  currentState = await browser.runtime.sendMessage({ type: "get-state" });
  renderBookmarks(currentState.bookmarks);
  renderSelect(currentState.bookmarks);
}

function renderSelect(bookmarks) {
  bookmarkSelectEl.innerHTML = "";

  if (!bookmarks.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "(No bookmarks in RSS Feeds folder)";
    bookmarkSelectEl.appendChild(option);
    editFeedUrlEl.value = "";
    return;
  }

  for (const bm of bookmarks) {
    const option = document.createElement("option");
    option.value = bm.id;
    option.textContent = bm.title;
    bookmarkSelectEl.appendChild(option);
  }

  const selected = bookmarks.find(b => b.id === bookmarkSelectEl.value) || bookmarks[0];
  bookmarkSelectEl.value = selected.id;
  editFeedUrlEl.value = selected.feedUrl || "";
}

function renderBookmarks(bookmarks) {
  bookmarkListEl.innerHTML = "";

  if (!bookmarks.length) {
    bookmarkListEl.textContent = "No bookmarks yet. Add a site from an open tab.";
    return;
  }

  for (const bm of bookmarks) {
    const div = document.createElement("div");
    div.className = "bookmark-item";

    const title = document.createElement("div");
    title.textContent = `${bm.marked ? "● " : ""}${bm.title}${bm.unread ? " (new)" : ""}`;

    const site = document.createElement("div");
    site.className = "small";
    site.textContent = `Site: ${bm.url}`;

    const feed = document.createElement("div");
    feed.className = "small";
    feed.textContent = `Feed: ${bm.feedUrl || "(not set)"}`;

    div.appendChild(title);
    div.appendChild(site);
    div.appendChild(feed);
    bookmarkListEl.appendChild(div);
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

refresh();
