/* Our MBBS Journey — Supabase powered private memory archive */
const { createClient } = window.supabase;
const cfg = window.APP_CONFIG || {};
const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_");
const sb = configured ? createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY) : null;
const $ = id=>document.getElementById(id);
let user=null, profile=null, currentCategory="All", adminTab="pending", memories=[], allProfiles=[];
const show=(el,yes=true)=>el.classList.toggle("hidden",!yes);
const escapeHTML=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),3000)}
function notice(msg){$("notice").textContent=msg;show($("notice"),!!msg)}
function dateFmt(v){if(!v)return "Date not added";try{return new Date(v+"T00:00:00").toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})}catch{return v}}
function mediaMarkup(m,small=false){const url=m.public_url||"";return m.media_type==="video"?`<video class="${small?"admin-thumb":"memory-media"}" ${small?"":"controls"} preload="metadata" src="${url}"></video>`:`<img class="${small?"admin-thumb":"memory-media"}" loading="lazy" src="${url}" alt="${escapeHTML(m.caption)}">`}
function setAuthTab(tab){document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));show($("signup-extra"),tab==="signup");$("auth-submit").textContent=tab==="signup"?"Create account":"Sign in"; $("auth-message").textContent=""}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>setAuthTab(b.dataset.tab));
$("auth-form").addEventListener("submit",async e=>{e.preventDefault();if(!sb){$("auth-message").textContent="Setup required: add Supabase URL and anon key in config.js.";return}
const email=$("auth-email").value.trim(),password=$("auth-password").value;
$("auth-submit").disabled=true;
try{let result;if(document.querySelector(".tab.active").dataset.tab==="signup"){result=await sb.auth.signUp({email,password,options:{data:{full_name:$("auth-name").value.trim()}}});if(result.error)throw result.error;$("auth-message").textContent="Account created! Check your email if confirmation is enabled. Admin must grant access.";toast("Account created")}else{result=await sb.auth.signInWithPassword({email,password});if(result.error)throw result.error}
}catch(err){$("auth-message").textContent=err.message||"Could not sign in"}finally{$("auth-submit").disabled=false}});
$("logout-btn").onclick=async()=>{await sb?.auth.signOut();location.reload()};
$("open-upload").onclick=()=>{if(!profile?.can_upload){toast("Your account doesn't have upload permission yet.");return}show($("upload-modal"));};
$("close-upload").onclick=()=>show($("upload-modal"),false);
$("upload-modal").onclick=e=>{if(e.target===$("upload-modal"))show($("upload-modal"),false)};
$("upload-form").addEventListener("submit",uploadFiles);
$("upload-files").onchange=()=>{$("upload-progress").textContent=`${$("upload-files").files.length} file(s) selected`};
$("category-nav").onclick=e=>{const b=e.target.closest("[data-category]");if(!b)return;currentCategory=b.dataset.category;document.querySelectorAll(".category").forEach(x=>x.classList.toggle("active",x===b));renderGallery()};
$("search-input").oninput=renderGallery;
$("lightbox-close").onclick=()=>show($("lightbox"),false);
$("lightbox").onclick=e=>{if(e.target===$("lightbox"))show($("lightbox"),false)};
function openLightbox(m){$("lightbox-content").innerHTML=m.media_type==="video"?`<video controls autoplay src="${m.public_url}"></video>`:`<img src="${m.public_url}" alt="">`;$("lightbox-caption").textContent=m.caption||"";show($("lightbox"))}
async function boot(){if(!sb){show($("auth-view"));$("auth-message").textContent="Before use, connect your Supabase project in config.js. Setup guide is included in the ZIP.";return}
const {data:{session}}=await sb.auth.getSession();if(session)await enterApp(session.user);
sb.auth.onAuthStateChange(async(_event,session)=>{if(session)await enterApp(session.user);else{user=null;show($("app-view"),false);show($("auth-view"));show($("logout-btn"),false)}})}
async function enterApp(u){user=u;show($("auth-view"),false);show($("app-view"));show($("logout-btn"));const {data:p,error}=await sb.from("profiles").select("*").eq("id",u.id).maybeSingle();
profile=p;if(error)console.warn(error);$("user-label").textContent=p?.full_name||u.email;
if(!p||!p.is_approved){notice("Your account is awaiting access approval. Ask the project admin to approve your profile.");show($("open-upload"),false);show($("admin-panel"),false);$("gallery").innerHTML='<div class="empty-state">Your private circle will appear here after approval.</div>';return}
notice(p.can_upload?"You have upload access. New uploads are reviewed before appearing in the gallery.":"Welcome! Browse the memories shared by our circle.");
show($("open-upload"),p.can_upload);show($("admin-panel"),p.is_admin);
await loadMemories();if(p.is_admin)await loadAdmin();}
async function loadMemories(){const {data,error}=await sb.from("memories").select("*").eq("status","approved").order("created_at",{ascending:false});if(error){console.error(error);notice("Could not load gallery: "+error.message);return}memories=data||[];renderGallery()}
function renderGallery(){const q=$("search-input").value.toLowerCase();const list=memories.filter(m=>(currentCategory==="All"||m.category===currentCategory)&&(`${m.caption} ${m.category} ${m.uploader_name||""}`.toLowerCase().includes(q)));$("gallery-count").textContent=`${list.length} ${list.length===1?"memory":"memories"}`;if(!list.length){$("gallery").innerHTML='<div class="empty-state">No memories here yet. The best ones are still waiting to be shared ✨</div>';return}
$("gallery").innerHTML=list.map(m=>`<article class="memory-card">${mediaMarkup(m)}<div class="memory-info"><div class="memory-caption" title="${escapeHTML(m.caption)}">${escapeHTML(m.caption)}</div><div class="memory-meta"><span>${escapeHTML(m.category)} · ${dateFmt(m.memory_date)}</span><span>${escapeHTML(m.uploader_name||"Batch memory")}</span></div></div></article>`).join("");
$("gallery").querySelectorAll(".memory-media").forEach((el,i)=>el.onclick=()=>openLightbox(list[i]));}
async function uploadFiles(e){e.preventDefault();if(!profile?.can_upload)return toast("Upload permission is not enabled for your account.");const files=$("upload-files").files;if(!files.length)return;
const caption=$("upload-caption").value.trim(),category=$("upload-category").value,date=$("upload-date").value||null;
$("upload-progress").textContent="Uploading… please keep this page open.";const submit=$("upload-form").querySelector("button[type=submit]");submit.disabled=true;
try{for(const f of files){if(f.size>50*1024*1024)throw new Error(`${f.name} exceeds 50 MB.`);if(!f.type.startsWith("image/")&&!f.type.startsWith("video/"))throw new Error("Only image/video files are allowed.");
const path=`${user.id}/${Date.now()}-${f.name.replace(/[^\w.\-]/g,"_")}`;const {error:upErr}=await sb.storage.from("journey-media").upload(path,f,{upsert:false});if(upErr)throw upErr;
const {data:{publicUrl}}=sb.storage.from("journey-media").getPublicUrl(path);
const {error:dbErr}=await sb.from("memories").insert({caption,category,memory_date:date,storage_path:path,public_url:publicUrl,media_type:f.type.startsWith("video/")?"video":"image",status:"pending",uploader_id:user.id,uploader_name:profile.full_name||user.email});if(dbErr)throw dbErr}
$("upload-progress").textContent="Submitted! Your memory is awaiting admin approval.";toast("Sent for approval ✨");$("upload-form").reset();show($("upload-modal"),false);if(profile.is_admin)await loadAdmin()
}catch(err){$("upload-progress").textContent=err.message||"Upload failed. Check Storage setup."}finally{submit.disabled=false}}
async function loadAdmin(){await loadPending();await loadMembers()}
document.querySelectorAll("[data-admin-tab]").forEach(b=>b.onclick=()=>{adminTab=b.dataset.adminTab;document.querySelectorAll(".admin-tab").forEach(x=>x.classList.toggle("active",x===b));renderAdminTab()});
async function loadPending(){const {data,error}=await sb.from("memories").select("*").eq("status","pending").order("created_at",{ascending:true});if(error){console.error(error);return}window.pendingMemories=data||[];$("pending-count").textContent=window.pendingMemories.length;renderAdminTab()}
async function loadMembers(){const {data,error}=await sb.from("profiles").select("*").order("created_at",{ascending:false});if(error){console.error(error);return}allProfiles=data||[];renderAdminTab()}
function renderAdminTab(){const root=$("admin-content");if(adminTab==="pending"){const list=window.pendingMemories||[];root.innerHTML=list.length?list.map(m=>`<div class="admin-row">${mediaMarkup(m,true)}<div class="admin-row-main"><strong>${escapeHTML(m.caption)}</strong><small>${escapeHTML(m.category)} · by ${escapeHTML(m.uploader_name||"member")}</small></div><button class="btn btn-sm btn-approve" data-approve="${m.id}">Approve</button><button class="btn btn-sm btn-danger" data-reject="${m.id}">Reject</button></div>`).join(""):'<div class="empty-state">All caught up! No pending uploads.</div>'}
else root.innerHTML=allProfiles.map(p=>`<div class="admin-row"><div class="admin-thumb member-avatar">${escapeHTML((p.full_name||p.email||"?").slice(0,1).toUpperCase())}</div><div class="admin-row-main"><strong>${escapeHTML(p.full_name||"No name")} ${p.is_admin?'<span class="admin-chip">Admin</span>':""}</strong><small>${escapeHTML(p.email||"")} · ${p.is_approved?"Approved":"Awaiting approval"} · ${p.can_upload?"Upload enabled":"Upload disabled"}</small></div>${!p.is_approved?`<button class="btn btn-sm btn-approve" data-member-approve="${p.id}">Approve</button>`:""}${p.id!==user.id&&!p.is_admin?`<button class="btn btn-sm btn-neutral" data-toggle-upload="${p.id}" data-value="${p.can_upload}">${p.can_upload?"Revoke upload":"Allow upload"}</button><button class="btn btn-sm btn-danger" data-member-revoke="${p.id}">Remove</button>`:""}</div>`).join("");
root.querySelectorAll("[data-approve]").forEach(b=>b.onclick=()=>changeMemory(b.dataset.approve,"approved"));root.querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>changeMemory(b.dataset.reject,"rejected"));
root.querySelectorAll("[data-member-approve]").forEach(b=>b.onclick=()=>changeProfile(b.dataset.memberApprove,{is_approved:true}));
root.querySelectorAll("[data-toggle-upload]").forEach(b=>b.onclick=()=>changeProfile(b.dataset.toggleUpload,{can_upload:b.dataset.value!=="true"}));
root.querySelectorAll("[data-member-revoke]").forEach(b=>b.onclick=()=>removeMember(b.dataset.memberRevoke));}
async function changeMemory(id,status){const {error}=await sb.from("memories").update({status,reviewed_by:user.id,reviewed_at:new Date().toISOString()}).eq("id",id);if(error)return toast(error.message);toast(status==="approved"?"Memory published!":"Upload rejected.");await loadPending();await loadMemories()}
async function changeProfile(id,patch){const {error}=await sb.from("profiles").update(patch).eq("id",id);if(error)return toast(error.message);toast("Member settings updated");await loadMembers()}
async function removeMember(id){if(!confirm("Remove this member's access? Their account will no longer be approved."))return;const {error}=await sb.from("profiles").update({is_approved:false,can_upload:false}).eq("id",id);if(error)return toast(error.message);toast("Member access revoked");await loadMembers()}
boot();