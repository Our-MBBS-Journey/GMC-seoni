/* Our MBBS Journey — Supabase powered private memory archive */
const { createClient } = window.supabase;
const cfg = window.APP_CONFIG || {};
const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_");
const sb = configured ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
const $ = id => document.getElementById(id);

let user = null, profile = null, currentCategory = "All", adminTab = "pending";
let memories = [], allProfiles = [], allFriends = [];
let notifications = [];
let notificationChannel = null;
let friendsSlideTimer = null;

const show = (el, yes = true) => el.classList.toggle("hidden", !yes);

const escapeHTML = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

function notice(msg) {
  $("notice").textContent = msg;
  show($("notice"), !!msg);
}

function dateFmt(v) {
  if (!v) return "Date not added";
  try {
    return new Date(v + "T00:00:00").toLocaleDateString(undefined, {
      day: "numeric", month: "short", year: "numeric"
    });
  } catch { return v; }
}

function mediaMarkup(m, small = false) {
  const url = m.public_url || "";
  return m.media_type === "video"
    ? `<video class="${small ? "admin-thumb" : "memory-media"}" ${small ? "" : "controls"} preload="metadata" src="${url}"></video>`
    : `<img class="${small ? "admin-thumb" : "memory-media"}" loading="lazy" src="${url}" alt="${escapeHTML(m.caption)}">`;
}

/* NOTIFICATION UI */
function setupNotificationUI() {
  if ($("notification-area")) return;

  const topActions = document.querySelector(".top-actions");
  if (!topActions) {
    console.warn("Notification area could not find .top-actions");
    return;
  }

  const area = document.createElement("div");
  area.id = "notification-area";
  area.className = "notification-area";

  area.innerHTML = `
    <button type="button" id="notification-bell" class="notification-bell" aria-label="Notifications">
      🔔
      <span id="notification-badge" class="notification-badge hidden">0</span>
    </button>

    <div id="notification-dropdown" class="notification-dropdown hidden">
      <div class="notification-heading">
        <strong>Notifications</strong>
        <button type="button" id="mark-all-read">Mark all read</button>
      </div>
      <div id="notification-list" class="notification-list">
        <div class="notification-empty">Loading notifications...</div>
      </div>
    </div>
  `;

  topActions.insertBefore(area, topActions.firstChild);

  $("notification-bell").onclick = async e => {
    e.stopPropagation();
    const dropdown = $("notification-dropdown");
    const opening = dropdown.classList.contains("hidden");
    show(dropdown, opening);

    if (opening) await loadNotifications();
  };

  $("mark-all-read").onclick = markAllNotificationsRead;

  $("notification-list").onclick = async e => {
    const item = e.target.closest("[data-notification-id]");
    if (!item) return;
    await markNotificationRead(item.dataset.notificationId);
  };

  document.addEventListener("click", e => {
    if (!area.contains(e.target)) {
      show($("notification-dropdown"), false);
    }
  });
}

/* LOAD NOTIFICATIONS — independent of likes/comments */
async function loadNotifications() {
  if (!user) return;
  const list = $("notification-list");
  if (!list) return;

  const { data, error } = await sb.from("notifications")
    .select("*")
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Notification load error:", error);
    list.innerHTML = '<div class="notification-empty">Could not load notifications.</div>';
    return;
  }

  notifications = data || [];
  const unread = notifications.filter(n => !n.is_read).length;
  const badge = $("notification-badge");
  badge.textContent = unread > 99 ? "99+" : unread;
  show(badge, unread > 0);

  if (!notifications.length) {
    list.innerHTML = '<div class="notification-empty">No notifications yet 🔔</div>';
    return;
  }

  list.innerHTML = notifications.map(n => `
    <div class="notification-item ${n.is_read ? "" : "unread"}" data-notification-id="${n.id}">
      <div class="notification-message">🔔 ${escapeHTML(n.message || "You have a new update in Our MBBS Journey.")}</div>
      <small>${escapeHTML(new Date(n.created_at).toLocaleString())}</small>
      ${n.is_read ? "" : '<span class="notification-unread-label">New</span>'}
    </div>
  `).join("");
}

