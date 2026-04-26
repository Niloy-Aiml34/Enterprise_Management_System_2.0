import os
import pandas as pd
from flask import Blueprint, request, jsonify, send_from_directory
from dotenv import load_dotenv

_PKG_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(dotenv_path=os.path.join(_PKG_DIR, ".env"), override=False)

from .metadata import extract_metadata
from .llm import auto_analyse, ask_gemini, summarize_chart, RateLimitError
from .code_runner import run_chart_code, fig_to_json

STATIC_DIR = os.path.join(_PKG_DIR, "static")

analyst = Blueprint("analyst", __name__, url_prefix="/analyst")

state = {
    "df": None,
    "metadata": None,
    "auto_charts": [],
    "chat_charts": [],
}


@analyst.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@analyst.route("/static/<path:filename>")
def analyst_static(filename):
    return send_from_directory(STATIC_DIR, filename)


@analyst.route("/api/upload", methods=["POST"])
def upload_csv():
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "No file uploaded"}), 400
    try:
        df = pd.read_csv(file)
    except Exception as e:
        return jsonify({"error": f"Failed to parse CSV: {e}"}), 400

    state["df"] = df
    state["metadata"] = extract_metadata(df)
    state["chat_charts"] = []

    result = auto_analyse(state["metadata"], df)

    auto_charts = []
    for chart in result["charts"]:
        auto_charts.append({
            "title": chart["title"],
            "code": chart["code"],
            "explanation": chart.get("explanation", ""),
            "figure_json": fig_to_json(chart["figure"]),
        })
    state["auto_charts"] = auto_charts

    return jsonify({
        "shape": {"rows": df.shape[0], "columns": df.shape[1]},
        "columns": list(df.columns),
        "sample": df.head(10).to_dict(orient="records"),
        "auto_charts": auto_charts,
        "errors": result.get("errors", []),
        "suggestion_error": result.get("suggestion_error"),
        "fatal_error": result.get("fatal_error"),
    })


@analyst.route("/api/chat", methods=["POST"])
def chat():
    if state["df"] is None:
        return jsonify({"error": "No CSV uploaded yet"}), 400

    data = request.get_json()
    question = data.get("question", "").strip()
    explain_with_chart = data.get("explain_with_chart", False)
    chat_history = data.get("chat_history", [])

    if not question:
        return jsonify({"error": "No question provided"}), 400

    response = ask_gemini(
        metadata=state["metadata"],
        user_question=question,
        df=state["df"],
        chat_history=chat_history,
        explain_with_chart=explain_with_chart,
    )
    result = {"type": response["type"]}

    if response["type"] == "chart":
        result["explanation"] = response.get("explanation", "")
        result["code"] = response.get("code", "")
        fig, _ = run_chart_code(response["code"], state["df"])
        if fig:
            result["figure_json"] = fig_to_json(fig)
            state["chat_charts"].append({
                "title": result["explanation"][:60] or "Chat chart",
                "code": result["code"],
                "figure_json": result["figure_json"],
            })
        else:
            result["chart_render_error"] = {
                "icon": "🔌",
                "title": "Couldn't render chart",
                "message": "The AI generated invalid plotting code. Try rephrasing your request.",
            }

    elif response["type"] == "text":
        result["content"] = response["content"]
        if response.get("chart_code"):
            result["chart_explanation"] = response.get("chart_explanation", "")
            result["chart_code"] = response["chart_code"]
            fig, _ = run_chart_code(response["chart_code"], state["df"])
            if fig:
                result["chart_figure_json"] = fig_to_json(fig)
                state["chat_charts"].append({
                    "title": result["chart_explanation"][:60] or "Supporting chart",
                    "code": result["chart_code"],
                    "figure_json": result["chart_figure_json"],
                })
            else:
                result["chart_render_error"] = {
                    "icon": "🔌",
                    "title": "Couldn't render supporting chart",
                    "message": "The AI generated invalid plotting code for the supporting visual.",
                }
    else:
        result["error"] = response.get("error") or {
            "icon": "⚠️",
            "title": "Something went wrong",
            "message": response.get("content", "We couldn't process that request right now."),
        }

    return jsonify(result)


@analyst.route("/api/deep-summary", methods=["POST"])
def deep_summary():
    if state["metadata"] is None:
        return jsonify({"error": "No CSV uploaded yet"}), 400

    data = request.get_json()
    source = data.get("source", "auto")
    index = data.get("index", 0)
    charts = state["auto_charts"] if source == "auto" else state["chat_charts"]

    if index < 0 or index >= len(charts):
        return jsonify({"error": "Invalid chart index"}), 400

    chart = charts[index]
    try:
        summary = summarize_chart(state["metadata"], chart["title"], chart["code"])
    except RateLimitError as e:
        from .llm import _rate_limit_dict
        return jsonify({"error": _rate_limit_dict(e)}), 429

    return jsonify({"summary": summary})


@analyst.route("/api/all-charts", methods=["GET"])
def all_charts():
    charts = []
    for i, c in enumerate(state["auto_charts"]):
        charts.append({"label": f"Auto Chart {i+1}: {c['title']}", "source": "auto", "index": i})
    for i, c in enumerate(state["chat_charts"]):
        charts.append({"label": f"Chat Chart {i+1}: {c['title']}", "source": "chat", "index": i})
    return jsonify({"charts": charts})
