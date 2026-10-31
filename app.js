/* Our MBBS Journey — Supabase powered private memory archive */
const { createClient } = window.supabase;
const cfg = window.APP_CONFIG || {};
const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_");
const sb = configured ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
const $ = id => document.getElementById(id);

let user = null, profile = null, currentCategory = "All", adminTab = "pending";
let memories = [], allProfiles = [];
let likesByMemory = {}, commentsByMemory = {};
let notifications = [];
let notificationChannel = null;

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

/* LOAD NOTIFICATIONS */
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

  const actorIds = [...new Set(notifications.map(n => n.actor_id))];
  const memoryIds = [...new Set(notifications.map(n => n.memory_id))];
  const commentIds = [...new Set(notifications.filter(n => n.comment_id).map(n => n.comment_id))];

  let names = {};
  let captions = {};
  let commentTexts = {};

  if (actorIds.length) {
    const { data: people, error: peopleError } = await sb.from("profiles")
      .select("id,full_name")
      .in("id", actorIds);

    if (peopleError) console.warn("Notification names:", peopleError);

    (people || []).forEach(p => {
      names[p.id] = p.full_name || "Member";
    });
  }

  if (memoryIds.length) {
    const { data: memoryData, error: memoryError } = await sb.from("memories")
      .select("id,caption")
      .in("id", memoryIds);

    if (memoryError) console.warn("Notification memories:", memoryError);

    (memoryData || []).forEach(m => {
      captions[m.id] = m.caption || "Memory";
    });
  }

  if (commentIds.length) {
    const { data: commentData, error: commentError } = await sb.from("memory_comments")
      .select("id,comment")
      .in("id", commentIds);

    if (commentError) console.warn("Notification comments:", commentError);

    (commentData || []).forEach(c => {
      commentTexts[c.id] = c.comment || "";
    });
  }

  list.innerHTML = notifications.map(n => {
    const actor = names[n.actor_id] || "A member";
    const memory = captions[n.memory_id] || "a memory";
    const comment = commentTexts[n.comment_id] || "";

    const message = n.type === "like"
      ? `<b>${escapeHTML(actor)}</b> liked your memory <b>${escapeHTML(memory)}</b>`
      : `<b>${escapeHTML(actor)}</b> commented on <b>${escapeHTML(memory)}</b>${comment ? `<p class="notification-comment">${escapeHTML(comment)}</p>` : ""}`;

    const time = new Date(n.created_at).toLocaleString();

    return `
      <div class="notification-item ${n.is_read ? "" : "unread"}"
           data-notification-id="${n.id}">
        <div class="notification-message">
          ${n.type === "like" ? "❤️" : "💬"} ${message}
        </div>
        <small>${escapeHTML(time)}</small>
        ${n.is_read ? "" : '<span class="notification-unread-label">New</span>'}
      </div>
    `;
  }).join("");
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

  sb.auth.onAuthStateChange(async (_event, session) => {
    if (session) {
      await enterApp(session.user);
    } else {
      user = null;
      profile = null;

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
  await loadNotifications();
  startNotificationRealtime();

  await loadMemories();

  if (p.is_admin) await loadAdmin();
}

/* LOAD APPROVED MEMORIES */
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
  await loadMemoryInteractions();
  renderGallery();
}

/* LOAD LIKES AND COMMENTS FOR GALLERY */
async function loadMemoryInteractions() {
  likesByMemory = {};
  commentsByMemory = {};

  const ids = memories.map(m => m.id);
  if (!ids.length) return;

  const [likesResult, commentsResult] = await Promise.all([
    sb.from("memory_likes")
      .select("memory_id,user_id")
      .in("memory_id", ids),

    sb.from("memory_comments")
      .select("id,memory_id,user_id,comment,created_at")
      .in("memory_id", ids)
      .order("created_at", { ascending: true })
  ]);

  if (likesResult.error) console.error("Likes load error:", likesResult.error);
  if (commentsResult.error) console.error("Comments load error:", commentsResult.error);

  (likesResult.data || []).forEach(like => {
    if (!likesByMemory[like.memory_id]) {
      likesByMemory[like.memory_id] = { count: 0, mine: false };
    }

    likesByMemory[like.memory_id].count++;

    if (like.user_id === user.id) {
      likesByMemory[like.memory_id].mine = true;
    }
  });

  const comments = commentsResult.data || [];
  const commenterIds = [...new Set(comments.map(c => c.user_id))];

  let names = {};

  if (commenterIds.length) {
    const { data: people, error: peopleError } = await sb.from("profiles")
      .select("id,full_name")
      .in("id", commenterIds);

    if (peopleError) console.warn("Comment names could not be loaded:", peopleError);

    (people || []).forEach(p => {
      names[p.id] = p.full_name || "Member";
    });
  }

  comments.forEach(c => {
    if (!commentsByMemory[c.memory_id]) commentsByMemory[c.memory_id] = [];

    commentsByMemory[c.memory_id].push({
      ...c,
      displayName: names[c.user_id] || (c.user_id === user.id ? (profile?.full_name || "You") : "Member")
    });
  });
}

/* RENDER GALLERY WITH LIKE AND COMMENT */
function renderGallery() {
  const q = $("search-input").value.toLowerCase();

  const list = memories.filter(m =>
    (currentCategory === "All" || m.category === currentCategory) &&
    (`${m.caption} ${m.category} ${m.uploader_name || ""}`.toLowerCase().includes(q))
  );

  $("gallery-count").textContent = `${list.length} ${list.length === 1 ? "memory" : "memories"}`;

  if (!list.length) {
    $("gallery").innerHTML = '<div class="empty-state">No memories here yet. The best ones are still waiting to be shared ✨</div>';
    return;
  }

  $("gallery").innerHTML = list.map(m => {
    const likeInfo = likesByMemory[m.id] || { count: 0, mine: false };
    const comments = commentsByMemory[m.id] || [];

    const commentHTML = comments.length
      ? comments.map(c => `
          <div class="memory-comment">
            <strong>${escapeHTML(c.displayName)}</strong>
            <p>${escapeHTML(c.comment)}</p>
          </div>
        `).join("")
      : '<div class="no-comments">No comments yet. Start the conversation!</div>';

    return `
      <article class="memory-card">
        ${mediaMarkup(m)}
        <div class="memory-info">
          <div class="memory-caption" title="${escapeHTML(m.caption)}">${escapeHTML(m.caption)}</div>

          <div class="memory-meta">
            <span>${escapeHTML(m.category)} · ${dateFmt(m.memory_date)}</span>
            <span>${escapeHTML(m.uploader_name || "Batch memory")}</span>
          </div>

          <div class="memory-social">
            <button type="button" class="like-btn ${likeInfo.mine ? "liked" : ""}" data-like="${m.id}">
              ${likeInfo.mine ? "❤️ Liked" : "🤍 Like"}
              <span>${likeInfo.count}</span>
            </button>
            <span class="comment-total">💬 ${comments.length} comments</span>
          </div>

          <div class="comments-area">
            <div class="comments-list">${commentHTML}</div>

            <form class="comment-form" data-comment-form="${m.id}">
              <input type="text" maxlength="1000" required placeholder="Write a comment…" aria-label="Write a comment">
              <button type="submit" class="comment-send">Send</button>
            </form>
          </div>
        </div>
      </article>
    `;
  }).join("");

  $("gallery").querySelectorAll(".memory-media").forEach((el, i) => {
    el.onclick = () => openLightbox(list[i]);
  });

  $("gallery").querySelectorAll("[data-like]").forEach(btn => {
    btn.onclick = () => toggleLike(btn.dataset.like, btn);
  });

  $("gallery").querySelectorAll("[data-comment-form]").forEach(form => {
    form.onsubmit = e => submitComment(e, form.dataset.commentForm);
  });
}

/* RENDER GALLERY */
function renderGallery() {
  const q = $("search-input").value.toLowerCase();

  const list = memories.filter(m =>
    (currentCategory === "All" || m.category === currentCategory) &&
    (`${m.caption} ${m.category} ${m.uploader_name || ""}`.toLowerCase().includes(q))
  );

  $("gallery-count").textContent = `${list.length} ${list.length === 1 ? "memory" : "memories"}`;

  if (!list.length) {
    $("gallery").innerHTML = '<div class="empty-state">No memories here yet. The best ones are still waiting to be shared ✨</div>';
    return;
  }

  $("gallery").innerHTML = list.map(m => `
    <article class="memory-card">
      ${mediaMarkup(m)}
      <div class="memory-info">
        <div class="memory-caption" title="${escapeHTML(m.caption)}">
          ${escapeHTML(m.caption)}
        </div>

        <div class="memory-meta">
          <span>${escapeHTML(m.category)} · ${dateFmt(m.memory_date)}</span>
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
/* LIKE / UNLIKE */
async function toggleLike(memoryId, button) {
  if (!user) return toast("Please sign in first.");

  button.disabled = true;

  try {
    const { data: existing, error: findError } = await sb.from("memory_likes")
      .select("id")
      .eq("memory_id", memoryId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      const { error } = await sb.from("memory_likes")
        .delete()
        .eq("memory_id", memoryId)
        .eq("user_id", user.id);

      if (error) throw error;
    } else {
      const { error } = await sb.from("memory_likes")
        .insert({ memory_id: memoryId, user_id: user.id });

      if (error) throw error;
    }

    await loadMemoryInteractions();
    renderGallery();
  } catch (err) {
    console.error(err);
    toast("Like update failed: " + (err.message || "Please try again."));
    button.disabled = false;
  }
}

/* ADD COMMENT */
async function submitComment(e, memoryId) {
  e.preventDefault();

  const form = e.currentTarget;
  const input = form.querySelector("input");
  const comment = input.value.trim();

  if (!comment) return;

  const send = form.querySelector("button");
  send.disabled = true;

  try {
    const { error } = await sb.from("memory_comments").insert({
      memory_id: memoryId,
      user_id: user.id,
      comment
    });

    if (error) throw error;

    await loadMemoryInteractions();
    renderGallery();
    toast("Comment added 💬");

    // Refresh notification bell for current user
    await loadNotifications();
  } catch (err) {
    console.error(err);
    toast("Comment failed: " + (err.message || "Please try again."));
    send.disabled = false;
  }
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
  await loadPending();
  await loadMembers();
}

document.querySelectorAll("[data-admin-tab]").forEach(b => b.onclick = () => {
  adminTab = b.dataset.adminTab;

  document.querySelectorAll(".admin-tab").forEach(x =>
    x.classList.toggle("active", x === b)
  );

  renderAdminTab();
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
