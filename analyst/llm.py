import os
import re
import json
from langchain_core.messages import SystemMessage, HumanMessage
from .metadata import metadata_to_prompt_str
from .code_runner import run_chart_code


# ── Rate-limit detection ────────────────────────────────────────
class RateLimitError(Exception):
    pass


def _is_rate_limit(e: Exception) -> bool:
    msg = str(e).lower()
    # Rate / quota limits
    if any(k in msg for k in (
        "429", "rate limit", "quota", "resource_exhausted",
        "resource has been exhausted", "daily limit", "too many requests",
        "ratelimit", "rate_limit", "exceeded",
    )):
        return True
    # Invalid / missing API key — all requests will fail, treat as fatal
    if any(k in msg for k in (
        "api key not found", "api_key_invalid", "invalid api key",
        "api key invalid", "pass a valid api key",
    )):
        return True
    return False


def _rate_limit_dict(e: Exception) -> dict:
    msg = str(e).lower()

    # API key problem — give an actionable message
    if any(k in msg for k in ("api key not found", "api_key_invalid", "pass a valid api key", "invalid api key")):
        return {
            "icon": "🔑",
            "title": "Invalid or missing API key",
            "message": (
                "The Gemini API key was rejected. "
                "Please check that GEMINI_API_KEY is set correctly in analyst/.env and restart the server."
            ),
            "fatal": True,
        }

    # Rate / quota limit
    raw = str(e)
    retry_match = re.search(r"retry.after[:\s]+(\d+)", raw, re.I)
    retry_after = int(retry_match.group(1)) if retry_match else None
    d = {
        "icon": "🚫",
        "title": "API limit reached",
        "message": (
            "You've hit the API rate or daily usage limit. "
            "No further AI requests will be made. "
            "Please wait a while then reload the page."
        ),
        "fatal": True,
    }
    if retry_after:
        d["retry_after"] = retry_after
    return d


# ── Prompts ─────────────────────────────────────────────────────
AUTO_ANALYSIS_SYSTEM = """You are an expert data analyst.

Given CSV metadata, suggest exactly 4 of the most insightful charts for this dataset.
Choose chart types that best reveal patterns, distributions, relationships, or trends.

Respond ONLY with a valid JSON array. No markdown, no code fences, no explanation. Example:
[
  {
    "title": "Short chart title",
    "chart_request": "Detailed instruction for what to plot and how"
  }
]
"""

CHART_SYSTEM = """You are an expert data analyst and Python developer.

The DataFrame is already available as `df`. Do NOT import pandas or load files.
Use Plotly Express (px) or Plotly Graph Objects (go).
Assign the final figure to a variable named `fig`. Do NOT call fig.show().
Use meaningful titles, axis labels, and colors.

Respond EXACTLY in this format:

EXPLANATION:
<one or two sentences describing what the chart shows>

CODE:
```python
<plotly code here>
```
"""

CHART_EXPLAIN_SYSTEM = """You are an expert data analyst.

You are given a chart title and the CSV metadata. Provide a clear, insightful explanation
of what this chart reveals about the data. Mention specific patterns, trends, outliers,
or notable findings. Be specific, reference column names and numbers where relevant.
Keep it to 3-5 sentences.
"""

INSIGHT_SYSTEM = """You are an expert data analyst.

The user has uploaded a CSV file. You are given its metadata and the chat history.
Answer the user's question with clear, concise analytical insight — no code, no charts.
Be specific, reference column names and numbers where relevant.
Keep the answer to 3-5 sentences unless a longer explanation is needed.
"""

EXPLAIN_WITH_CHART_SYSTEM = """You are an expert data analyst and Python developer.

The user asked a question and received a text answer. Now generate a chart that
visually supports or explains the answer.

The DataFrame is already available as `df`. Do NOT import pandas or load files.
Use Plotly Express (px) or Plotly Graph Objects (go).
Assign the final figure to a variable named `fig`. Do NOT call fig.show().
Use meaningful titles, axis labels, and colors.

Respond EXACTLY in this format:

EXPLANATION:
<one or two sentences describing what the chart shows and how it relates to the answer>

CODE:
```python
<plotly code here>
```
"""

SUMMARIZE_CHART_SYSTEM = """You are an expert data analyst.

The user has selected a specific chart and wants a deeper analytical summary.
You are given the chart title, the code that generated it, and the CSV metadata.

Provide a thorough analytical summary covering:
- What the chart reveals about the data
- Key patterns, trends, and distributions visible
- Notable outliers or anomalies
- Actionable insights or implications
- Suggestions for further analysis

Write 5-8 detailed sentences. Be specific with column names, values, and statistics.
"""

