from flask import Flask, request, jsonify, send_file, Response, send_from_directory
from flask_cors import CORS
import cv2
import numpy as np
import os
import pickle
from datetime import datetime
import base64
import time
import threading
from dotenv import load_dotenv
import pymongo
from bson.binary import Binary

# ─── Environment ─────────────────────────────────────────────────────────────
load_dotenv()

# ─── Face Recognition Setup ──────────────────────────────────────────────────
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
cascade_lock = threading.Lock()
recognizer   = cv2.face.LBPHFaceRecognizer_create()
BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
TRAINER_FILE = os.path.join(BASE_DIR, "trainer.yml")
LABELS_FILE  = os.path.join(BASE_DIR, "labels.pkl")

# ─── AI Reporting (safe import) ───────────────────────────────────────────────
try:
    from ai_reporting import AttendanceAI
    ai_handler = AttendanceAI()
    AI_ENABLED = True
    print("[OK] AI Reporting enabled.", flush=True)
except Exception as ai_err:
    ai_handler = None
    AI_ENABLED = False
    print(f"[WARN] AI Reporting disabled (no API key or import error): {ai_err}", flush=True)

# ─── MongoDB: Local First (Toyota Reliable) ───────────────────────────────────
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")

def connect_mongo(uri):
    is_local = "localhost" in uri or "127.0.0.1" in uri
    try:
        if is_local:
            c = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        else:
            import certifi
            c = pymongo.MongoClient(
                uri,
                tlsCAFile=certifi.where(),
                serverSelectionTimeoutMS=5000,
                tlsAllowInvalidCertificates=True
            )
        c.admin.command('ping')
        print(f"[OK] MongoDB Connected: {'LOCAL' if is_local else 'CLOUD'}", flush=True)
        return c
    except Exception as e:
        print(f"[ERR] MongoDB Connection Failed: {e}", flush=True)
        return None

print("Connecting to MongoDB...", flush=True)
client = connect_mongo(MONGO_URI)

if client is None:
    raise RuntimeError(
        "FATAL: Cannot connect to MongoDB. "
        "Run 'net start MongoDB' or 'mongod' first."
    )

db             = client["smartslate"]
students_col   = db["students"]
attendance_col = db["attendance"]
config_col     = db["config"]

# Safe index creation
try:
    attendance_col.create_index([("name", 1), ("date", 1), ("time", -1)])
    students_col.create_index([("name", 1)], unique=True)
    print("[OK] MongoDB indexes ensured.", flush=True)
except Exception as idx_err:
    print(f"[WARN] Index creation skipped: {idx_err}", flush=True)

# ─── Face Model Persistence ──────────────────────────────────────────────────
def save_recognizer():
    """Save model locally AND back it up to MongoDB config collection."""
    try:
        recognizer.save(TRAINER_FILE)
        with open(LABELS_FILE, "wb") as f:
            pickle.dump(label_map, f)
        # Backup to DB
        with open(TRAINER_FILE, "rb") as f:
            trainer_bin = Binary(f.read())
        with open(LABELS_FILE, "rb") as f:
            labels_bin = Binary(f.read())
        config_col.update_one(
            {"type": "face_model"},
            {"$set": {"trainer": trainer_bin, "labels": labels_bin, "updated_at": datetime.now()}},
            upsert=True
        )
        print("[OK] Face model saved locally + backed up to DB.", flush=True)
    except Exception as e:
        print(f"[ERR] save_recognizer error: {e}", flush=True)