/* MARK ONE NOTIFICATION READ */
async function markNotificationRead(id) {
  const { error } = await sb.from("notifications")
    .update({ is_read: true })
    .eq("id", id)
    .eq("recipient_id", user.id);

  if (error) {
    console.error(error);
    return toast("Could not update notification.");
  }

  await loadNotifications();
}

/* MARK ALL NOTIFICATIONS READ */
async function markAllNotificationsRead() {
  const { error } = await sb.from("notifications")
    .update({ is_read: true })
    .eq("recipient_id", user.id)
    .eq("is_read", false);

  if (error) {
    console.error(error);
    return toast("Could not mark notifications as read.");
  }

  await loadNotifications();
  toast("All notifications marked as read.");
}

/* REALTIME NOTIFICATION UPDATES */
function startNotificationRealtime() {
  if (notificationChannel) {
    sb.removeChannel(notificationChannel);
    notificationChannel = null;
  }

  notificationChannel = sb.channel("notifications-" + user.id)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "notifications",
      filter: `recipient_id=eq.${user.id}`
    }, async () => {
      await loadNotifications();
      toast("You have a new notification 🔔");
    })
    .subscribe();
}
/* AUTHENTICATION */
function setAuthTab(tab) {
  document.querySelectorAll(".tab").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  show($("signup-extra"), tab === "signup");
  $("auth-submit").textContent = tab === "signup" ? "Create account" : "Sign in";
  $("auth-message").textContent = "";
}

document.querySelectorAll(".tab").forEach(b =>
  b.onclick = () => setAuthTab(b.dataset.tab)
);

$("auth-form").addEventListener("submit", async e => {
  e.preventDefault();

  if (!sb) {
    $("auth-message").textContent = "Setup required: add Supabase URL and anon key in config.js.";
    return;
  }

  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  $("auth-submit").disabled = true;

  try {
    let result;

    if (document.querySelector(".tab.active").dataset.tab === "signup") {
      result = await sb.auth.signUp({
        email,
        password,
        options: { data: { full_name: $("auth-name").value.trim() } }
      });

      if (result.error) throw result.error;

      $("auth-message").textContent = "Account created! Check your email if confirmation is enabled. Admin must grant access.";
      toast("Account created");
    } else {
      result = await sb.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
    }
  } catch (err) {
    $("auth-message").textContent = err.message || "Could not sign in";
  } finally {
    $("auth-submit").disabled = false;
  }
});

$("logout-btn").onclick = async () => {
  if (notificationChannel) {
    await sb.removeChannel(notificationChannel);
    notificationChannel = null;
  }
  await sb?.auth.signOut();
  location.reload();
};

/* UPLOAD */
$("open-upload").onclick = () => {
  if (!profile?.can_upload) {
    toast("Your account doesn't have upload permission yet.");
    return;
  }
  show($("upload-modal"));
};

$("close-upload").onclick = () => show($("upload-modal"), false);

$("upload-modal").onclick = e => {
  if (e.target === $("upload-modal")) show($("upload-modal"), false);
};

$("upload-form").addEventListener("submit", uploadFiles);

$("upload-files").onchange = () => {
  $("upload-progress").textContent = `${$("upload-files").files.length} file(s) selected`;
};

/* GALLERY NAVIGATION */
$("category-nav").onclick = e => {
  const b = e.target.closest("[data-category]");
  if (!b) return;

  currentCategory = b.dataset.category;

  document.querySelectorAll(".category").forEach(x =>
    x.classList.toggle("active", x === b)
  );

  renderGallery();
};

$("search-input").oninput = renderGallery;

$("lightbox-close").onclick = () => show($("lightbox"), false);

