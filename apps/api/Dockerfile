# Use official lightweight Python runtime
FROM python:3.10-slim

# Set environment variables to keep logs clear and prevent compiled bytecode
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Set the working directory in the container
WORKDIR /app

# Install essential system utilities for building package binaries if necessary
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements list and install dependencies first (leverage layer cache)
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy the core FastAPI source code
COPY main.py /app/

# Expose port 18002 inside the container
EXPOSE 18002

# Command to launch the API service using uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "18002"]
