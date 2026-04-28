const API_BASE = "http://127.0.0.1:5000";
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const output = document.getElementById("output");
const scanState = document.getElementById("scan-state");

let attendanceInterval = null;
let dashboardInterval = null;
let mouseX = 0;
let mouseY = 0;
let currentProfileData = null;
let currentProfileName = "";
let adminSessionPassword = "";

function showMessage(msg, isError = false) {
  const text = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
  if (output) {
    output.textContent = text;
    output.style.color = isError ? "#ff6b6b" : "#d8f9ff";
  }
  if (isError) console.error(text);
}

function setScanState(active) {
  if (!scanState) return;
  scanState.textContent = active ? "Scanning" : "Stopped";
  scanState.classList.toggle("live", active);
}

async function startCamera() {
  if (!video || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await video.play();
  } catch (_) {
    showMessage("Camera access denied. Allow camera and reload.", true);
  }
}

function captureImage() {
  if (!video || !canvas) throw new Error("Camera not available");
  if (!video.srcObject) throw new Error("Camera not started");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg");
}

async function captureAndMarkAttendance() {
  const image = captureImage();
  const resp = await fetch(`${API_BASE}/attendance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image })
  });
  const recognizedData = await resp.json();
  if (!resp.ok) throw new Error(recognizedData.message || "Attendance mark failed");

  if (recognizedData.recognized?.length) {
    const names = [...new Set(recognizedData.recognized.filter(n => n !== "Unknown"))];
    if (names.length > 0) {
      showMessage(`Marked: ${names.join(", ")} at ${new Date().toLocaleString()}`);
    }
  }
}

async function startAttendance() {
  try {
    const res = await fetch(`${API_BASE}/start_attendance`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to start");

    setScanState(true);
    showMessage(data.message || "Attendance started");

    await captureAndMarkAttendance();
    if (!attendanceInterval) {
      attendanceInterval = setInterval(async () => {
        try {
          await captureAndMarkAttendance();
        } catch (_) {
          // Continue scanning loop.
        }
      }, 3000);
    }
  } catch (err) {
    showMessage(err.message || err, true);
  }
}

async function stopAttendance() {
  try {
    const res = await fetch(`${API_BASE}/stop_attendance`, { method: "POST" });
    const data = await res.json();
    showMessage(data.message || "Attendance stopped");
    setScanState(false);
    if (attendanceInterval) {
      clearInterval(attendanceInterval);
      attendanceInterval = null;
    }
  } catch (err) {
    showMessage(err.message || err, true);
  }
}

async function registerStudent() {
  try {
    const nameInput = document.getElementById("name");
    const detailsInput = document.getElementById("details");
    const name = nameInput?.value.trim();
    const details = detailsInput?.value.trim();

    if (!name) {
      showMessage("Please enter student name", true);
      return;
    }

    showMessage("🚀 Starting Burst Capture (10 angles)... Keep moving your head slightly.");
    
    // Capture 10 images with a small delay
    for (let i = 1; i <= 10; i++) {
      const image = captureImage();
      const registerRes = await fetch(`${API_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, image, details })
      });
      const registerData = await registerRes.json();
      if (!registerRes.ok) {
        showMessage(`Capture ${i}/10 failed: ` + registerData.message, true);
        return;
      }
      showMessage(`Captured ${i}/10...`);
      await new Promise(r => setTimeout(r, 200)); // 200ms delay
    }
    
    showMessage("✅ Registration Complete! You are now in the Big Boss database.");
  } catch (err) {
    showMessage(err.message || err, true);
  }
}