$("lightbox").onclick = e => {
  if (e.target === $("lightbox")) show($("lightbox"), false);
};

function openLightbox(m) {
  $("lightbox-content").innerHTML = m.media_type === "video"
    ? `<video controls autoplay src="${m.public_url}"></video>`
    : `<img src="${m.public_url}" alt="">`;

  $("lightbox-caption").textContent = m.caption || "";
  show($("lightbox"));
}

/* LOGIN SESSION */
async function boot() {
  if (!sb) {
    show($("auth-view"));
    $("auth-message").textContent = "Before use, connect your Supabase project in config.js. Setup guide is included in the ZIP.";
    return;
  }

  const { data: { session } } = await sb.auth.getSession();

  if (session) await enterApp(session.user);

  sb.auth.onAuthStateChange(async (event, session) => {
    // getSession() above already handled the current session. Supabase emits
    // INITIAL_SESSION when this listener is attached; skipping it prevents
    // the same dashboard data from being loaded twice during startup.
    if (event === "INITIAL_SESSION") return;

    if (session) {
      await enterApp(session.user);
    } else {
      user = null;
      profile = null;

      if (friendsSlideTimer) {
        clearInterval(friendsSlideTimer);
        friendsSlideTimer = null;
      }

      if (notificationChannel) {
        await sb.removeChannel(notificationChannel);
        notificationChannel = null;
      }

      show($("app-view"), false);
      show($("auth-view"));
      show($("logout-btn"), false);
    }
  });
}

async function enterApp(u) {
  user = u;

  show($("auth-view"), false);
  show($("app-view"));
  show($("logout-btn"));
  notice("Loading your private memories...");

  const { data: p, error } = await sb.from("profiles")
    .select("*")
    .eq("id", u.id)
    .maybeSingle();

  profile = p;

  if (error) console.warn(error);

  $("user-label").textContent = p?.full_name || u.email;

  if (!p || !p.is_approved) {
    notice("Your account is awaiting access approval. Ask the project admin to approve your profile.");
    show($("open-upload"), false);
    show($("admin-panel"), false);
    $("gallery").innerHTML = '<div class="empty-state">Your private circle will appear here after approval.</div>';
    return;
  }

  notice(p.can_upload
    ? "You have upload access. New uploads are reviewed before appearing in the gallery."
    : "Welcome! Browse the memories shared by our circle.");

  show($("open-upload"), p.can_upload);
  show($("admin-panel"), p.is_admin);

  setupNotificationUI();
  startNotificationRealtime();

  // These reads are independent, so run them together instead of waiting
  // for each network request to finish one by one.
  const initialLoads = [
    loadNotifications(),
    loadMemories(),
    loadVisibleFriends()
  ];
  if (p.is_admin) initialLoads.push(loadAdmin());
  await Promise.allSettled(initialLoads);
}

/* LOAD APPROVED MEMORIES ONLY */
async function loadMemories() {
  const { data, error } = await sb.from("memories")
    .select("*")
    .eq("status", "approved")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    notice("Could not load gallery: " + error.message);
    return;
  }
  memories = data || [];
  renderGallery();
}

/* GALLERY — photos/videos only; no like or comment controls */
function renderGallery() {
  const q = ($("search-input")?.value || "").toLowerCase();
  const list = memories.filter(m =>
    (currentCategory === "All" || m.category === currentCategory) &&
    (`${m.caption || ""} ${m.category || ""} ${m.uploader_name || ""}`.toLowerCase().includes(q))
  );

  $("gallery-count").textContent = `${list.length} ${list.length === 1 ? "memory" : "memories"}`;
  if (!list.length) {
    $("gallery").innerHTML = '<div class="empty-state">No approved memories here yet. The best ones are still waiting to be shared ✨</div>';
    return;
  }

  $("gallery").innerHTML = list.map(m => `
    <article class="memory-card">
      ${mediaMarkup(m)}
      <div class="memory-info">
        <div class="memory-caption" title="${escapeHTML(m.caption || "")}">${escapeHTML(m.caption || "Untitled memory")}</div>
        <div class="memory-meta">
          <span>${escapeHTML(m.category || "Memory")} · ${dateFmt(m.memory_date)}</span>
          <span>${escapeHTML(m.uploader_name || "Batch memory")}</span>
        </div>
      </div>
    </article>
  `).join("");

  $("gallery").querySelectorAll(".memory-media").forEach((el, i) => {
    el.onclick = () => openLightbox(list[i]);
  });
}