def load_recognizer():
    """Load face model. Try DB first (handles fresh installs), fall back to local files."""
    global label_map
    try:
        model_data = config_col.find_one({"type": "face_model"})
        if model_data and "trainer" in model_data and "labels" in model_data:
            with open(TRAINER_FILE, "wb") as f:
                f.write(model_data["trainer"])
            with open(LABELS_FILE, "wb") as f:
                f.write(model_data["labels"])
            print("[OK] Face model loaded from DB backup.", flush=True)
    except Exception as e:
        print(f"[WARN] DB model load failed, using local files: {e}", flush=True)

    if os.path.exists(TRAINER_FILE) and os.path.exists(LABELS_FILE):
        try:
            recognizer.read(TRAINER_FILE)
            with open(LABELS_FILE, "rb") as f:
                label_map = pickle.load(f)
            print(f"[OK] Recognizer loaded. {len(label_map)} student(s) registered.", flush=True)
        except Exception as e:
            print(f"[WARN] Could not read local model: {e}", flush=True)
    else:
        print("[INFO] No face model found. Register students first.", flush=True)

label_map = {}
load_recognizer()

# ─── Flask App ────────────────────────────────────────────────────────────────
frontend_dir = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
app = Flask(__name__, static_folder=frontend_dir, static_url_path="")
CORS(app)

# ─── Helpers ─────────────────────────────────────────────────────────────────
def base64_to_image(base64_str):
    try:
        # Handle both "data:image/...;base64,XXX" and raw base64
        if "," in base64_str:
            base64_str = base64_str.split(",")[1]
        img_data = base64.b64decode(base64_str)
        np_arr   = np.frombuffer(img_data, np.uint8)
        return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    except Exception:
        return None

# ─── Routes ──────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    """Liveness check — useful for monitoring."""
    return jsonify({"status": "ok", "students": students_col.count_documents({})}), 200

@app.route("/start_attendance", methods=["POST"])
def start_attendance():
    return jsonify({"status": "success"})

@app.route("/stop_attendance", methods=["POST"])
def stop_attendance():
    return jsonify({"status": "success"})

@app.route("/register", methods=["POST"])
def register():
    try:
        data = request.json or {}
        name      = (data.get("name") or "").strip()
        image_b64 = data.get("image", "")
        details   = (data.get("details") or "").strip()

        if not name:
            return jsonify({"status": "error", "message": "Name is required."}), 400
        if not image_b64:
            return jsonify({"status": "error", "message": "No image received."}), 400

        img = base64_to_image(image_b64)
        if img is None:
            return jsonify({"status": "error", "message": "Could not decode image."}), 400

        gray  = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        with cascade_lock:
            faces = face_cascade.detectMultiScale(gray, 1.1, 6)

        if len(faces) == 0:
            return jsonify({"status": "error", "message": "No face detected. Face the camera directly."}), 400
        
        # If multiple faces (or false positives) are detected, pick the largest one (the person closest to camera)
        if len(faces) > 1:
            faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
            print(f"[WARN] Multiple faces detected during registration. Auto-selecting the largest face.", flush=True)

        (x, y, w, h) = faces[0]

        # Check for duplicate face
        if len(label_map) > 0:
            try:
                id_, conf = recognizer.predict(gray[y:y+h, x:x+w])
                if conf < 80:
                    existing = label_map.get(id_, "Unknown")
                    return jsonify({"status": "error", "message": f"Face already registered as '{existing}'."}), 400
            except Exception:
                pass

        # Assign ID and train
        student_id = max(label_map.keys(), default=0) + 1
        label_map[student_id] = name

        face_region = gray[y:y+h, x:x+w]
        face_samples = [face_region, cv2.flip(face_region, 1)]
        ids = [student_id, student_id]
        recognizer.update(face_samples, np.array(ids))
        save_recognizer()

        # Save to DB (upsert so re-registering updates details)
        students_col.update_one(
            {"name": name},
            {"$set": {"name": name, "details": details, "registered_at": datetime.now()}},
            upsert=True
        )
        print(f"[OK] Registered: {name} (id={student_id})", flush=True)
        return jsonify({"status": "success", "message": f"{name} registered successfully."})

    except Exception as e:
        print(f"[ERR] Register error: {e}", flush=True)
        return jsonify({"status": "error", "message": "Server error during registration."}), 500

