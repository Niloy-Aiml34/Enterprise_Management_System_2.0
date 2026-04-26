# Digital Facial Recognition Attendance System

[![GitHub Repo](https://img.shields.io/badge/GitHub-Enterprise_Management_System_2.0-181717?logo=github)](https://github.com/Niloy-Aiml34/Enterprise_Management_System_2.0)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/downloads/)
[![Flask](https://img.shields.io/badge/Flask-3.1-000000?logo=flask)](https://flask.palletsprojects.com/)

> **Repository:** [https://github.com/Niloy-Aiml34/Enterprise_Management_System_2.0](https://github.com/Niloy-Aiml34/Enterprise_Management_System_2.0)

![Enterprise Resource Planning System](Enterprise_Resource_Planning_System.jpg)

An AI-powered, web-based attendance management system that uses real-time facial recognition to automatically identify and mark attendance. Includes a built-in **Data Analyst** module for AI-driven CSV analysis, interactive charts, and SQL-powered data queries.

---

## Features

- **Facial Recognition** — Real-time face detection and recognition using OpenCV + RandomForest
- **Automated Attendance Logging** — Marks attendance once per student per day with duplicate prevention
- **Student Management** — Add, view, and delete students with photo capture
- **Attendance Reports** — Filter by daily / weekly / monthly; download as CSV
- **Data Analyst** — Upload any CSV, get instant AI-generated charts, ask questions in natural language, and query data with auto-generated SQL
- **Multi-LLM Support** — Works with Google Gemini, OpenAI, Anthropic Claude, or a local Ollama model
- **Persistent Datasets** — Uploaded CSV tables are stored in SQLite and survive server restarts
- **Dark / Light / Midnight themes**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.10+, Flask |
| Face Detection | OpenCV (Haar Cascade) |
| Face Classification | scikit-learn RandomForest |
| AI / LLM | LangChain + Google Gemini 2.5 Flash Lite (default) |
| Charts | Plotly |
| Database | SQLite3 (built-in) |
| Frontend | HTML, CSS, JavaScript (vanilla) |

---

## Prerequisites

- **Python 3.10 or higher** — [Download](https://www.python.org/downloads/)
- **Git** — [Download](https://git-scm.com/)
- A **Google Gemini API key** (free tier available) — [Get one](https://aistudio.google.com/app/apikey)
  - Or an OpenAI / Anthropic key if you prefer those providers

> **Python version note:** This project requires **Python 3.10+**. Python 3.11 or 3.12 is recommended for best compatibility with all dependencies. You can check your version with `python --version`.

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/Niloy-Aiml34/Enterprise_Management_System_2.0.git
cd Enterprise_Management_System_2.0
```

### 2. Create a virtual environment

A virtual environment keeps the project's dependencies isolated from your system Python installation.

```bash
python -m venv venv
```

This creates a `venv/` folder in the project directory containing a self-contained Python environment.

### 3. Activate the virtual environment

**Windows (Command Prompt / PowerShell):**
```bash
venv\Scripts\activate
```

**macOS / Linux:**
```bash
source venv/bin/activate
```

> You should see `(venv)` appear at the start of your terminal prompt. All `pip install` and `python` commands now run inside this isolated environment.
>
> To deactivate later, simply run: `deactivate`

### 4. Install dependencies

```bash
pip install -r requirements.txt
```

### 5. Set up the API key

Create the file `analyst/.env` and add your Gemini API key:

```bash
# analyst/.env
GEMINI_API_KEY=your_gemini_api_key_here
```

Optional settings you can add to `analyst/.env`:

```bash
# Change the Gemini model (default: gemini-2.5-flash-lite)
GEMINI_MODEL=gemini-2.5-flash-lite

# OpenAI (if using OpenAI provider)
OPENAI_API_KEY=your_openai_key_here

# Anthropic Claude (if using Anthropic provider)
ANTHROPIC_API_KEY=your_anthropic_key_here

# Ollama local model (if using Ollama provider)
OLLAMA_MODEL=llama3
OLLAMA_BASE_URL=http://localhost:11434
```

---

## Running the App

Make sure your virtual environment is activated, then run:

```bash
venv\Scripts\activate    # Windows
# or
source venv/bin/activate  # macOS / Linux

python app.py
```

Open your browser and go to: **http://127.0.0.1:5000**

---

## Usage Guide

### Attendance System

1. **Add a Student** — Go to `Add Student`, fill in the form, and capture face photos using your webcam (at least 5–10 photos for good accuracy)
2. **Train the Model** — Click `Train Model` and wait for training to complete (progress bar shown)
3. **Mark Attendance** — Go to `Mark Attendance` and allow webcam access; recognized students are logged automatically
4. **View Records** — Go to `Attendance Records` to filter by day / week / month and download CSV

### Data Analyst (`/analyst`)

1. **Upload a CSV** — Drag and drop or click to upload; the system creates a named SQLite table and generates 4 auto charts
2. **Switch Datasets** — Previously uploaded datasets are listed in the sidebar; click any to make it active
3. **Ask Questions** — Type natural language questions in the chat; the AI generates SQL queries and returns results as tables, or explains insights as text
4. **Generate Charts** — Ask to "show me a chart of X vs Y" to get Plotly visualisations
5. **Deep Summary** — Select any chart and click `Get Deeper Summary` for a detailed AI analysis
6. **Delete a Dataset** — Click the ✕ button next to any saved dataset to remove it

---

## Project Structure

```
├── app.py                  # Main Flask application
├── model.py                # Face detection & RandomForest training
├── requirements.txt
├── attendance.db           # SQLite database (auto-created)
├── model.pkl               # Trained model (auto-created after training)
├── dataset/                # Student face images (auto-created)
├── templates/              # HTML templates (Jinja2)
├── static/                 # CSS, JS, images for main app
└── analyst/                # Data Analyst module (Flask Blueprint)
    ├── __init__.py         # Blueprint routes
    ├── llm.py              # LLM integration (Gemini / OpenAI / Anthropic / Ollama)
    ├── db.py               # SQLite multi-table manager
    ├── metadata.py         # CSV metadata extraction
    ├── code_runner.py      # Safe Plotly code execution
    ├── data.db             # Analyst SQLite database (auto-created)
    ├── .env                # API keys (create this manually — not committed)
    └── static/             # Frontend for the analyst UI
```

---

## Switching LLM Providers

The default provider is **Google Gemini**. To switch, edit the `_invoke` function in [analyst/llm.py](analyst/llm.py) and change `provider="gemini"` to one of: `"openai"`, `"anthropic"`, or `"ollama"`. Make sure the matching key is set in `analyst/.env`.

---

## Python Environment Details

| Item | Detail |
|---|---|
| Minimum Python version | 3.10 |
| Recommended version | 3.11 or 3.12 |
| Virtual environment tool | `venv` (built into Python stdlib) |
| Package manager | `pip` |
| Environment folder | `venv/` (excluded from git) |
| Dependency file | `requirements.txt` |

To verify your setup is correct:

```bash
python --version          # should print Python 3.10 or higher
pip --version             # should point to the venv's pip
pip list                  # shows all installed packages in the venv
```

---

## Notes

- The `venv/` folder and `analyst/.env` are excluded from version control via `.gitignore`
- `attendance.db` and `analyst/data.db` are local SQLite files — they are not committed to the repo
- `model.pkl` (trained face recognition model) is committed to the repo; it is regenerated whenever you retrain, and is automatically deleted when a student is removed

---

## License

This project is for educational purposes.
