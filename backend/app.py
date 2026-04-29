from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import cv2
import numpy as np
import os
import pickle
from datetime import datetime
import sqlite3
import base64
from dotenv import load_dotenv
from ai_reporting import AttendanceAI

# Initialize OpenCV LBPH Recognizer
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
recognizer = cv2.face.LBPHFaceRecognizer_create()
TRAINER_FILE = "data/trainer.yml"
LABELS_FILE = "data/labels.pkl"

def save_recognizer():
    os.makedirs("data", exist_ok=True)
    recognizer.save(TRAINER_FILE)
    with open(LABELS_FILE, "wb") as f:
        pickle.dump(label_map, f)

label_map = {} 
if os.path.exists(TRAINER_FILE) and os.path.exists(LABELS_FILE):
    recognizer.read(TRAINER_FILE)
    with open(LABELS_FILE, "rb") as f:
        label_map = pickle.load(f)

load_dotenv()
ai_handler = AttendanceAI()

app = Flask(__name__)
CORS(app)

DB_FILE = "attendance.db"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, date TEXT, time TEXT)")
    c.execute("CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, details TEXT)")
    conn.commit()
    conn.close()

init_db()

def base64_to_image(base64_str):
    try:
        img_data = base64.b64decode(base64_str.split(",")[1])
        np_arr = np.frombuffer(img_data, np.uint8)
        return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    except:
        return None

@app.route("/start_attendance", methods=["POST"])
def start_attendance(): return jsonify({"status": "success"})

@app.route("/register", methods=["POST"])
def register():
    data = request.json
    name, image_b64, details = data.get("name"), data.get("image"), data.get("details", "")
    if not name or not image_b64: return jsonify({"status": "error", "message": "Missing data"}), 400
    img = base64_to_image(image_b64)
    if img is None: return jsonify({"status": "error", "message": "Invalid image"}), 400
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.1, 6)
    if len(faces) == 0: return jsonify({"status": "error", "message": "No face detected"}), 400
    student_id = len(label_map) + 1
    label_map[student_id] = name
    face_samples, ids = [], []
    for (x, y, w, h) in faces:
        fr = gray[y:y+h, x:x+w]
        face_samples.extend([fr, cv2.flip(fr, 1)])
        ids.extend([student_id, student_id])
    recognizer.update(face_samples, np.array(ids))
    save_recognizer()
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO students (name, details) VALUES (?, ?)", (name, details))
    conn.commit()
    conn.close()
    return jsonify({"status": "success"})

@app.route("/attendance", methods=["POST"])
def attendance():
    data = request.json
    img = base64_to_image(data.get("image"))
    if img is None: return jsonify({"status": "error"}), 400
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.2, 5)
    results = []
    for (x, y, w, h) in faces:
        name, status, rem = "Unknown", "unmarked", 0
        if len(label_map) > 0:
            try:
                id_, conf = recognizer.predict(gray[y:y+h, x:x+w])
                if conf < 75:
                    name = label_map.get(id_, "Unknown")
            except Exception:
                pass
        
        if name != "Unknown":
            now = datetime.now()
            date, time = now.strftime("%Y-%m-%d"), now.strftime("%H:%M:%S")
            conn = sqlite3.connect(DB_FILE); c = conn.cursor()
            c.execute("SELECT time FROM attendance WHERE name=? AND date=? ORDER BY time DESC LIMIT 1", (name, date))
            row = c.fetchone()
            if row:
                diff = (now - datetime.strptime(f"{date} {row[0]}", "%Y-%m-%d %H:%M:%S")).total_seconds()
                if diff < 600: status, rem = "marked", int(600 - diff)
            if status == "unmarked":
                c.execute("INSERT INTO attendance (name, date, time) VALUES (?, ?, ?)", (name, date, time))
                conn.commit(); status, rem = "marked", 600
            conn.close()
        results.append({"name": name, "status": status, "seconds_remaining": rem, "box": [int(x), int(y), int(w), int(h)]})
    return jsonify({"status": "success", "recognized": results})

