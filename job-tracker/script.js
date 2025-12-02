// -------------------------------
// Job Application Tracker 
// -------------------------------


// -------------------------------
// App state + constants
// -------------------------------
let jobs = JSON.parse(localStorage.getItem("jobs")) || [];
let editingJobId = null;
let showArchived = false;
let currentSort = { key: null, dir: 1 }; // dir: 1 asc, -1 desc
const confettiCanvas = document.getElementById("confettiCanvas");
const confettiTriggered = new Set();
let statusChart = null;
let sourceChart = null;

// -------------------------------
// Utilities
// -------------------------------
function saveJobs() {
  localStorage.setItem("jobs", JSON.stringify(jobs));
}

function nowStr() {
  return new Date().toLocaleString();
}

function safeText(s) {
  return s ? String(s) : "";
}

function daysBetween(dateA, dateB = new Date()) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  const diff = Math.floor((b - a) / (1000 * 60 * 60 * 24));
  return diff;
}

function isoToday() {
  return new Date().toISOString().split("T")[0];
}

function daysAgoDisplay(dateStr){
  if(!dateStr) return "";
  const d = daysBetween(dateStr);
  if(d === 0) return "today";
  if(d === 1) return "1 day ago";
  return `${d} days ago`;
}

// -------------------------------
// Badge class helper
// -------------------------------
function getStatusBadgeClass(status){
  switch(status){
    case "Applied": return "badge-applied";
    case "Phone Screen": return "badge-phonescreen";
    case "Technical Interview": return "badge-technicalinterview";
    case "Offer": return "badge-offer";
    case "Accepted": return "badge-accepted";
    case "Rejected": return "badge-rejected";
    default: return "badge-wishlist";
  }
}