/* UPLOAD FILES */
async function uploadFiles(e) {
  e.preventDefault();

  if (!profile?.can_upload) {
    return toast("Upload permission is not enabled for your account.");
  }

  const files = $("upload-files").files;
  if (!files.length) return;

  const caption = $("upload-caption").value.trim();
  const category = $("upload-category").value;
  const date = $("upload-date").value || null;

  $("upload-progress").textContent = "Uploading… please keep this page open.";

  const submit = $("upload-form").querySelector("button[type=submit]");
  submit.disabled = true;

  try {
    for (const f of files) {
      if (f.size > 50 * 1024 * 1024) {
        throw new Error(`${f.name} exceeds 50 MB.`);
      }

      if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {
        throw new Error("Only image/video files are allowed.");
      }

      const path = `${user.id}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, "_")}`;

      const { error: upErr } = await sb.storage.from("journey-media")
        .upload(path, f, { upsert: false });

      if (upErr) throw upErr;

      const { data: { publicUrl } } = sb.storage.from("journey-media").getPublicUrl(path);

      const { error: dbErr } = await sb.from("memories").insert({
        caption,
        category,
        memory_date: date,
        storage_path: path,
        public_url: publicUrl,
        media_type: f.type.startsWith("video/") ? "video" : "image",
        status: "pending",
        uploader_id: user.id,
        uploader_name: profile.full_name || user.email
      });

      if (dbErr) throw dbErr;
    }

    $("upload-progress").textContent = "Submitted! Your memory is awaiting admin approval.";
    toast("Sent for approval ✨");
    $("upload-form").reset();
    show($("upload-modal"), false);

    if (profile.is_admin) await loadAdmin();

  } catch (err) {
    $("upload-progress").textContent = err.message || "Upload failed. Check Storage setup.";
  } finally {
    submit.disabled = false;
  }
}
/* ADMIN DASHBOARD */
async function loadAdmin() {
  // Admin sections use separate tables, so fetch them concurrently.
  const adminLoads = [loadPending(), loadMembers()];
  if (adminTab === "friends") adminLoads.push(loadFriendsAdmin());
  await Promise.allSettled(adminLoads);
}

document.querySelectorAll("[data-admin-tab]").forEach(b => b.onclick = async () => {
  adminTab = b.dataset.adminTab;

  document.querySelectorAll(".admin-tab").forEach(x =>
    x.classList.toggle("active", x === b)
  );

  if (adminTab === "friends") await loadFriendsAdmin();
  else renderAdminTab();
});

async function loadPending() {
  const { data, error } = await sb.from("memories")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  window.pendingMemories = data || [];
  $("pending-count").textContent = window.pendingMemories.length;
  renderAdminTab();
}

async function loadMembers() {
  const { data, error } = await sb.from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  allProfiles = data || [];
  renderAdminTab();
}

