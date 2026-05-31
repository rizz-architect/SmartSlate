const API_BASE = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
  ? "http://127.0.0.1:8080"
  : window.location.origin;

// Global State
let currentProfileData = null;

// Clock
setInterval(() => {
  const clock = document.getElementById('clock');
  if (clock) clock.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}, 1000);

// Unified Data Fetcher
async function fetchData() {
  const page = document.body.dataset.page;

  try {
    const [reportRes, studentsRes, realRes] = await Promise.all([
      fetch(`${API_BASE}/report`),
      fetch(`${API_BASE}/students`),
      fetch(`${API_BASE}/api/realtime/dashboard`)
    ]);

    if (!reportRes.ok || !studentsRes.ok || !realRes.ok) return;

    const allRecords = await reportRes.json();
    const allStudents = await studentsRes.json();
    const realData = await realRes.json();

    // Update Dashboard Stats (Index Only)
    if (page === 'index') {
      const verifiedEl = document.getElementById('total-verified');
      const ratioEl = document.getElementById('present-ratio');

      const today = new Date().toLocaleDateString('en-CA');
      const todayRecords = allRecords.filter(r => r[1] === today);
      const presentCount = [...new Set(todayRecords.map(r => r[0]))].length;

      if (verifiedEl) verifiedEl.textContent = presentCount;
      if (ratioEl) ratioEl.textContent = allStudents.length > 0 ? Math.round((presentCount / allStudents.length) * 100) + '%' : '0%';

      renderMonitor(todayRecords);
    } else if (page === 'dashboard') {
      const today = new Date().toLocaleDateString('en-CA');
      const todayRecords = allRecords.filter(r => r[1] === today);
      const presentNames = [...new Set(todayRecords.map(r => r[0]))];
      renderDashboard(allRecords, allStudents, presentNames);
    }
  } catch (err) {
    console.error("Connectivity Interrupted:", err);
  }
}

// Page Specific Renderers
function renderMonitor(todayRecords) {
  const list = document.getElementById('list-present');
  if (!list) return;

  if (todayRecords.length === 0) {
    list.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">Awaiting Optical Scan...</div>';
    return;
  }

  list.innerHTML = todayRecords.map((r, i) => `
    <div class="reveal" style="animation-delay: ${i * 50}ms; margin-bottom: 0.5rem;">
      <div style="background: var(--surface); padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-md); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h4 style="font-size: 0.9rem; font-weight: 500;">${r[0]}</h4>
          <p class="mono" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">${r[2]}</p>
        </div>
        <div class="status-tag mono">
          <span class="status-dot"></span> SECURE
        </div>
      </div>
    </div>
  `).join('');
}

function renderDashboard(allRecords, allStudents, presentNames) {
  const statPresent = document.getElementById('stat-present');
  const statTotal = document.getElementById('stat-total');
  const statAbsent = document.getElementById('stat-absent');
  const tableBody = document.getElementById('table-body');

  if (statPresent) statPresent.textContent = presentNames.length;
  if (statTotal) statTotal.textContent = allStudents.length;
  if (statAbsent) statAbsent.textContent = allStudents.length - presentNames.length;

  if (tableBody) {
    tableBody.innerHTML = allRecords.map((r, i) => `
      <tr class="reveal" style="animation-delay: ${i * 20}ms">
        <td class="mono" style="font-weight: 500; cursor:pointer;" onclick="viewStudent('${r[0]}')">${r[0]}</td>
        <td class="mono" style="color: var(--text-muted);">${r[1]}</td>
        <td class="mono" style="color: var(--text-muted);">${r[2]}</td>
        ${[1, 2, 3, 4, 5, 6, 7, 8].map(p => {
          const hour = p + 7;
          const isPresent = r[2].startsWith(hour < 10 ? '0' + hour : '' + hour);
          return `<td style="text-align:center">${isPresent ? '<span class="status-tag mono"><span class="status-dot"></span> P</span>' : '<span style="color:var(--border)">-</span>'}</td>`;
        }).join('')}
      </tr>
    `).join('');
  }
}

async function registerStudent() {
  const nameInput = document.getElementById('reg-name');
  const detailsInput = document.getElementById('reg-details');
  const messageEl = document.getElementById('reg-message');
  if (!nameInput || !messageEl) return;

  const name = nameInput.value.trim();
  const details = detailsInput ? detailsInput.value.trim() : '';
  if (!name) {
    messageEl.textContent = 'Please enter a name before registering.';
    return;
  }

  messageEl.textContent = 'Capturing your face...';
  try {
    const frameRes = await fetch(`${API_BASE}/capture_frame`);
    if (!frameRes.ok) {
      throw new Error('Could not capture the current camera frame. Make sure the video feed is visible.');
    }

    const blob = await frameRes.blob();
    const reader = new FileReader();
    reader.onloadend = async () => {
      const imageBase64 = reader.result;
      const res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, image: imageBase64, details })
      });

      const data = await res.json();
      if (!res.ok) {
        messageEl.textContent = data.message || 'Registration failed. Please try again.';
        return;
      }

      messageEl.textContent = 'Face registered successfully! You can now use the attendance scanner.';
      nameInput.value = '';
      if (detailsInput) detailsInput.value = '';
    };
    reader.readAsDataURL(blob);
  } catch (err) {
    messageEl.textContent = err.message || 'Registration error. Check the backend logs and camera.';
  }
}