SQL_SYSTEM = """You are an expert SQL analyst.

You are given the CREATE TABLE schema of a SQLite table.
Generate a single valid SQLite SELECT query that answers the user's question.

Rules:
- Return ONLY the raw SQL query. No markdown, no code fences, no explanation.
- Use the exact table name from the schema provided.
- Use only SELECT statements. Never INSERT, UPDATE, DELETE, DROP, or CREATE.
- Always add LIMIT 500 unless the user explicitly asks for more rows.
- If the question cannot be answered with SQL (e.g. it is a conceptual or general question unrelated to this dataset), respond with exactly: NO_SQL
"""


def get_llm(provider: str | None = None, model: str | None = None):
    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=model or os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite"),
            google_api_key=os.environ["GEMINI_API_KEY"],
        )

    if provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model="gpt-4o-mini",
            api_key=os.environ["OPENAI_API_KEY"],
        )

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model or os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
            api_key=os.environ["ANTHROPIC_API_KEY"],
        )

    if provider == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=model or os.getenv("OLLAMA_MODEL", "llama3"),
            base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        )

    raise ValueError(f"Unknown LLM_PROVIDER: '{provider}'. Choose gemini, openai, anthropic, or ollama.")


def _invoke(system_prompt: str, user_prompt: str) -> str:
    llm = get_llm(provider="gemini")
    messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]
    try:
        response = llm.invoke(messages)
    except Exception as e:
        if _is_rate_limit(e):
            raise RateLimitError(str(e)) from e
        raise
    return response.content.strip()


def is_chart_request(prompt: str) -> bool:
    keywords = r"\b(show|plot|draw|chart|graph|visuali[sz]e|display)\b"
    return bool(re.search(keywords, prompt, re.I))


def auto_analyse(metadata: dict, df) -> dict:
    """Returns {charts, errors, suggestion_error, fatal_error}.
    fatal_error is populated (and charts is empty) when the API is rate-limited.
    """
    try:
        metadata_str = metadata_to_prompt_str(metadata)
        suggestion_prompt = f"Here is the CSV metadata:\n\n{metadata_str}\n\nSuggest 4 insightful charts."

        suggestions = []
        suggestion_error = None
        try:
            raw = _invoke(AUTO_ANALYSIS_SYSTEM, suggestion_prompt)
            raw = re.sub(r"^```[a-z]*\n?", "", raw, flags=re.MULTILINE)
            raw = re.sub(r"```$", "", raw, flags=re.MULTILINE)
            suggestions = json.loads(raw.strip())
        except RateLimitError:
            raise
        except Exception as e:
            suggestion_error = str(e)
            numeric_cols = [c["name"] for c in metadata["columns"] if c.get("kind") == "numeric"]
            cat_cols = [c["name"] for c in metadata["columns"] if c.get("kind") == "categorical"]
            suggestions = []
            if numeric_cols:
                suggestions.append({
                    "title": f"Distribution of {numeric_cols[0]}",
                    "chart_request": f"Show a histogram of the '{numeric_cols[0]}' column."
                })
            if len(numeric_cols) >= 2:
                suggestions.append({
                    "title": f"{numeric_cols[0]} vs {numeric_cols[1]}",
                    "chart_request": f"Show a scatter plot of '{numeric_cols[0]}' vs '{numeric_cols[1]}'."
                })
            if cat_cols and numeric_cols:
                suggestions.append({
                    "title": f"{numeric_cols[0]} by {cat_cols[0]}",
                    "chart_request": f"Show a bar chart of average '{numeric_cols[0]}' grouped by '{cat_cols[0]}'."
                })
            if len(numeric_cols) >= 1:
                suggestions.append({
                    "title": f"Box plot of {numeric_cols[0]}",
                    "chart_request": f"Show a box plot of '{numeric_cols[0]}'."
                })
            if not suggestions:
                suggestions.append({
                    "title": "Column overview",
                    "chart_request": "Show a bar chart of the value counts of the first categorical column."
                })

        charts = []
        errors = []
        for s in suggestions[:4]:
            result = _generate_chart(metadata, s["chart_request"], df)
            if result["type"] == "chart":
                fig, error = run_chart_code(result["code"], df)
                if fig:
                    explanation = _explain_chart(metadata, s["title"])
                    charts.append({
                        "title": s["title"],
                        "figure": fig,
                        "code": result["code"],
                        "explanation": explanation,
                    })
                else:
                    errors.append({"title": s["title"], "message": f"Code execution failed: {error}"})
            else:
                errors.append({"title": s["title"], "message": result.get("content", "Chart generation failed")})

        return {"charts": charts, "errors": errors, "suggestion_error": suggestion_error, "fatal_error": None}

    except RateLimitError as e:
        return {"charts": [], "errors": [], "suggestion_error": None, "fatal_error": _rate_limit_dict(e)}