@app.route("/report")
def report():
    try:
        rows = list(attendance_col.find({}, {"_id": 0}).sort([("date", -1), ("time", -1)]))
        return jsonify([[r["name"], r["date"], r["time"]] for r in rows])
    except Exception as e:
        print(f"[ERR] /report error: {e}")
        return jsonify([])

@app.route("/report/months")
def report_months():
    try:
        months = attendance_col.distinct("date")
        months = sorted(set(d[:7] for d in months), reverse=True)
        return jsonify(months)
    except Exception as e:
        return jsonify([])

@app.route("/report/month/<ym>")
def report_month(ym):
    try:
        rows = list(attendance_col.find(
            {"date": {"$regex": f"^{ym}"}}, {"_id": 0}
        ).sort([("date", -1), ("time", -1)]))
        return jsonify([[r["name"], r["date"], r["time"]] for r in rows])
    except Exception as e:
        return jsonify([])

@app.route("/students")
def students_list():
    try:
        rows = list(students_col.find({}, {"_id": 0, "name": 1, "details": 1}).sort("name", 1))
        return jsonify(rows)
    except Exception as e:
        return jsonify([])

@app.route("/student/<name>")
def student_profile(name):
    try:
        student = students_col.find_one(
            {"name": {"$regex": f"^{name}$", "$options": "i"}}, {"_id": 0}
        )
        if not student:
            return jsonify({"status": "error", "message": "Student not found."}), 404

        all_dates    = sorted(attendance_col.distinct("date"))
        recs         = list(attendance_col.find(
            {"name": student["name"]}, {"_id": 0}
        ).sort([("date", -1), ("time", -1)]))
        present_dates = set(r["date"] for r in recs)
        leave_dates   = [d for d in all_dates if d not in present_dates]
        pct = round(len(present_dates) / len(all_dates) * 100, 2) if all_dates else 0

        return jsonify({
            "name":        student["name"],
            "details":     student.get("details", ""),
            "percentage":  pct,
            "total":       len(all_dates),
            "present":     len(present_dates),
            "leave_dates": leave_dates,
            "records":     recs
        })
    except Exception as e:
        print(f"[ERR] /student/{name} error: {e}")
        return jsonify({"status": "error", "message": "Server error."}), 500

@app.route("/ai/chat", methods=["POST"])
def ai_chat():
    if not AI_ENABLED:
        return jsonify({"status": "success", "response": "AI is not configured. Set GROQ_API_KEY in .env to enable."})
    try:
        data    = request.json or {}
        query   = data.get("query", "")
        all_s   = [s["name"] for s in students_col.find({}, {"name": 1})]
        today   = datetime.now().strftime("%Y-%m-%d")
        recs    = [(r["name"], r["time"]) for r in attendance_col.find({"date": today})]
        response = ai_handler.chat_with_attendance(query, recs, all_students=all_s)
        return jsonify({"status": "success", "response": response})
    except Exception as e:
        print(f"[ERR] /ai/chat error: {e}")
        return jsonify({"status": "error", "response": f"AI error: {str(e)}"}), 500

@app.route("/ai/generate_report", methods=["POST"])
def ai_generate_report():
    if not AI_ENABLED:
        return jsonify({"status": "error", "message": "AI not configured."}), 503
    try:
        all_s   = [s["name"] for s in students_col.find({}, {"name": 1})]
        today   = datetime.now().strftime("%Y-%m-%d")
        recs    = [(r["name"], r["date"], r["time"]) for r in attendance_col.find({"date": today})]
        summary = ai_handler.generate_ai_summary(recs, all_students=all_s)
        filepath = ai_handler.create_pdf_report(summary, recs)
        return jsonify({"status": "success", "summary": summary, "pdf_url": "/reports/latest"})
    except Exception as e:
        print(f"[ERR] /ai/generate_report error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/reports/latest")