// AI Chat Logic
function toggleChat() {
  const overlay = document.getElementById('chat-overlay');
  overlay.style.display = overlay.style.display === 'none' ? 'flex' : 'none';
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const query = input.value.trim();
  if (!query) return;

  const msgBox = document.getElementById('chat-messages');
  msgBox.innerHTML += `<div class="reveal" style="align-self: flex-end; background: var(--text-main); color: var(--bg); padding: 0.75rem 1rem; border-radius: var(--radius-md); font-size: 0.9rem; max-width: 80%;">` + query + `</div>`;
  input.value = "";
  
  const loadingId = 'loading-' + Date.now();
  msgBox.innerHTML += `<div id="${loadingId}" class="mono reveal" style="align-self: flex-start; color: var(--text-muted); font-size: 0.75rem;">Connecting...</div>`;
  msgBox.scrollTop = msgBox.scrollHeight;

  try {
    const res = await fetch(`${API_BASE}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    document.getElementById(loadingId).remove();
    msgBox.innerHTML += `
      <div class="reveal" style="align-self: flex-start; background: var(--surface); border: 1px solid var(--border); padding: 1rem; border-radius: var(--radius-md); font-size: 0.9rem; max-width: 80%; line-height: 1.5;">
        ${data.response}
      </div>
    `;
    msgBox.scrollTop = msgBox.scrollHeight;
  } catch (err) {
    document.getElementById(loadingId).innerText = "Connection Failed";
  }
}

// Theme Management
function initTheme() {
  const currentTheme = localStorage.getItem('aura-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
}

// Boot
window.addEventListener('load', () => {
  initTheme();
  const page = document.body.dataset.page;

  if (page === 'profile') {
    renderProfile();
  } else {
    fetchData();
    setInterval(fetchData, 5000);
  }
});

// Student Profile
async function viewStudent(name) {
  window.location.href = `profile.html?name=${encodeURIComponent(name)}`;
}

async function renderProfile() {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('name');
  if (!name) return;

  const container = document.getElementById('profile-container');
  try {
    const res = await fetch(`${API_BASE}/student/${encodeURIComponent(name)}`);
    const data = await res.json();

    container.innerHTML = `
      <div class="bento-grid">
        <div class="bento-item col-12 reveal" style="padding: 2rem 0; margin-bottom: 2rem; border-bottom: 1px solid var(--border);">
          <div style="font-size: 0.75rem; font-weight: 500; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.5rem;">IDENTITY PROFILE</div>
          <h1 style="font-size: 3rem;">${data.name}</h1>
          <p style="color: var(--text-muted); font-size: 1rem; margin-top: 0.5rem;">${data.details}</p>
        </div>

        <div class="bento-item col-4 reveal" style="animation-delay: 0.1s;">
          <div class="bezel-outer">
            <div class="bezel-inner">
              <span class="stat-label">Reliability Index</span>
              <div class="stat-value mono">${data.percentage}%</div>
            </div>
          </div>
        </div>

        <div class="bento-item col-4 reveal" style="animation-delay: 0.2s;">
          <div class="bezel-outer">
            <div class="bezel-inner">
              <span class="stat-label">Successful Checks</span>
              <div class="stat-value mono">${data.present}</div>
            </div>
          </div>
        </div>

        <div class="bento-item col-4 reveal" style="animation-delay: 0.3s;">
          <div class="bezel-outer">
            <div class="bezel-inner">
              <span class="stat-label">Total Sessions</span>
              <div class="stat-value mono">${data.total}</div>
            </div>
          </div>
        </div>

        <div class="bento-item col-12 reveal" style="animation-delay: 0.4s; margin-top: 2rem;">
          <div class="bezel-outer">
            <div class="bezel-inner" style="padding: 0 !important;">
               <div style="padding: 1.5rem; border-bottom: 1px solid var(--border);">
                  <h3 style="font-size: 1.1rem;">Access History</h3>
               </div>
               <div style="padding: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
                  ${data.records.map((r, i) => `
                    <div class="reveal" style="animation-delay: ${i * 30}ms; background: var(--surface-hover); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem; display: flex; justify-content: space-between; align-items: center;">
                      <div>
                        <h4 style="font-size: 0.9rem; font-weight: 500;">${r.date}</h4>
                        <p class="mono" style="font-size: 0.75rem; color: var(--text-muted);">${r.time}</p>
                      </div>
                      <div class="status-tag mono"><span class="status-dot"></span> LOGGED</div>
                    </div>
                  `).join('')}
               </div>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = "<div class='mono reveal' style='text-align:center; padding:5rem; color: var(--text-muted);'>ACCESS_DENIED</div>";
  }
}