function renderAdminTab() {
  const root = $("admin-content");

  if (adminTab === "pending") {
    const list = window.pendingMemories || [];

    root.innerHTML = list.length ? list.map(m => `
      <div class="admin-row">
        ${mediaMarkup(m, true)}
        <div class="admin-row-main">
          <strong>${escapeHTML(m.caption)}</strong>
          <small>${escapeHTML(m.category)} · by ${escapeHTML(m.uploader_name || "member")}</small>
        </div>
        <button class="btn btn-sm btn-approve" data-approve="${m.id}">Approve</button>
        <button class="btn btn-sm btn-danger" data-reject="${m.id}">Reject</button>
      </div>
    `).join("") : '<div class="empty-state">All caught up! No pending uploads.</div>';

  } else if (adminTab === "friends") {
    root.innerHTML = `
      <div class="friends-admin">
        <h3>Add a friend to the slideshow</h3>
        <form id="friend-form" class="friend-admin-form">
          <label>Friend's name<input id="friend-name" type="text" maxlength="100" required placeholder="Full name"></label>
          <label>Place<input id="friend-place" type="text" maxlength="150" placeholder="City / hometown"></label>
          <label>Date of birth<input id="friend-dob" type="date"></label>
          <label>Profile photo<input id="friend-photo" type="file" accept="image/*" required></label>
          <button class="btn btn-primary" type="submit">Add friend</button>
          <p id="friend-message" class="message"></p>
        </form>
        <h3>Friends profiles</h3>
        <div id="friends-admin-list">
          ${allFriends.length ? allFriends.map(f => `
            <div class="admin-row">
              <img class="admin-thumb" src="${escapeHTML(f.photo_url || "")}" alt="">
              <div class="admin-row-main">
                <strong>${escapeHTML(f.name)}</strong>
                <small>${escapeHTML(f.place || "Place not added")} · DOB: ${dateFmt(f.dob)}</small>
                <small>${f.is_visible ? "Visible in slideshow" : "Hidden / awaiting approval"}</small>
              </div>
              <button class="btn btn-sm btn-neutral" data-friend-toggle="${f.id}" data-value="${f.is_visible}">${f.is_visible ? "Hide" : "Approve & show"}</button>
              <button class="btn btn-sm btn-danger" data-friend-delete="${f.id}">Delete</button>
            </div>
          `).join("") : '<div class="empty-state">No friends added yet.</div>'}
        </div>
      </div>
    `;
    const friendForm = $("friend-form");
    if (friendForm) friendForm.onsubmit = addFriend;
    root.querySelectorAll("[data-friend-toggle]").forEach(b =>
      b.onclick = () => toggleFriendVisibility(b.dataset.friendToggle, b.dataset.value !== "true")
    );
    root.querySelectorAll("[data-friend-delete]").forEach(b =>
      b.onclick = () => deleteFriend(b.dataset.friendDelete)
    );
  } else {
    root.innerHTML = allProfiles.map(p => `
      <div class="admin-row">
        <div class="admin-thumb member-avatar">${escapeHTML((p.full_name || p.email || "?").slice(0, 1).toUpperCase())}</div>
        <div class="admin-row-main">
          <strong>${escapeHTML(p.full_name || "No name")} ${p.is_admin ? '<span class="admin-chip">Admin</span>' : ""}</strong>
          <small>${escapeHTML(p.email || "")} · ${p.is_approved ? "Approved" : "Awaiting approval"} · ${p.can_upload ? "Upload enabled" : "Upload disabled"}</small>
        </div>
        ${!p.is_approved ? `<button class="btn btn-sm btn-approve" data-member-approve="${p.id}">Approve</button>` : ""}
        ${p.id !== user.id && !p.is_admin ? `
          <button class="btn btn-sm btn-neutral" data-toggle-upload="${p.id}" data-value="${p.can_upload}">${p.can_upload ? "Revoke upload" : "Allow upload"}</button>
          <button class="btn btn-sm btn-danger" data-member-revoke="${p.id}">Remove</button>
        ` : ""}
      </div>
    `).join("");
  }

  root.querySelectorAll("[data-approve]").forEach(b =>
    b.onclick = () => changeMemory(b.dataset.approve, "approved")
  );

  root.querySelectorAll("[data-reject]").forEach(b =>
    b.onclick = () => changeMemory(b.dataset.reject, "rejected")
  );

  root.querySelectorAll("[data-member-approve]").forEach(b =>
    b.onclick = () => changeProfile(b.dataset.memberApprove, { is_approved: true })
  );

  root.querySelectorAll("[data-toggle-upload]").forEach(b =>
    b.onclick = () => changeProfile(b.dataset.toggleUpload, {
      can_upload: b.dataset.value !== "true"
    })
  );

  root.querySelectorAll("[data-member-revoke]").forEach(b =>
    b.onclick = () => removeMember(b.dataset.memberRevoke)
  );
}