def get_latest_report():
    # Use a reports folder inside backend
    report_dir = os.path.join(BASE_DIR, "reports")
    os.makedirs(report_dir, exist_ok=True)
    files = [f for f in os.listdir(report_dir) if f.startswith("report_") and f.endswith(".pdf")]
    if not files:
        # Also check /tmp for backwards compat
        tmp_dir = "/tmp" if os.path.exists("/tmp") else os.path.join(BASE_DIR, "reports")
        tmp_files = [f for f in os.listdir(tmp_dir) if f.startswith("report_") and f.endswith(".pdf")]
        if tmp_files:
            latest = max([os.path.join(tmp_dir, f) for f in tmp_files], key=os.path.getctime)
            return send_file(latest, as_attachment=True)
        return jsonify({"status": "error", "message": "No reports found."}), 404
    latest = max([os.path.join(report_dir, f) for f in files], key=os.path.getctime)
    return send_file(latest, as_attachment=True)

# ─── Camera ───────────────────────────────────────────────────────────────────
class VideoCamera:
    def __init__(self):
        self.cap           = None
        self.latest_frame  = None
        self.last_scan_name = "Awaiting"
        self.last_scan_time = 0
        self.lock          = threading.Lock()
        self.is_active     = True
        self._open_camera()
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def _open_camera(self):
        for idx in [0, 1, 2]:
            cap = cv2.VideoCapture(idx)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                self.cap = cap
                print(f"[OK] Camera opened on index {idx}.", flush=True)
                return
        print("[ERR] No camera found.", flush=True)
        self.cap = None

    def _capture_loop(self):
        """
        Toyota-Reliable loop:
        - Per-face 10-min cooldown (in-memory dict, DB-backed for restart survival)
        - Camera auto-reconnects
        - Never crashes — all exceptions caught
        """
        COOLDOWN   = 600   # 10 minutes
        frame_skip = 0
        face_cooldowns = {}   # { name: unix_timestamp_last_logged }
        db_checked     = set() # names already checked against DB on this boot

        while self.is_active:
            # ── Camera health check ──────────────────────────────────────────
            if self.cap is None or not self.cap.isOpened():
                print("[WARN] Camera unavailable. Reconnecting in 5s...", flush=True)
                time.sleep(5)
                self._open_camera()
                continue

            success, frame = self.cap.read()
            if not success:
                time.sleep(0.1)
                continue

            # ── Face detection every 3rd frame (half-res for speed) ──────────
            try:
                frame_skip += 1
                if frame_skip % 3 == 0:
                    small = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
                    gray_small = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                    with cascade_lock:
                        self.last_faces = face_cascade.detectMultiScale(gray_small, 1.2, 5)

                faces     = getattr(self, 'last_faces', [])
                gray_full = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                for (x, y, w, h) in faces:
                    x, y, w, h = x*2, y*2, w*2, h*2   # scale back to full-res
                    name  = "Unknown"
                    color = (80, 80, 80)

                    if len(label_map) > 0:
                        try:
                            id_, conf = recognizer.predict(gray_full[y:y+h, x:x+w])
                            if conf < 80:
                                name  = label_map.get(id_, "Unknown")
                                color = (0, 200, 80)  # green = recognised

                                now    = datetime.now()
                                now_ts = time.time()
                                date   = now.strftime("%Y-%m-%d")
                                t_str  = now.strftime("%H:%M:%S")

                                # ── 10-min lock: in-memory first ─────────────
                                last_logged = face_cooldowns.get(name, 0)
                                elapsed     = now_ts - last_logged

                                if elapsed >= COOLDOWN:
                                    # On first sighting after boot, cross-check DB
                                    if name not in db_checked:
                                        db_checked.add(name)
                                        last_db = attendance_col.find_one(
                                            {"name": name, "date": date},
                                            sort=[("time", -1)]
                                        )
                                        if last_db:
                                            last_dt    = datetime.strptime(
                                                f"{date} {last_db['time']}", "%Y-%m-%d %H:%M:%S"
                                            )
                                            elapsed_db = (now - last_dt).total_seconds()
                                            if elapsed_db < COOLDOWN:
                                                # Restore cooldown state from DB
                                                face_cooldowns[name] = now_ts - elapsed_db
                                                remaining = int(COOLDOWN - elapsed_db)
                                                color = (0, 165, 255)  # orange = locked
                                                cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
                                                cv2.putText(frame, f"{name} [{remaining}s]",
                                                            (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
                                                continue

                                    # ── Log to MongoDB ────────────────────────
                                    attendance_col.insert_one({
                                        "name": name, "date": date, "time": t_str
                                    })
                                    face_cooldowns[name] = now_ts
                                    self.last_scan_name  = name
                                    self.last_scan_time  = now_ts
                                    print(f"[OK] Logged: {name} at {t_str}", flush=True)

                                else:
                                    # Still locked — show countdown
                                    remaining = int(COOLDOWN - elapsed)
                                    color = (0, 165, 255)
                                    cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
                                    cv2.putText(frame, f"{name} [{remaining}s]",
                                                (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
                                    continue

                        except Exception:
                            pass  # single frame error — never crash loop

                    cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
                    cv2.putText(frame, name, (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)

            except Exception as loop_err:
                print(f"[WARN] Frame error (non-fatal): {loop_err}")

            # Encode frame
            ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if ret:
                with self.lock:
                    self.latest_frame = buffer.tobytes()

            time.sleep(0.033)  # ~30 FPS — stable


shared_camera = None

def get_camera():
    global shared_camera
    if shared_camera is None:
        print("Initializing camera...", flush=True)
        shared_camera = VideoCamera()
    return shared_camera

# Boot camera
get_camera()

# ─── Camera Routes ────────────────────────────────────────────────────────────

def gen_frames():
    cam = get_camera()
    while True:
        with cam.lock:
            frame = cam.latest_frame
        if frame:
            yield (
                b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n'
                b'Content-Length: ' + str(len(frame)).encode() + b'\r\n\r\n'
                + frame + b'\r\n'
            )
        time.sleep(0.05)

@app.route('/video_feed')
def video_feed():
    return Response(gen_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route("/capture_frame")
def capture_frame():
    cam = get_camera()
    with cam.lock:
        if cam.latest_frame:
            return Response(cam.latest_frame, mimetype='image/jpeg')
    return jsonify({"error": "No frame available yet."}), 503

@app.route('/mobile_view')
def mobile_view():
    return """<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SmartSlate | Live Feed</title>
  <style>
    body { margin:0; background:#000; display:flex; align-items:center;
           justify-content:center; height:100vh; overflow:hidden; }
    img  { max-width:100%; max-height:100vh; object-fit:contain; }
  </style>
</head>
<body><img src="/video_feed"></body>
</html>"""

@app.route("/api/realtime/dashboard")
def dashboard_stats():
    try:
        today         = datetime.now().strftime("%Y-%m-%d")
        total         = students_col.count_documents({})
        present_count = len(attendance_col.distinct("name", {"date": today}))
        cam           = get_camera()
        cooldown_rem  = max(0, int(600 - (time.time() - cam.last_scan_time))) if cam.last_scan_time > 0 else 0
        return jsonify({
            "present_today":  present_count,
            "absent_today":   max(0, total - present_count),
            "total_students": total,
            "present_names":  [],
            "last_user":      cam.last_scan_name,
            "next_scan_in":   cooldown_rem
        })
    except Exception as e:
        print(f"[ERR] /api/realtime/dashboard error: {e}")
        return jsonify({"present_today": 0, "absent_today": 0, "total_students": 0, "present_names": []})

# ─── Static Pages ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_file(os.path.join(frontend_dir, "index.html"))

@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory(frontend_dir, path)

# ─── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=8080, debug=False, threaded=True, use_reloader=False)