def _explain_chart(metadata: dict, chart_title: str) -> str:
    metadata_str = metadata_to_prompt_str(metadata)
    prompt = f"CSV metadata:\n\n{metadata_str}\n\nChart title: {chart_title}\n\nExplain what this chart reveals about the data."
    try:
        return _invoke(CHART_EXPLAIN_SYSTEM, prompt)
    except RateLimitError:
        raise
    except Exception:
        return ""


def ask_gemini(metadata: dict, user_question: str, df, chat_history: list, explain_with_chart: bool = False, schema: str = "") -> dict:
    try:
        if is_chart_request(user_question):
            return _generate_chart(metadata, user_question, df)
        else:
            if schema:
                sql_result = _generate_sql(schema, user_question)
                if sql_result["type"] == "sql":
                    return sql_result
            text_result = _generate_insight(metadata, user_question, chat_history)
            if explain_with_chart and text_result["type"] == "text":
                chart_result = _generate_explain_chart(metadata, user_question, text_result["content"], df)
                if chart_result["type"] == "chart":
                    text_result["chart_code"] = chart_result["code"]
                    text_result["chart_explanation"] = chart_result.get("explanation", "")
            return text_result
    except RateLimitError as e:
        return {"type": "error", "error": _rate_limit_dict(e)}


def _generate_chart(metadata: dict, request: str, df) -> dict:
    metadata_str = metadata_to_prompt_str(metadata)
    prompt = f"CSV metadata:\n\n{metadata_str}\n\nChart request: {request}"
    try:
        return _parse_chart_response(_invoke(CHART_SYSTEM, prompt))
    except RateLimitError:
        raise
    except Exception as e:
        return {"type": "error", "content": str(e)}


def _generate_insight(metadata: dict, question: str, chat_history: list) -> dict:
    metadata_str = metadata_to_prompt_str(metadata)
    history_str = ""
    if chat_history:
        lines = []
        for msg in chat_history[-6:]:
            role = "User" if msg["role"] == "user" else "Assistant"
            lines.append(f"{role}: {msg['text']}")
        history_str = "\n".join(lines)

    prompt = f"""CSV metadata:

{metadata_str}

{"Chat history:" + chr(10) + history_str + chr(10) if history_str else ""}User question: {question}
"""
    try:
        return {"type": "text", "content": _invoke(INSIGHT_SYSTEM, prompt)}
    except RateLimitError:
        raise
    except Exception as e:
        return {"type": "error", "content": str(e)}


def _generate_explain_chart(metadata: dict, question: str, answer: str, df) -> dict:
    metadata_str = metadata_to_prompt_str(metadata)
    prompt = f"""CSV metadata:

{metadata_str}

User question: {question}
Text answer given: {answer}

Generate a chart that visually explains or supports this answer.
"""
    try:
        return _parse_chart_response(_invoke(EXPLAIN_WITH_CHART_SYSTEM, prompt))
    except RateLimitError:
        raise
    except Exception as e:
        return {"type": "error", "content": str(e)}


def summarize_chart(metadata: dict, chart_title: str, chart_code: str) -> str:
    metadata_str = metadata_to_prompt_str(metadata)
    prompt = f"""CSV metadata:

{metadata_str}

Chart title: {chart_title}
Chart code:
```python
{chart_code}
```

Provide a thorough analytical summary of what this chart reveals.
"""
    try:
        return _invoke(SUMMARIZE_CHART_SYSTEM, prompt)
    except RateLimitError:
        raise
    except Exception as e:
        return f"Error generating summary: {e}"


def _generate_sql(schema: str, question: str) -> dict:
    prompt = f"Table schema:\n{schema}\n\nUser question: {question}"
    try:
        raw = _invoke(SQL_SYSTEM, prompt).strip()
        raw = re.sub(r"^```[a-z]*\n?", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"```$", "", raw, flags=re.MULTILINE)
        sql = raw.strip()
        if sql.upper().startswith("NO_SQL"):
            return {"type": "text_needed"}
        return {"type": "sql", "sql": sql}
    except RateLimitError:
        raise
    except Exception:
        return {"type": "text_needed"}


def _parse_chart_response(raw: str) -> dict:
    code_match = re.search(r"```python\s*(.*?)```", raw, re.DOTALL)
    if not code_match:
        return {"type": "text", "content": raw}
    code = code_match.group(1).strip()
    explanation = ""
    exp_match = re.search(r"EXPLANATION:\s*(.*?)(?=CODE:|```)", raw, re.DOTALL)
    if exp_match:
        explanation = exp_match.group(1).strip()
    else:
        before = raw[: code_match.start()].strip()
        explanation = before.replace("EXPLANATION:", "").strip()
    return {"type": "chart", "code": code, "explanation": explanation}
