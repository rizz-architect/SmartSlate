import cv2
import numpy as np
import os
import pickle
import sqlite3
from datetime import datetime
import time

# Configuration
DB_FILE = "attendance.db"
TRAINER_FILE = "data/trainer.yml"
LABELS_FILE = "data/labels.pkl"
PROCESS_EVERY_N_FRAME = 2

# Initialize Recognizer
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
recognizer = cv2.face.LBPHFaceRecognizer_create()

label_map = {}
if os.path.exists(TRAINER_FILE) and os.path.exists(LABELS_FILE):
    recognizer.read(TRAINER_FILE)
    with open(LABELS_FILE, "rb") as f:
        label_map = pickle.load(f)

def log_attendance(name):
    now = datetime.now()
    date = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M:%S")
    
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Check 10 min cooldown
    c.execute("SELECT 1 FROM attendance WHERE name=? AND date=? AND abs(strftime('%s', 'now', 'localtime') - strftime('%s', date || ' ' || time)) < 600", 
              (name, date))
    
    if not c.fetchone():
        c.execute("INSERT INTO attendance (name, date, time) VALUES (?, ?, ?)",
                  (name, date, time_str))
        conn.commit()
        print(f"[LOGGED] {name} at {time_str}")
    
    conn.close()

def main():
    print("Starting 'Big Boss' Real-Time Scanner (OpenCV Mode)...")
    video_capture = cv2.VideoCapture(0)
    
    frame_count = 0
    face_locations = []
    face_names = []

    while True:
        ret, frame = video_capture.read()
        if not ret:
            break

        if frame_count % PROCESS_EVERY_N_FRAME == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(gray, 1.3, 5)
            
            face_locations = []
            face_names = []
            
            for (x, y, w, h) in faces:
                face_roi = gray[y:y+h, x:x+w]
                face_locations.append((y, x + w, y + h, x))
                
                name = "Unknown"
                if label_map:
                    id_, confidence = recognizer.predict(face_roi)
                    if confidence < 80:
                        name = label_map.get(id_, "Unknown")
                        log_attendance(name)
                
                face_names.append(name)

        frame_count += 1

        # Display results
        for (top, right, bottom, left), name in zip(face_locations, face_names):
            color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)
            cv2.rectangle(frame, (left, top), (right, bottom), color, 2)
            cv2.rectangle(frame, (left, bottom - 35), (right, bottom), color, cv2.FILLED)
            cv2.putText(frame, name, (left + 6, bottom - 6), cv2.FONT_HERSHEY_DUPLEX, 0.8, (255, 255, 255), 1)

        cv2.imshow('Smart Attendance - Big Boss Mode', frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    video_capture.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