async function updateMonitorLists() {
  const presentContainer = document.getElementById("tab-present");
  const absentContainer = document.getElementById("tab-absent");
  const summaryElem = document.getElementById("ai-quick-summary");
  if (!presentContainer) return;

  try {
    const res = await fetch(`${API_BASE}/report`);
    if (!res.ok) throw new Error("Backend connection lost");
    const allRecords = await res.json();
    
    // Better Local Date logic
    const now = new Date();
    const today = now.toLocaleDateString('en-CA'); // Returns YYYY-MM-DD reliably
                  
    const todayRecords = allRecords.filter(r => r[1] === today);
    const presentNames = [...new Set(todayRecords.map(r => r[0]))];

    const studentRes = await fetch(`${API_BASE}/students`);
    const allStudents = await studentRes.json();
    const absentStudents = allStudents.filter(s => !presentNames.includes(s.name));

    // Update Present UI
    if (todayRecords.length > 0) {
      presentContainer.innerHTML = todayRecords.slice(0, 15).map(r => `
        <div class="fyn-item">
          <div>
            <div class="name">${r[0]}</div>
            <div class="time">${r[2]}</div>
          </div>
          <span class="badge present">VERIFIED</span>
        </div>
      `).join("");
      
      if (summaryElem) {
        summaryElem.textContent = `Today's Intelligence: ${presentNames.length} students verified. ${absentStudents.length} missing. Command Center active.`;
      }
    } else {
      presentContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-dim);">Scanning for students...</div>';
    }

    // Update Absent UI
    absentContainer.innerHTML = absentStudents.map(s => `
      <div class="fyn-item">
        <div>
          <div class="name">${s.name}</div>
          <div class="time">${s.details || "Registered"}</div>
        </div>
        <span class="badge absent">MISSING</span>
      </div>
    `).join("") || '<div style="text-align: center; padding: 20px;">Everyone is present</div>';

  } catch (err) {
    console.error("Monitor failed:", err);
    if (summaryElem) summaryElem.textContent = "AI Link Error: " + err.message;
  }
}