/* FRIENDS MANAGEMENT + APPROVED HORIZONTAL AUTO-SLIDER */
async function loadVisibleFriends() {
  const slider = document.querySelector(".friends-slider");
  if (!slider || !user || !profile?.is_approved) return;

  // Stop the previous auto-scroll before refreshing the approved friends list.
  if (friendsSlideTimer) {
    clearInterval(friendsSlideTimer);
    friendsSlideTimer = null;
  }

  // Add slider styling from JS so no separate CSS-file change is required.
  if (!document.getElementById("friends-horizontal-slider-style")) {
    const style = document.createElement("style");
    style.id = "friends-horizontal-slider-style";
    style.textContent = `
      .friends-slider {
        display: flex !important;
        flex-direction: row !important;
        flex-wrap: nowrap !important;
        gap: 14px !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        scroll-behavior: smooth !important;
        scroll-snap-type: x mandatory;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        padding: 6px 2px 14px;
        touch-action: pan-x pan-y;
      }
      .friends-slider::-webkit-scrollbar { display: none; }
      .friends-slider .friend-card {
        display: block !important;
        flex: 0 0 clamp(210px, 78%, 270px) !important;
        min-width: 0;
        scroll-snap-align: start;
      }
      @media (min-width: 700px) {
        .friends-slider .friend-card { flex-basis: 240px !important; }
      }
    `;
    document.head.appendChild(style);
  }

  const { data, error } = await sb.from("friends")
    .select("id,name,place,dob,photo_url,is_visible")
    .eq("is_visible", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Friends slider could not load:", error);
    slider.innerHTML = '<div class="empty-state">Friends could not be loaded.</div>';
    return;
  }

  const friends = data || [];
  slider.innerHTML = friends.length ? friends.map(f => `
    <article class="friend-card">
      <img src="${escapeHTML(f.photo_url || "")}" alt="${escapeHTML(f.name)}" loading="lazy">
      <h3>${escapeHTML(f.name)}</h3>
      <p>${escapeHTML(f.place || "Place not added")}</p>
      <small>DOB: ${dateFmt(f.dob)}</small>
    </article>
  `).join("") : '<div class="empty-state">Approved friends will appear here ❤️</div>';

  // Keep every approved friend's card visible in one horizontal row.
  // On phones, the row glides sideways automatically; users can also swipe it.
  const cards = Array.from(slider.querySelectorAll(".friend-card"));
  slider.scrollLeft = 0;
  if (cards.length < 2) return;

  const startAutoScroll = () => {
    if (friendsSlideTimer) clearInterval(friendsSlideTimer);
    friendsSlideTimer = setInterval(() => {
      const firstCard = slider.querySelector(".friend-card");
      if (!firstCard) return;
      const styles = window.getComputedStyle(slider);
      const gap = parseFloat(styles.columnGap || styles.gap) || 14;
      const step = firstCard.getBoundingClientRect().width + gap;
      const atEnd = slider.scrollLeft + slider.clientWidth >= slider.scrollWidth - 8;
      slider.scrollTo({ left: atEnd ? 0 : slider.scrollLeft + step, behavior: "smooth" });
    }, 2800);
  };

  // Pause while a person is swiping, then resume when they release the slider.
  if (slider.dataset.autoScrollEvents !== "ready") {
    slider.addEventListener("pointerdown", () => {
      if (friendsSlideTimer) {
        clearInterval(friendsSlideTimer);
        friendsSlideTimer = null;
      }
    });
    slider.addEventListener("pointerup", startAutoScroll);
    slider.addEventListener("pointercancel", startAutoScroll);
    slider.dataset.autoScrollEvents = "ready";
  }
  startAutoScroll();
}

