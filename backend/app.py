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
import pymongo
from bson.binary import Binary


# Initialize OpenCV LBPH Recognizer
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
recognizer = cv2.face.LBPHFaceRecognizer_create()
TRAINER_FILE = "data/trainer.yml"
LABELS_FILE = "data/labels.pkl"

load_dotenv()
ai_handler = AttendanceAI()

# MongoDB Configuration
MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
client = pymongo.MongoClient(MONGO_URI)
db = client["smart_attendance"]
students_col = db["students"]
attendance_col = db["attendance"]
config_col = db["config"]

def save_recognizer():
    os.makedirs("data", exist_ok=True)
    recognizer.save(TRAINER_FILE)
    with open(LABELS_FILE, "wb") as f:
        pickle.dump(label_map, f)
    
    # ROBUST: Sync to Cloud
    with open(TRAINER_FILE, "rb") as f:
        trainer_bin = Binary(f.read())
    with open(LABELS_FILE, "rb") as f:
        labels_bin = Binary(f.read())
    
    config_col.update_one(
        {"type": "face_model"},
        {"$set": {"trainer": trainer_bin, "labels": labels_bin, "updated_at": datetime.now()}},
        upsert=True
    )

def load_recognizer():
    global label_map
    # Try loading from cloud first for ROBUSTNESS
    model_data = config_col.find_one({"type": "face_model"})
    if model_data:
        os.makedirs("data", exist_ok=True)
        with open(TRAINER_FILE, "wb") as f:
            f.write(model_data["trainer"])
        with open(LABELS_FILE, "wb") as f:
            f.write(model_data["labels"])
        print("✅ Face Intelligence Synced from Cloud")
    
    if os.path.exists(TRAINER_FILE) and os.path.exists(LABELS_FILE):
        recognizer.read(TRAINER_FILE)
        with open(LABELS_FILE, "rb") as f:
            label_map = pickle.load(f)

label_map = {} 
load_recognizer()


app = Flask(__name__)
CORS(app)

# DB Init is handled automatically by MongoDB


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
    
    if len(faces) == 0: 
        return jsonify({"status": "error", "message": "No face detected. Please face the camera."}), 400
    if len(faces) > 1:
        return jsonify({"status": "error", "message": "Multiple faces detected! Only one person should be in the frame during registration."}), 400

    # ROBUST: Check if this face is already in our system
    (x, y, w, h) = faces[0]
    if len(label_map) > 0:
        try:
            id_, conf = recognizer.predict(gray[y:y+h, x:x+w])
            if conf < 60: # High precision check
                existing_name = label_map.get(id_, "Unknown")
                return jsonify({"status": "error", "message": f"This face is already registered as '{existing_name}'!"}), 400
        except:
            pass

    student_id = len(label_map) + 1

    label_map[student_id] = name
    face_samples, ids = [], []
    for (x, y, w, h) in faces:
        fr = gray[y:y+h, x:x+w]
        face_samples.extend([fr, cv2.flip(fr, 1)])
        ids.extend([student_id, student_id])
    recognizer.update(face_samples, np.array(ids))
    save_recognizer()
    students_col.update_one(
        {"name": name},
        {"$set": {"details": details}},
        upsert=True
    )
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
                # Professional Threshold: Lower is more accurate (0-100)
                if conf < 65: 
                    name = label_map.get(id_, "Unknown")
            except Exception as e:
                print(f"Prediction Error: {e}")
                pass
        
        if name != "Unknown":
            now = datetime.now()
            date, time = now.strftime("%Y-%m-%d"), now.strftime("%H:%M:%S")
            last_entry = attendance_col.find_one({"name": name, "date": date}, sort=[("time", -1)])
            if last_entry:
                diff = (now - datetime.strptime(f"{date} {last_entry['time']}", "%Y-%m-%d %H:%M:%S")).total_seconds()
                if diff < 600: status, rem = "marked", int(600 - diff)
            if status == "unmarked":
                attendance_col.insert_one({"name": name, "date": date, "time": time})
                status, rem = "marked", 600
        results.append({"name": name, "status": status, "seconds_remaining": rem, "box": [int(x), int(y), int(w), int(h)]})
    return jsonify({"status": "success", "recognized": results})

@app.route("/report")
def report():
    rows = list(attendance_col.find({}, {"_id": 0}).sort([("date", -1), ("time", -1)]))
    # Format for frontend: [name, date, time]
    data = [[r["name"], r["date"], r["time"]] for r in rows]
    return jsonify(data)


@app.route("/report/months")
def report_months():
    months = attendance_col.distinct("date")
    months = sorted(list(set([d[:7] for d in months])), reverse=True)
    return jsonify(months)


@app.route("/report/month/<ym>")
def report_month(ym):
    rows = list(attendance_col.find({"date": {"$regex": f"^{ym}"}}, {"_id": 0}).sort([("date", -1), ("time", -1)]))
    data = [[r["name"], r["date"], r["time"]] for r in rows]
    return jsonify(data)


@app.route("/students")
def students_list():
    rows = list(students_col.find({}, {"_id": 0, "name": 1, "details": 1}).sort("name", 1))
    return jsonify(rows)


@app.route("/student/<name>")
def student_profile(name):
    student = students_col.find_one({"name": {"$regex": f"^{name}$", "$options": "i"}}, {"_id": 0})
    if not student: return jsonify({"status": "error"}), 404
    
    all_dates = sorted(attendance_col.distinct("date"))
    recs = list(attendance_col.find({"name": student["name"]}, {"_id": 0}).sort([("date", -1), ("time", -1)]))
    
    present_dates = set([r["date"] for r in recs])
    leave_dates = [d for d in all_dates if d not in present_dates]
    
    pct = round((len(present_dates) / len(all_dates) * 100), 2) if all_dates else 0
    return jsonify({
        "name": student["name"], 
        "details": student["details"], 
        "percentage": pct, 
        "total": len(all_dates), 
        "present": len(present_dates), 
        "leave_dates": leave_dates, 
        "records": recs
    })


@app.route("/ai/chat", methods=["POST"])
def ai_chat():
    data = request.json
    all_s = [s["name"] for s in students_col.find({}, {"name": 1})]
    today = datetime.now().strftime("%Y-%m-%d")
    recs = [(r["name"], r["time"]) for r in attendance_col.find({"date": today})]
    return jsonify({"status": "success", "response": ai_handler.chat_with_attendance(data.get("query"), recs, all_students=all_s)})


@app.route("/ai/generate_report", methods=["POST"])
def ai_generate_report():
    all_s = [s["name"] for s in students_col.find({}, {"name": 1})]
    today = datetime.now().strftime("%Y-%m-%d")
    recs = [(r["name"], r["date"], r["time"]) for r in attendance_col.find({"date": today})]
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
