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
    status.className = "badge";
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
    status.className = "badge safe";
    
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
          
          const color = name === "Unknown" ? "#ff4d4d" : "#00ffcc";
          
          // Draw Box
          ctx.strokeStyle = color;
          ctx.lineWidth = 4;
          ctx.strokeRect(x, y, w, h);
          
          // Draw Name Label
          ctx.fillStyle = color;
          ctx.font = "bold 20px Outfit";
          const textWidth = ctx.measureText(name).width;
          ctx.fillRect(x, y - 35, textWidth + 20, 35);
          
          ctx.fillStyle = "black";
          ctx.fillText(name, x + 10, y - 10);
          
          if (name !== "Unknown") {
            loadReport(); 
          }
        });
      }
    }, 1500); 
    
  } catch (err) {
    alert("Camera Error: " + err.message);
  }
}