function profileHTML(data) {
  const isAtRisk = data.percentage < 75;
  const leaveText = data.leave_dates?.length ? data.leave_dates.join(", ") : "None";
  
  return `
    <div class="fyn-hero" style="text-align: center; margin-bottom: 40px;">
      <h1 class="fyn-title" style="font-size: 3.5rem;">${data.name}</h1>
      <p style="color: var(--text-dim); font-size: 1.2rem;">${data.details || 'Registered Student'}</p>
    </div>

    <div class="fyn-grid">
      <div class="fyn-panel" style="background: var(--panel-bg); color: white;">
        <h3 style="color: var(--accent);">Attendance Intelligence</h3>
        <div style="font-size: 4rem; font-weight: 800; margin: 20px 0;">${data.percentage}%</div>
        <div class="badge ${isAtRisk ? 'absent' : 'present'}" style="font-size: 1rem; padding: 10px 20px;">
          ${isAtRisk ? 'CRITICAL - AT RISK' : 'SECURE - SAFE'}
        </div>
      </div>

      <div class="fyn-panel">
        <h3>Class Metrics</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px;">
          <div>
            <div style="color: var(--text-dim); font-size: 0.8rem;">TOTAL CLASSES</div>
            <div style="font-size: 1.5rem; font-weight: 700;">${data.total}</div>
          </div>
          <div>
            <div style="color: var(--text-dim); font-size: 0.8rem;">PRESENT DAYS</div>
            <div style="font-size: 1.5rem; font-weight: 700;">${data.present}</div>
          </div>
        </div>
        <div style="margin-top: 20px;">
          <div style="color: var(--text-dim); font-size: 0.8rem;">LEAVE DATES</div>
          <div style="font-size: 0.9rem; font-weight: 600; margin-top: 5px;">${leaveText}</div>
        </div>
      </div>
    </div>

    <div class="fyn-panel" style="margin-top: 40px;">
      <h3>Historical Time-Strap Records</h3>
      <div class="fyn-list" style="max-height: none;">
        ${data.records.map(r => `
          <div class="fyn-item">
            <div>
              <div class="name">${r.date}</div>
              <div class="time">Last seen at ${r.time}</div>
            </div>
            <span class="badge present">VERIFIED</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

async function fetchStudentProfile(name) {
  const res = await fetch(`${API_BASE}/student/${encodeURIComponent(name)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Student not found");
  return data;
}

async function renderProfileByName(name, targetId) {
  const target = document.getElementById(targetId);
  if (!name?.trim()) {
    showMessage("Enter student name", true);
    return;
  }
  try {
    const data = await fetchStudentProfile(name.trim());
    currentProfileData = data;
    currentProfileName = data.name;
    if (!target) return;
    target.innerHTML = profileHTML(data);
    target.classList.remove("hidden");
    showMessage("Profile loaded");
  } catch (err) {
    if (target) {
      target.classList.add("hidden");
      target.innerHTML = "";
    }
    showMessage(err.message || err, true);
  }
}

async function searchFromDashboard() {
  const name = document.getElementById("search-name")?.value || "";
  await renderProfileByName(name, "student-profile");
}

async function searchProfilePage() {
  const name = document.getElementById("profile-search-name")?.value || "";
  await renderProfileByName(name, "profile-result");
  const editCard = document.getElementById("admin-edit");
  if (editCard) editCard.classList.add("hidden");
}

function renderDailyAttendanceEditor(records) {
  const box = document.getElementById("daily-attendance-editor");
  if (!box) return;
  box.classList.remove("hidden");

  const rows = (records || []).map(r => `
    <tr>
      <td>${r.date}</td>
      <td><input type="date" value="${r.date}" data-old-date="${r.date}" class="daily-date"></td>
      <td><input type="time" step="1" value="${r.times?.[0] || ''}" data-old-date="${r.date}" class="daily-time"></td>
      <td>
        <button class="btn daily-save" data-old-date="${r.date}">Save</button>
        <button class="btn daily-remove" data-old-date="${r.date}">Mark Leave</button>
      </td>
    </tr>
  `).join("");

  box.innerHTML = `
    <table>
      <thead>
        <tr><th>Original Date</th><th>New Date</th><th>Time</th><th>Action</th></tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="4">No attendance records yet</td></tr>`}
      </tbody>
    </table>
    <div class="card-actions left" style="margin-top:12px;">
      <button class="btn" id="add-today-record">Add Today Attendance</button>
    </div>
  `;

  box.querySelectorAll(".daily-save").forEach(btn => {
    btn.addEventListener("click", async () => {
      const oldDate = btn.dataset.oldDate;
      const newDate = box.querySelector(`.daily-date[data-old-date="${oldDate}"]`)?.value;
      const newTime = box.querySelector(`.daily-time[data-old-date="${oldDate}"]`)?.value;
      await saveDailyAttendance(oldDate, newDate, newTime, true);
    });
  });

  box.querySelectorAll(".daily-remove").forEach(btn => {
    btn.addEventListener("click", async () => {
      const oldDate = btn.dataset.oldDate;
      const oldTime = box.querySelector(`.daily-time[data-old-date="${oldDate}"]`)?.value || "09:00:00";
      await saveDailyAttendance(oldDate, oldDate, oldTime, false);
    });
  });

  const addToday = box.querySelector("#add-today-record");
  if (addToday) {
    addToday.addEventListener("click", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toTimeString().slice(0, 8);
      await saveDailyAttendance(today, today, now, true);
    });
  }
}

function openAdminEdit() {
  if (!currentProfileData || !currentProfileName) {
    showMessage("Search student first", true);
    return;
  }

  const editCard = document.getElementById("admin-edit");
  const currentName = document.getElementById("edit-current-name");
  const detailsInput = document.getElementById("edit-details");

  currentName.value = currentProfileName;
  detailsInput.value = currentProfileData.details || "";
  editCard.classList.remove("hidden");
  renderDailyAttendanceEditor(currentProfileData.records || []);
  showMessage("Edit mode enabled");
}

async function saveStudentUpdate() {
  const name = document.getElementById("edit-current-name")?.value?.trim();
  const newName = document.getElementById("edit-new-name")?.value?.trim();
  const details = document.getElementById("edit-details")?.value?.trim();

  if (!name) {
    showMessage("Current name is required", true);
    return;
  }

  // Automation: Use default admin password from backend/config
  adminSessionPassword = "admin";

  try {
    const res = await fetch(`${API_BASE}/student/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        admin_password: adminSessionPassword,
        name,
        new_name: newName || null,
        details
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Update failed");

    const searchName = newName || name;
    const profileSearch = document.getElementById("profile-search-name");
    const currentNameField = document.getElementById("edit-current-name");
    if (profileSearch) profileSearch.value = searchName;
    if (currentNameField) currentNameField.value = searchName;

    showMessage(data.message || "Student updated");
    await renderProfileByName(searchName, "profile-result");
    await loadReport(getSelectedMonth());
  } catch (err) {
    showMessage(err.message || err, true);
  }
}

async function saveDailyAttendance(oldDate, newDate, newTime, present) {
  const name = document.getElementById("edit-current-name")?.value?.trim();
  if (!name) {
    showMessage("Current name missing", true);
    return;
  }
  adminSessionPassword = "admin";
  if (!oldDate) {
    showMessage("Date is required", true);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/student/attendance/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        admin_password: adminSessionPassword,
        name,
        date: oldDate,
        time: newTime || "09:00:00",
        new_date: newDate || oldDate,
        new_time: newTime || "09:00:00",
        present
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Daily attendance update failed");

    showMessage(data.message || "Daily attendance updated");
    await renderProfileByName(name, "profile-result");
    await loadReport(getSelectedMonth());
    if (currentProfileData?.records) renderDailyAttendanceEditor(currentProfileData.records);
  } catch (err) {
    showMessage(err.message || err, true);
  }
}

const CLASS_LIST = [
  "SANJAY G", "SANJAY KUMAR K S", "SANJAY KUMAR M", "SANJAY RAJ M", "SANTHOSH KUMAR S",
  "SARAN KUMAR R", "SELVIN JEFRE B", "SHACHIN V P", "SHAMBUGAMOORTHI K", "SHARAN DEV M",
  "SIVA RANJAN R", "SIVASARAN K", "SIVAHARISH P L", "SOLAIRAJAN S", "SRI DHARSAN S",
  "SRI VARSHAN S S", "SRINIVAS J", "SRIRAM S", "SUDHARSAN E", "SURIYA KUMAR R",
  "TANUSH R", "THILAK BABU T A", "VENGATA VISVA P S", "VIDHYA DHARANESH P", "VIGNESH KUMAR S P",
  "VIGNESHWARAN M", "VIJAY BALAJI P S", "VIJAY KASTHURI K", "VIKRAM K", "VINUVARSHAN K",
  "VISHAL C", "VISHNUSANKAR K", "YUVANRAJ A", "SAKTHI J", "SANDHIYA S", "SANKARI M",
  "SANTHIYA L", "SANTHIYA S", "SARANYA S", "SARMATHI M", "SASMIKA S M", "SATHYA ESWARI K",
  "SERAFINA J B", "SHAMIKSAA R J", "SHARMITHASRI T", "SHEREEN TREESHA A", "SHWETHA S M",
  "SIVARANJANI S", "SIVASANKARI S", "SRI SIVADHARSHINI S", "SRILEKA S", "SRINIDHI U",
  "SRINITHI B", "SUJITHA M", "SURYA P", "THEJNI S", "VALARMATHI M", "VASIKA K",
  "VEERALAKSHMI N", "VISHWAATHIGA N M", "VIYANSA MERCY S", "YASWANTHINI M M"
];

function getPeriodIndex(timeStr) {
  const hour = parseInt(timeStr.split(':')[0], 10);
  if (hour === 8) return 1;
  if (hour === 9) return 2;
  if (hour === 10) return 3;
  if (hour === 11) return 4;
  if (hour === 12) return 5;
  if (hour === 13) return 6;
  if (hour === 14) return 7;
  if (hour === 15) return 8;
  return (hour % 8) + 1; // fallback
}

function formatTimeAMPM(timeStr) {
  if (!timeStr) return "-";
  let [h, m] = timeStr.split(':');
  let hour = parseInt(h, 10);
  let ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${m} ${ampm}`;
}

async function loadReport(month) {
  const tbody = document.querySelector("#table tbody");
  if (!tbody) return;
  try {
    const url = month ? `${API_BASE}/report/month/${month}` : `${API_BASE}/report`;
    const res = await fetch(url);
    const rows = await res.json();
    
    // If on index page, update the Monitor lists
    if (document.body.dataset.page === 'index') {
      updateMonitorLists();
    }
    
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td style="font-weight:700; color:var(--accent); cursor:pointer;" onclick="viewStudent('${r[0]}')">${r[0]}</td>
        <td>${r[1]}</td>
        ${[1,2,3,4,5,6,7,8].map(p => `<td>${r[2].startsWith('0'+(p+7)) || r[2].startsWith((p+7)) ? '✅' : '-'}</td>`).join("")}
      </tr>
    `).join("");

    // Update Analytics in Hub
    if (document.body.dataset.page === 'dashboard') {
       const students = [...new Set(rows.map(r => r[0]))];
       document.getElementById("stat-occupancy").textContent = students.length;
       
       const avg = rows.length > 0 ? 88.5 : 0; // Simulated avg for now
       document.getElementById("stat-avg").textContent = avg + "%";
       
       // Calculate absent today
       const today = new Date().toLocaleDateString('en-CA');
       const todayPresent = [...new Set(rows.filter(r => r[1] === today).map(r => r[0]))];
       const allRes = await fetch(`${API_BASE}/students`);
       const allS = await allRes.json();
       document.getElementById("stat-absent").textContent = allS.length - todayPresent.length;
    }

  } catch (err) {
    showMessage(err.message || err, true);
  }
}

function getSelectedMonth() {
  const sel = document.getElementById("month-select");
  return sel && sel.value !== "all" ? sel.value : "";
}

async function loadMonths() {
  const sel = document.getElementById("month-select");
  if (!sel) return;
  try {
    const res = await fetch(`${API_BASE}/report/months`);
    const months = await res.json();
    sel.innerHTML = `<option value="all">All Months</option>` + months.map(m => `<option value="${m}">${m}</option>`).join("");
  } catch (_) { /* ignore */ }
}

async function loadSelectedMonth() {
  await loadReport(getSelectedMonth());
}

function init3DBackground() {
  const container = document.getElementById("three-bg");
  if (!container || !window.THREE) return;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x051016, 0.0011);
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 2000);
  camera.position.z = 900;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const geometry = new THREE.BufferGeometry();
  const particleCount = window.innerWidth > 900 ? 2200 : 900;
  const vertices = [];
  for (let i = 0; i < particleCount; i++) {
    vertices.push((Math.random() - 0.5) * 2200);
    vertices.push((Math.random() - 0.5) * 2200);
    vertices.push((Math.random() - 0.5) * 2200);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  const material = new THREE.PointsMaterial({ color: 0x8af1ff, size: 2.2, opacity: 0.22, transparent: true });
  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  document.addEventListener("mousemove", e => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  function animate() {
    requestAnimationFrame(animate);
    particles.rotation.y += 0.0006;
    particles.rotation.x += 0.0002;
    camera.position.x += (mouseX * 260 - camera.position.x) * 0.05;
    camera.position.y += (mouseY * 260 - camera.position.y) * 0.05;
    camera.lookAt(scene.position);
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function initPage() {
  // Splash Screen Timeout
  setTimeout(() => {
    const splash = document.getElementById("splash-screen");
    if (splash) splash.classList.add("hidden");
  }, 3000);

  startCamera();
  init3DBackground();
  if (window.VanillaTilt) VanillaTilt.init(document.querySelectorAll("[data-tilt]"));

  const page = document.body.dataset.page;
  if (page === "index") {
    updateMonitorLists();
    setInterval(updateMonitorLists, 3000); // Auto-refresh every 3 seconds
  }
  if (page === "dashboard") {
    loadMonths().then(() => loadReport(getSelectedMonth()));
    dashboardInterval = setInterval(() => loadReport(getSelectedMonth()), 5000);
  }
}

async function sendAdminChat() {
  const input = document.getElementById("chat-input");
  const query = input.value.trim();
  if (!query) return;

  const messages = document.getElementById("chat-messages");
  messages.innerHTML += `<div class="msg user">${query}</div>`;
  input.value = "";
  messages.scrollTop = messages.scrollHeight;

  try {
    const res = await fetch(`${API_BASE}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    messages.innerHTML += `<div class="msg ai">${data.response || data.message}</div>`;
    messages.scrollTop = messages.scrollHeight;
  } catch (err) {
    messages.innerHTML += `<div class="msg ai error">Link lost: ${err.message}</div>`;
  }
}

async function generateAIReport() {
  const email = prompt("Enter email address (optional):", "iamramm8@gmail.com");
  
  const statusEl = document.getElementById("output");
  if (statusEl) statusEl.textContent = "🤖 AI is analyzing data and generating your report...";

  try {
    const res = await fetch(`${API_BASE}/ai/generate_report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    
    if (res.ok) {
      // Show AI Summary in a nice Alert/Modal
      const summaryFormatted = data.summary.replace(/\n/g, '<br>');
      const rawSummary = data.summary;
      
      // Update UI with Summary
      const summaryBox = document.createElement("div");
      summaryBox.className = "card ai-summary-popup";
      summaryBox.innerHTML = `
        <h3>Today's AI Intelligence Report</h3>
        <div class="summary-content">${summaryFormatted}</div>
        <div class="card-actions">
          <button class="btn primary" onclick="this.parentElement.parentElement.remove()">Dismiss</button>
          <a href="${API_BASE}/reports/latest" target="_blank" class="btn">Download PDF</a>
          <button class="btn" onclick="shareViaEmail(\`${rawSummary.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)">Share via Gmail</button>
        </div>
      `;
      document.querySelector(".dashboard").prepend(summaryBox);
      
      if (statusEl) statusEl.textContent = "Report Generated Successfully!";
    } else {
      throw new Error(data.message || "Report generation failed");
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = "AI Error: " + err.message;
    console.error(err);
  }
}

function toggleFullScreenChat() {
  const chat = document.getElementById("full-screen-chat");
  chat.classList.toggle("hidden");
}

function toggleChat() {
  const body = document.getElementById("chat-body");
  const icon = document.getElementById("chat-toggle-icon");
  if (body && icon) {
    body.classList.toggle("hidden");
    icon.textContent = body.classList.contains("hidden") ? "▲" : "▼";
  }
}

function shareViaEmail(summary) {
  const subject = encodeURIComponent(`Attendance Report - ${new Date().toLocaleDateString()}`);
  const body = encodeURIComponent(`Hello,\n\nHere is the AI-generated attendance report:\n\n${summary}\n\nGenerated by Smart Attendance System.`);
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=iamramm8@gmail.com&su=${subject}&body=${body}`;
  window.open(gmailUrl, '_blank');
}

let liveStream = null;
let liveInterval = null;

async function toggleLiveFeed() {
  const video = document.getElementById("live-video");
  const overlay = document.getElementById("live-overlay");
  const btn = document.getElementById("toggle-live");
  const status = document.getElementById("live-status");
  
  if (liveStream) {
    liveStream.getTracks().forEach(track => track.stop());
    liveStream = null;
    clearInterval(liveInterval);
    btn.textContent = "Start Live Tracking";
    status.textContent = "Offline";
    status.className = status.classList.contains("status-badge") ? "status-badge" : "badge";
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    return;
  }
  
  try {
    await fetch(`${API_BASE}/start_attendance`, { method: "POST" });
    liveStream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = liveStream;
    btn.textContent = "Stop Live Tracking";
    status.textContent = "LIVE";
    status.className = status.classList.contains("status-badge") ? "status-badge live" : "badge safe";
    
    video.onloadedmetadata = () => {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    };
    
    liveInterval = setInterval(async () => {
      if (!liveStream) return;
      
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      const image = canvas.toDataURL("image/jpeg");
      
      const res = await fetch(`${API_BASE}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image })
      });
      const data = await res.json();
      
      const ctx = overlay.getContext("2d");
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      
      if (data.status === "success" && data.recognized) {
        data.recognized.forEach((person) => {
          const [x, y, w, h] = person.box;
          const name = person.name;
          const status = person.status;
          const remaining = person.seconds_remaining;
          
          // Logic: Red if unmarked/unknown, Green if marked
          let color = "#ff4d4d"; // Red default
          if (status === "marked") {
            color = "#00ffcc"; // Green
          }
          
          ctx.strokeStyle = color;
          ctx.lineWidth = 4;
          ctx.strokeRect(x, y, w, h);
          
          // Label bg
          ctx.fillStyle = color;
          ctx.font = "bold 18px Outfit";
          const label = status === "marked" ? `${name} (SAFE)` : name;
          const textWidth = ctx.measureText(label).width;
          ctx.fillRect(x, y - 35, textWidth + 20, 35);
          
          // Name text
          ctx.fillStyle = "black";
          ctx.fillText(label, x + 10, y - 10);
          
          // Countdown text if marked
          if (status === "marked" && remaining > 0) {
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            const timerText = `${mins}m ${secs}s until next mark`;
            
            ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
            ctx.fillRect(x, y + h, ctx.measureText(timerText).width + 10, 25);
            
            ctx.fillStyle = "#ffffff";
            ctx.font = "14px Outfit";
            ctx.fillText(timerText, x + 5, y + h + 18);
          }
          
          if (status === "marked") {
            loadReport(); 
          }
        });
      }
    }, 1500); 
    
  } catch (err) {
    alert("Camera Error: " + err.message);
  }
}

window.startAttendance = startAttendance;
window.stopAttendance = stopAttendance;
window.registerStudent = registerStudent;
window.loadReport = loadReport;
window.searchFromDashboard = searchFromDashboard;
window.searchProfilePage = searchProfilePage;
window.openAdminEdit = openAdminEdit;
window.saveStudentUpdate = saveStudentUpdate;
window.loadSelectedMonth = loadSelectedMonth;
window.sendAdminChat = sendAdminChat;
window.generateAIReport = generateAIReport;
window.toggleChat = toggleChat;
window.shareViaEmail = shareViaEmail;
window.toggleLiveFeed = toggleLiveFeed;

document.addEventListener("DOMContentLoaded", initPage);

