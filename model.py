import os
import cv2
import numpy as np
import pickle
from sklearn.ensemble import RandomForestClassifier

MODEL_PATH = "model.pkl"

_CASCADE_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
_face_cascade = cv2.CascadeClassifier(_CASCADE_PATH)


def _detect_face_bbox(bgr_image):
    """Return (x1, y1, x2, y2) of the largest face, or None."""
    gray = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2GRAY)
    faces = _face_cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40)
    )
    if len(faces) == 0:
        return None
    # pick largest by area
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    return x, y, x + w, y + h


def _embed_face_crop(bgr_image, bbox):
    """Crop face from image and return a 1024-dim float32 embedding."""
    x1, y1, x2, y2 = bbox
    face = bgr_image[y1:y2, x1:x2]
    face = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    face = cv2.resize(face, (32, 32), interpolation=cv2.INTER_AREA)
    return face.flatten().astype(np.float32) / 255.0


def extract_embedding_for_image(stream_or_bytes):
    """Accept a file-like stream, detect face, return embedding or None."""
    data = stream_or_bytes.read()
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return None
    bbox = _detect_face_bbox(img)
    if bbox is None:
        return None
    return _embed_face_crop(img, bbox)


def load_model_if_exists():
    if not os.path.exists(MODEL_PATH):
        return None
    with open(MODEL_PATH, "rb") as f:
        return pickle.load(f)


def predict_with_model(clf, emb):
    proba = clf.predict_proba([emb])[0]
    idx = np.argmax(proba)
    return clf.classes_[idx], float(proba[idx])


def train_model_background(dataset_dir, progress_callback=None):
    X, y = [], []
    student_dirs = [
        d for d in os.listdir(dataset_dir)
        if os.path.isdir(os.path.join(dataset_dir, d))
    ]
    total = max(1, len(student_dirs))

    for i, sid in enumerate(student_dirs):
        folder = os.path.join(dataset_dir, sid)
        files = [f for f in os.listdir(folder) if f.lower().endswith((".jpg", ".jpeg", ".png"))]
        for fn in files:
            img = cv2.imread(os.path.join(folder, fn))
            if img is None:
                continue
            bbox = _detect_face_bbox(img)
            if bbox is None:
                continue
            emb = _embed_face_crop(img, bbox)
            X.append(emb)
            y.append(int(sid))

        if progress_callback:
            progress_callback(int((i + 1) / total * 80), f"Processed {i+1}/{total} students")

    if not X:
        if progress_callback:
            progress_callback(0, "No training data found")
        return

    X = np.stack(X)
    y = np.array(y)

    if progress_callback:
        progress_callback(85, "Training RandomForest...")

    clf = RandomForestClassifier(n_estimators=150, n_jobs=-1, random_state=42)
    clf.fit(X, y)

    with open(MODEL_PATH, "wb") as f:
        pickle.dump(clf, f)

    if progress_callback:
        progress_callback(100, "Training complete")
