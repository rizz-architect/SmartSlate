FROM python:3.10-slim

# Install system dependencies for OpenCV and Face Recognition
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    build-essential \
    cmake \
    libopenblas-dev \
    liblapack-dev \
    libx11-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=5000

# Expose the port Render uses
EXPOSE 5000

# Start the application using Gunicorn
# Pointing to the app object in backend/app.py
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--chdir", "backend", "app:app"]