@app.route("/report")
def report():
    conn = sqlite3.connect(DB_FILE); c = conn.cursor()
    c.execute("SELECT name, date, time FROM attendance ORDER BY date DESC, time DESC")
    rows = c.fetchall(); conn.close()
    return jsonify(rows)

@app.route("/report/months")
def report_months():
    conn = sqlite3.connect(DB_FILE); c = conn.cursor()
    c.execute("SELECT DISTINCT substr(date, 1, 7) FROM attendance ORDER BY date DESC")
    months = [r[0] for r in c.fetchall()]; conn.close()
    return jsonify(months)

@app.route("/report/month/<ym>")
def report_month(ym):
    conn = sqlite3.connect(DB_FILE); c = conn.cursor()
    c.execute("SELECT name, date, time FROM attendance WHERE substr(date,1,7)=? ORDER BY date DESC, time DESC", (ym,))
    rows = c.fetchall(); conn.close()
    return jsonify(rows)

@app.route("/students")
def students_list():
    conn = sqlite3.connect(DB_FILE); c = conn.cursor()
    c.execute("SELECT name, details FROM students ORDER BY name")
    rows = c.fetchall(); conn.close()
    return jsonify([{"name": r[0], "details": r[1]} for r in rows])

@app.route("/student/<name>")
def student_profile(name):
    conn = sqlite3.connect(DB_FILE); c = conn.cursor()
    c.execute("SELECT name, details FROM students WHERE lower(name)=lower(?)", (name,))
    row = c.fetchone()
    if not row: conn.close(); return jsonify({"status": "error"}), 404
    res_name, details = row[0], row[1]
    c.execute("SELECT DISTINCT date FROM attendance ORDER BY date")
    dates = [r[0] for r in c.fetchall()]
    c.execute("SELECT date, time FROM attendance WHERE name=? ORDER BY date DESC, time DESC", (res_name,))
    recs = c.fetchall()
    present_dates = set([r[0] for r in recs])
    leave_dates = [d for d in dates if d not in present_dates]
    conn.close()
    pct = round((len(present_dates) / len(dates) * 100), 2) if dates else 0
    return jsonify({"name": res_name, "details": details, "percentage": pct, "total": len(dates), "present": len(present_dates), "leave_dates": leave_dates, "records": [{"date": r[0], "time": r[1]} for r in recs]})

@app.route("/ai/chat", methods=["POST"])
def ai_chat():
    data = request.json
    conn = sqlite3.connect(DB_FILE); c = conn.cursor()
    c.execute("SELECT name FROM students"); all_s = [r[0] for r in c.fetchall()]
    c.execute("SELECT name, time FROM attendance WHERE date=?", (datetime.now().strftime("%Y-%m-%d"),))
    recs = c.fetchall(); conn.close()
    return jsonify({"status": "success", "response": ai_handler.chat_with_attendance(data.get("query"), recs, all_students=all_s)})

@app.route("/ai/generate_report", methods=["POST"])
def ai_generate_report():
    conn = sqlite3.connect(DB_FILE); c = conn.cursor()
    c.execute("SELECT name FROM students"); all_s = [r[0] for r in c.fetchall()]
    c.execute("SELECT name, date, time FROM attendance WHERE date=?", (datetime.now().strftime("%Y-%m-%d"),))
    recs = c.fetchall(); conn.close()
    summary = ai_handler.generate_ai_summary(recs, all_students=all_s)
    ai_handler.create_pdf_report(summary, recs)
    return jsonify({"status": "success", "summary": summary, "pdf_url": "/reports/latest"})

@app.route("/reports/latest")
def get_latest_report():
    if not os.path.exists("reports"):
        return jsonify({"status": "error", "message": "No reports generated yet"}), 404
    files = [f for f in os.listdir("reports") if f.endswith(".pdf")]
    if not files:
        return jsonify({"status": "error", "message": "No reports found"}), 404
    latest = max([os.path.join("reports", f) for f in files], key=os.path.getctime)
    return send_from_directory("reports", os.path.basename(latest))


@app.route("/")
def index():
    return jsonify({"status": "Backend is running!"})


if __name__ == "__main__":
    app.run(debug=True)