async function loadFriendsAdmin() {
  const { data, error } = await sb.from("friends")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Friends load error:", error);
    $("admin-content").innerHTML = `<div class="empty-state">Could not load friends: ${escapeHTML(error.message)}</div>`;
    return;
  }
  allFriends = data || [];
  renderAdminTab();
}

async function addFriend(e) {
  e.preventDefault();
  if (!profile?.is_admin) return toast("Admin access required.");

  const name = $("friend-name").value.trim();
  const place = $("friend-place").value.trim();
  const dob = $("friend-dob").value || null;
  const file = $("friend-photo").files[0];
  const message = $("friend-message");
  const submit = $("friend-form").querySelector('button[type="submit"]') ||
                 $("friend-form").querySelector("button");
  if (!name || !file) return;
  if (!file.type.startsWith("image/")) {
    message.textContent = "Please choose an image file.";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    message.textContent = "Photo must be 10 MB or smaller.";
    return;
  }

  submit.disabled = true;
  message.textContent = "Uploading photo…";
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const path = `${user.id}/friends/${Date.now()}-${safeName}`;

  try {
    const { error: uploadError } = await sb.storage.from("journey-media")
      .upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;

    const { data: urlData } = sb.storage.from("journey-media").getPublicUrl(path);
    const { error: insertError } = await sb.from("friends").insert({
      name, place, dob,
      photo_url: urlData.publicUrl,
      photo_path: path,
      is_visible: false
    });
    if (insertError) {
      await sb.storage.from("journey-media").remove([path]);
      throw insertError;
    }

    toast("Friend added. Approve to show in slideshow.");
    await loadFriendsAdmin();
  } catch (err) {
    console.error("Add friend error:", err);
    message.textContent = err.message || "Could not add friend.";
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function toggleFriendVisibility(id, visible) {
  const { error } = await sb.from("friends")
    .update({ is_visible: visible })
    .eq("id", id);
  if (error) return toast("Friend update failed: " + error.message);
  toast(visible ? "Friend approved for slideshow." : "Friend hidden.");
  await loadFriendsAdmin();
  await loadVisibleFriends();
}

async function deleteFriend(id) {
  const friend = allFriends.find(f => f.id === id);
  if (!friend) return;
  if (!confirm(`Delete ${friend.name}'s profile?`)) return;

  const { error } = await sb.from("friends").delete().eq("id", id);
  if (error) return toast("Delete failed: " + error.message);

  if (friend.photo_path) {
    const { error: storageError } = await sb.storage.from("journey-media").remove([friend.photo_path]);
    if (storageError) console.warn("Photo file could not be removed:", storageError);
  }
  toast("Friend profile deleted.");
  await loadFriendsAdmin();
  await loadVisibleFriends();
}

async function changeMemory(id, status) {
  const { error } = await sb.from("memories").update({
    status,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString()
  }).eq("id", id);

  if (error) return toast(error.message);

  toast(status === "approved" ? "Memory published!" : "Upload rejected.");

  await loadPending();
  await loadMemories();
}

async function changeProfile(id, patch) {
  const { error } = await sb.from("profiles")
    .update(patch)
    .eq("id", id);

  if (error) return toast(error.message);

  toast("Member settings updated");
  await loadMembers();
}

async function removeMember(id) {
  if (!confirm("Remove this member's access? Their account will no longer be approved.")) return;

  const { error } = await sb.from("profiles")
    .update({ is_approved: false, can_upload: false })
    .eq("id", id);

  if (error) return toast(error.message);

  toast("Member access revoked");
  await loadMembers();
}

boot();