// -------------------------------
// Render table
// -------------------------------
function renderTable(filteredJobs = null){
  const tbody = document.getElementById("jobTableBody");
  if(!tbody) return;
  // Apply filters/search/sort if filteredJobs not provided
  if(filteredJobs === null) filteredJobs = getFilteredJobs();

  // sort dream companies first, then currentSort
  filteredJobs = filteredJobs.slice(); // clone
  filteredJobs.sort((a,b)=>{
    // dream company pinned first
    if( (b.dreamCompany?1:0) !== (a.dreamCompany?1:0) ) return (b.dreamCompany?1:0) - (a.dreamCompany?1:0);
    // priority next
    if((b.priority?1:0) !== (a.priority?1:0)) return (b.priority?1:0) - (a.priority?1:0);
    // then current sort if present
    if(currentSort.key){
      const ka = (a[currentSort.key] || "").toString().toLowerCase();
      const kb = (b[currentSort.key] || "").toString().toLowerCase();
      if(ka < kb) return -1 * currentSort.dir;
      if(ka > kb) return 1 * currentSort.dir;
      return 0;
    }
    // fallback: newest first
    return b.id - a.id;
  });

  tbody.innerHTML = "";
  filteredJobs.filter(j => showArchived || !j.archived).forEach(job => {
    const badgeClass = getStatusBadgeClass(job.status);
    // deadline text
    let deadlineText = "";
    if(job.deadline) {
      const diff = Math.ceil((new Date(job.deadline) - new Date()) / (1000*60*60*24));
      if(diff > 1) deadlineText = `<span class="badge bg-info deadline-badge">${diff} days left</span>`;
      else if(diff === 1) deadlineText = `<span class="badge bg-warning text-dark deadline-badge">Due tomorrow</span>`;
      else if(diff === 0) deadlineText = `<span class="badge bg-danger text-white deadline-badge">Due today</span>`;
      else deadlineText = `<span class="badge bg-secondary deadline-badge">Expired</span>`;
    }

    // OA countdown
    let oaHtml = "";
    if(job.oaLink) {
      const oaCountdownId = `oa_${job.id}`;
      oaHtml = `<div><a href="${job.oaLink}" target="_blank" class="btn btn-sm btn-outline-primary">OA</a> <small id="${oaCountdownId}" class="text-muted ms-1"></small></div>`;
    }

    const row = document.createElement("tr");
    row.draggable = true;
    row.ondragstart = (e) => dragStart(e, job.id);

    row.innerHTML = `
      <td>${escapeHtml(job.company)} ${job.priority ? "⭐" : ""} ${job.dreamCompany ? "💛" : ""}</td>
      <td>${escapeHtml(job.role)}</td>
      <td>
        ${job.link ? `<a href="${job.link}" target="_blank" rel="noopener">Link</a>` : ""}
        ${oaHtml}
      </td>
      <td>${escapeHtml(job.location || "")}</td>
      <td title="${job.date || ""}">${job.date ? daysAgoDisplay(job.date) : ""}</td>
      <td><span class="badge ${badgeClass}" title="Last Updated: ${job.lastUpdated || ''}">${escapeHtml(job.status)}</span>
          ${possiblyGhostedHtml(job)}
      </td>
      <td>${escapeHtml(job.salary || "")}</td>
      <td>${"⭐".repeat(Number(job.excitement || 0))}</td>
      <td>${job.priority ? "⭐" : ""}</td>
      <td>${escapeHtml(job.lastUpdated || "")}</td>
      <td>${deadlineText}</td>
      <td>
        <button class="btn btn-sm btn-warning" onclick="editJob(${job.id})">Edit</button>
        <button class="btn btn-sm btn-secondary" onclick="addToCalendar(${job.id})">Calendar</button>
        <button class="btn btn-sm btn-danger" onclick="deleteJob(${job.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(row);

    // Start OA countdown if applicable
    if(job.oaLink) startOACountdown(job);
    // trigger confetti when needed (but only once)
    if((job.status === "Offer" || job.status === "Accepted") && !confettiTriggered.has(job.id)) {
      triggerConfetti(job.id);
    }
  });

  updateDashboard(filteredJobs);
  renderKanban(filteredJobs);
  updateUpcomingEvents(filteredJobs);
  updateTodaysTasks(filteredJobs);
  updateCharts(filteredJobs);
}

// escapeHtml helper
function escapeHtml(text) {
  if(!text && text !== 0) return "";
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// possibly ghosted badge html
function possiblyGhostedHtml(job){
  // If lastUpdated more than 14 days and status not final -> warn
  if(!job.lastUpdated) return "";
  const days = daysBetween(job.lastUpdated);
  const finalStatuses = ["Rejected","Accepted","Offer"];
  if(days >= 14 && !finalStatuses.includes(job.status)) {
    return ` <span class="ghost-warning" title="No updates in ${days} days">Possibly Ghosted</span>`;
  }
  return "";
}

// -------------------------------
// Filters / Search / Sort
// -------------------------------
function getFilteredJobs() {
  const status = document.getElementById("filterStatus").value;
  const search = document.getElementById("searchInput").value.trim().toLowerCase();

  let filtered = jobs.slice();
  if(status && status !== "all") filtered = filtered.filter(j => j.status === status);
  if(search){
    filtered = filtered.filter(j =>
      (j.company || "").toLowerCase().includes(search) ||
      (j.role || "").toLowerCase().includes(search) ||
      (j.location || "").toLowerCase().includes(search)
    );
  }
  return filtered;
}

function applyFilters() { renderTable(); }

document.getElementById("filterStatus").addEventListener("change", applyFilters);
document.getElementById("searchInput").addEventListener("input", debounce(applyFilters, 200));

// sortTable: toggles ascending/descending on same key
function sortTable(key){
  if(currentSort.key === key) currentSort.dir *= -1;
  else { currentSort.key = key; currentSort.dir = 1; }
  renderTable();
}

// debounce helper
function debounce(fn, ms){
  let t;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(()=>fn.apply(this,args), ms);
  };
}

// -------------------------------
// Add / Edit
// -------------------------------
const jobForm = document.getElementById("jobForm");
jobForm.addEventListener("submit", function(e){
  e.preventDefault();
  const data = {
    company: document.getElementById("companyInput").value.trim(),
    role: document.getElementById("roleInput").value.trim(),
    link: document.getElementById("linkInput").value.trim(),
    location: document.getElementById("locationInput").value,
    date: document.getElementById("dateInput").value || isoToday(),
    status: document.getElementById("statusInput").value,
    salary: document.getElementById("salaryInput").value.trim(),
    excitement: Number(document.getElementById("exciteInput").value) || 0,
    source: document.getElementById("sourceInput").value.trim(),
    notes: document.getElementById("notesInput").value.trim(),
    contact: document.getElementById("contactInput").value.trim(),
    priority: document.getElementById("priorityInput").checked,
    dreamCompany: document.getElementById("dreamCompanyInput").checked,
    oaLink: document.getElementById("oaLinkInput").value.trim(),
    deadline: document.getElementById("deadlineInput").value || "",
    resumeVersion: document.getElementById("resumeVersionInput").value,
    lastUpdated: nowStr(),
    archived: false,
    id: editingJobId || Date.now()
  };

  if(editingJobId){
    const idx = jobs.findIndex(j=>j.id === editingJobId);
    if(idx >= 0) {
      jobs[idx] = { ...jobs[idx], ...data };
    }
    editingJobId = null;
  } else {
    jobs.push(data);
  }
  saveJobs();
  closeModalAndReset();
  applyFilters();
});

// edit Job
function editJob(id){
  const job = jobs.find(j=>j.id === id);
  if(!job) return alert("Job not found");
  editingJobId = id;
  document.getElementById("modalTitle").textContent = "Edit Job Application";
  document.getElementById("companyInput").value = job.company || "";
  document.getElementById("roleInput").value = job.role || "";
  document.getElementById("linkInput").value = job.link || "";
  document.getElementById("locationInput").value = job.location || "Remote";
  document.getElementById("dateInput").value = job.date || "";
  document.getElementById("statusInput").value = job.status || "Wishlist";
  document.getElementById("salaryInput").value = job.salary || "";
  document.getElementById("exciteInput").value = job.excitement || 0;
  document.getElementById("sourceInput").value = job.source || "";
  document.getElementById("notesInput").value = job.notes || "";
  document.getElementById("contactInput").value = job.contact || "";
  document.getElementById("priorityInput").checked = job.priority || false;
  document.getElementById("dreamCompanyInput").checked = job.dreamCompany || false;
  document.getElementById("oaLinkInput").value = job.oaLink || "";
  document.getElementById("deadlineInput").value = job.deadline || "";
  document.getElementById("resumeVersionInput").value = job.resumeVersion || "";
  new bootstrap.Modal(document.getElementById('addJobModal')).show();
}

function closeModalAndReset(){
  const modalEl = document.getElementById('addJobModal');
  const modal = bootstrap.Modal.getInstance(modalEl);
  if(modal) modal.hide();
  jobForm.reset();
  document.getElementById("modalTitle").textContent = "Add Job Application";
}

// delete
function deleteJob(id){
  if(!confirm("Are you sure you want to delete this job?")) return;
  jobs = jobs.filter(j=>j.id !== id);
  saveJobs();
  applyFilters();
}

// clear all
function clearAllJobs(){
  if(!confirm("Delete ALL jobs? This cannot be undone.")) return;
  jobs = [];
  saveJobs();
  applyFilters();
}

// -------------------------------
// Kanban (drag/drop)
// -------------------------------
let draggedJobId = null;
function dragStart(e,id){ draggedJobId = id; e.dataTransfer?.setData("text/plain", String(id)); }
function dragOver(e){ e.preventDefault(); }
function dropJob(e, newStatus){
  e.preventDefault();
  const id = draggedJobId || Number(e.dataTransfer?.getData("text/plain"));
  if(!id) return;
  const job = jobs.find(j=>j.id === id);
  if(!job) return;
  job.status = newStatus;
  job.lastUpdated = nowStr();
  saveJobs();
  draggedJobId = null;
  applyFilters();
}

function renderKanban(filteredJobs){
  const kanban = document.getElementById("kanbanBoard");
  if(!kanban) return;
  kanban.innerHTML = "";
  const statuses = ["Wishlist","Applied","Phone Screen","Technical Interview","Offer","Rejected","Accepted"];
  statuses.forEach(status => {
    const col = document.createElement("div");
    col.className = "kanban-column p-2";
    col.ondragover = dragOver;
    col.ondrop = (e)=> dropJob(e, status);
    const header = document.createElement("h5");
    header.textContent = status;
    col.appendChild(header);
    const cardsContainer = document.createElement("div");
    cardsContainer.className = "kanban-cards";
    // append cards for this status
    filteredJobs.filter(j=>j.status === status && (showArchived || !j.archived)).forEach(job=>{
      const card = document.createElement("div");
      card.className = "kanban-card";
      card.draggable = true;
      card.ondragstart = (e)=> dragStart(e, job.id);
      card.innerHTML = `<strong>${escapeHtml(job.company)}</strong><div>${escapeHtml(job.role)}</div><div class="small text-muted">${job.priority?'⭐':''}${job.dreamCompany?' 💛':''}</div>`;
      card.addEventListener("dblclick", ()=> editJob(job.id));
      cardsContainer.appendChild(card);
    });
    col.appendChild(cardsContainer);
    kanban.appendChild(col);
  });
}

// -------------------------------
// Dashboard / Stats
// -------------------------------
function updateDashboard(filteredJobs = null){
  if(filteredJobs === null) filteredJobs = jobs.slice();
  const total = filteredJobs.filter(j => !j.archived).length;
  const inProgress = filteredJobs.filter(j => ["Applied","Phone Screen","Technical Interview"].includes(j.status) && !j.archived).length;
  const offers = filteredJobs.filter(j => j.status === "Offer" && !j.archived).length;
  const rejected = filteredJobs.filter(j => j.status === "Rejected" && !j.archived).length;
  const rejectionRate = total === 0 ? 0 : Math.round((rejected / total) * 100);
  const lastApplied = filteredJobs.filter(j => j.date).sort((a,b)=> new Date(b.date) - new Date(a.date))[0];
  const daysSince = lastApplied ? daysBetween(lastApplied.date) : "—";

  document.getElementById("totalApplied").textContent = `Applied: ${total}`;
  document.getElementById("inProgress").textContent = `In progress: ${inProgress}`;
  document.getElementById("offers").textContent = `Offers: ${offers}`;
  document.getElementById("rejectionRate").textContent = `Rejection Rate: ${rejectionRate}%`;
  document.getElementById("daysSinceLast").textContent = `Days Since Last Application: ${daysSince}`;
}

// -------------------------------
// Upcoming Events & Today's Tasks
// - parses notes for patterns like "Follow-up Mar 15" or dates yyyy-mm-dd
// -------------------------------
function parseEventsFromNotes(job){
  const events = [];
  if(!job.notes) return events;
  // look for YYYY-MM-DD
  const isoMatches = [...job.notes.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)];
  isoMatches.forEach(m => events.push({ date: m[1], text: `Follow-up: ${job.company} - ${job.role}` }));
  // look for 'Follow-up <Mon> <DD>' style (basic)
  const followMatches = [...job.notes.matchAll(/\b[Ff]ollow(?:-?up)?\s+([A-Za-z]{3,9})\s+(\d{1,2})\b/g)];
  followMatches.forEach(m=>{
    try {
      const parsed = new Date(`${m[1]} ${m[2]}, ${new Date().getFullYear()}`);
      if(!isNaN(parsed)) events.push({ date: parsed.toISOString().split("T")[0], text: `Follow-up: ${job.company} - ${job.role}` });
    } catch(e){}
  });
  return events;
}

function updateUpcomingEvents(filteredJobs=null){
  if(filteredJobs === null) filteredJobs = jobs.slice();
  const list = document.getElementById("upcomingEventsList");
  list.innerHTML = "";
  const events = [];
  filteredJobs.forEach(job=>{
    // deadlines
    if(job.deadline) events.push({ date: job.deadline, text: `${job.company} - Deadline` });
    // parsed events
    parseEventsFromNotes(job).forEach(ev => events.push(ev));
  });
  // sort next 30 days
  const today = new Date();
  const next = events.map(ev => ({ ...ev, dt: new Date(ev.date) }))
    .filter(ev => ev.dt >= today && ((ev.dt - today)/(1000*60*60*24) <= 365))
    .sort((a,b)=>a.dt - b.dt)
    .slice(0,10);

  next.forEach(ev=>{
    const li = document.createElement("li");
    li.className = "list-group-item";
    li.textContent = `${ev.text} — ${ev.date}`;
    list.appendChild(li);
  });

  if(next.length === 0) {
    const li = document.createElement("li");
    li.className = "list-group-item text-muted";
    li.textContent = "No upcoming events";
    list.appendChild(li);
  }
}

function updateTodaysTasks(filteredJobs=null){
  if(filteredJobs === null) filteredJobs = jobs.slice();
  const panel = document.getElementById("todaysTasks");
  const list = document.getElementById("todaysTasksList");
  list.innerHTML = "";
  const todayISO = isoToday();
  const tasks = [];
  filteredJobs.forEach(job=>{
    if(job.deadline === todayISO) tasks.push(`${job.company} - ${job.role} (Deadline Today)`);
    // notes parsed events
    parseEventsFromNotes(job).forEach(ev=>{
      if(ev.date === todayISO) tasks.push(`${job.company} - ${job.role} (${ev.text})`);
    });
  });

  if(tasks.length){
    panel.style.display = "block";
    tasks.forEach(t => {
      const li = document.createElement("li");
      li.textContent = t;
      list.appendChild(li);
    });
  } else {
    panel.style.display = "none";
  }
}

// -------------------------------
// OA Countdown logic
// -------------------------------
const oaTimers = new Map();
function startOACountdown(job){
  if(!job.oaLink) return;
  // if user encoded expiry in link query? We'll support optional data-oa-expiry attribute in future.
  // For now we show "Open OA" and keep placeholder countdown blank. You can extend by adding job.oaExpiry property.
  const el = document.getElementById(`oa_${job.id}`);
  if(!el) return;
  el.textContent = ""; // reserved for possible future expiry parsing
}

// -------------------------------
// Confetti
// -------------------------------
function triggerConfetti(id){
  if(confettiTriggered.has(id)) return;
  confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  confettiTriggered.add(id);
}

// -------------------------------
// Notifications (basic)
// -------------------------------
function requestNotificationPermission() {
  if("Notification" in window && Notification.permission !== "granted"){
    Notification.requestPermission().then(()=>{/* noop */});
  }
}
function scheduleReminders(){
  if(!("Notification" in window) || Notification.permission !== "granted") return;
  // simple demo reminders (fires in 5s for every job with notes)
  jobs.forEach((job,i)=>{
    if(job.notes) setTimeout(()=>{
      new Notification(`${job.company} — ${job.role}`, { body: job.notes.slice(0,120) });
    }, 5000 + (i*3000));
  });
}

// -------------------------------
// Export / Import JSON & CSV
// -------------------------------
function exportJSON(){
  const data = JSON.stringify(jobs, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jobs-backup-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const parsed = JSON.parse(e.target.result);
      if(Array.isArray(parsed)){
        // merge conservatively: if ids conflict, add suffix
        parsed.forEach(j=>{
          if(!j.id) j.id = Date.now() + Math.floor(Math.random()*10000);
          jobs.push(j);
        });
        saveJobs();
        applyFilters();
        alert("Imported jobs successfully.");
      } else {
        alert("Invalid JSON format: expected array of jobs.");
      }
    } catch(err){
      alert("Failed to parse JSON file.");
    }
  };
  reader.readAsText(file);
}

function exportCSV(){
  const headers = ["company","role","link","location","date","status","salary","excitement","source","notes","contact","priority","dreamCompany","oaLink","deadline","resumeVersion","lastUpdated","archived"];
  const rows = jobs.map(j => headers.map(h => JSON.stringify(j[h] || "")).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jobs-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// -------------------------------
// Auto-archive old rejected (>60 days)
// -------------------------------
function autoArchiveOldRejected(){
  const today = new Date();
  jobs.forEach(job=>{
    if(job.status === "Rejected" && job.date){
      const diff = daysBetween(job.date);
      if(diff > 60) job.archived = true;
    }
  });
  saveJobs();
}

// toggle archived view
document.getElementById("showArchivedToggle").addEventListener("change", function(){
  showArchived = this.checked;
  renderTable();
});

// -------------------------------
// Add to Google Calendar (create an .ics and offer download)
// -------------------------------
function addToCalendar(jobId){
  const job = jobs.find(j=>j.id === jobId);
  if(!job) return alert("Job not found");
  // if there's a deadline, create an event on that date at 9:00
  if(!job.deadline) return alert("No deadline set for this job.");
  const dt = new Date(job.deadline + "T09:00:00");
  const dtEnd = new Date(dt.getTime() + 60*60*1000);
  function formatICSDate(d){
    return d.toISOString().replace(/[-:]/g,"").split(".")[0] + "Z";
  }
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JobTracker//EN",
    "BEGIN:VEVENT",
    `UID:${job.id}@jobtracker`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(dt)}`,
    `DTEND:${formatICSDate(dtEnd)}`,
    `SUMMARY:Application Deadline - ${job.company} (${job.role})`,
    `DESCRIPTION:${(job.notes||"").replace(/\n/g,"\\n")}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${job.company.replace(/\s+/g,'_')}_deadline.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// -------------------------------
// Weekly Summary
// -------------------------------
function generateWeeklySummary(){
  let summary = "Weekly Job Summary:\n\n";
  jobs.forEach(j=>{
    summary += `${j.company} - ${j.role} [${j.status}] (Applied: ${j.date})\n`;
  });
  // show prompt so user can copy
  window.prompt("Copy your weekly summary:", summary);
}

// -------------------------------
// Charts (status & source)
// -------------------------------
function updateCharts(filteredJobs = null){
  if(filteredJobs === null) filteredJobs = jobs.slice();
  // status counts
  const statusCounts = {};
  filteredJobs.forEach(j => {
    const s = j.status || "Wishlist";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
  const statusLabels = Object.keys(statusCounts);
  const statusData = statusLabels.map(l => statusCounts[l]);

  // source counts (top 6)
  const sourceCounts = {};
  filteredJobs.forEach(j => {
    const s = (j.source || "Unknown");
    sourceCounts[s] = (sourceCounts[s] || 0) + 1;
  });
  const sourceLabels = Object.keys(sourceCounts).slice(0,8);
  const sourceData = sourceLabels.map(l => sourceCounts[l]);

  // status chart
  const sctx = document.getElementById("statusChart").getContext("2d");
  if(statusChart) statusChart.destroy();
  statusChart = new Chart(sctx, {
    type: 'pie',
    data: {
      labels: statusLabels,
      datasets: [{ data: statusData }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  const sctx2 = document.getElementById("sourceChart").getContext("2d");
  if(sourceChart) sourceChart.destroy();
  sourceChart = new Chart(sctx2, {
    type: 'bar',
    data: {
      labels: sourceLabels,
      datasets: [{ data: sourceData }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });
}

// -------------------------------
// Helpers on load
// -------------------------------
function initApp(){


  // default filter events
  document.getElementById("searchInput").addEventListener("keydown", function(e){
    if(e.key === "Enter") applyFilters();
  });

  // keyboard shortcuts
  document.addEventListener("keydown", function(e){
    if(e.key === "n" || e.key === "N"){
      new bootstrap.Modal(document.getElementById('addJobModal')).show();
    }
    if(e.key === "/"){
      e.preventDefault();
      document.getElementById("searchInput").focus();
    }
  });

  // call auto-archive
  autoArchiveOldRejected();

  // request notifications
  requestNotificationPermission();
  scheduleReminders();

  // initial render
  renderTable();

  // update timers every minute for "days ago" and OA countdowns
  setInterval(()=> renderTable(), 60*1000);
}



// escapeHtml was defined earlier

// -------------------------------
// Startup: wire up buttons referenced in HTML
// -------------------------------
document.getElementById("importJSONFile").addEventListener("change", function(){ importJSON(this.files[0]); });

// If user toggles showArchivedToggle it's already wired earlier

// initial call
document.addEventListener("DOMContentLoaded", initApp);
