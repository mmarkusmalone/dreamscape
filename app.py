# dreamscape_app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
from pathlib import Path
import json
import networkx as nx
from google import genai
import os
from dotenv import load_dotenv
import logging
import sys

# === Setup ===
load_dotenv()
app = Flask(__name__)
# Allow common local origins during development (adjust/restrict for production)
CORS(app, supports_credentials=True, resources={
    r"/api/*": {"origins": ["http://localhost:5173", "http://127.0.0.1:5050", "http://localhost:5050"]}
})

BASE_DIR = Path(__file__).resolve().parent
DREAMS_PATH = BASE_DIR / "dreams.json"
GRAPH_PATH = BASE_DIR / "cooccurrences.json"

logging.basicConfig(stream=sys.stdout, level=logging.INFO)
app.logger.setLevel(logging.INFO)

# Ensure data files exist and contain valid JSON. Initialize with safe defaults when missing/invalid.
DEFAULT_DREAMS = {"entries": []}
DEFAULT_GRAPH = {"nodes": [], "links": []}
for path, default in ((DREAMS_PATH, DEFAULT_DREAMS), (GRAPH_PATH, DEFAULT_GRAPH)):
    try:
        if not path.exists() or path.stat().st_size == 0:
            path.write_text(json.dumps(default, indent=2))
        else:
            # validate existing JSON
            json.loads(path.read_text())
    except Exception:
        app.logger.warning("Initializing %s with default JSON", path.name)
        path.write_text(json.dumps(default, indent=2))

# API key setup
GENAI_KEY = os.getenv("AI_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("GENAI_API_KEY")
if not GENAI_KEY:
    app.logger.warning("No GenAI API key found in env (AI_KEY / OPENAI_API_KEY / GENAI_API_KEY). Falling back to local extractor.")
genai.api_key = GENAI_KEY

def load_json_file(path: Path, default):
    """Load JSON from file, or return default if file missing/empty/invalid."""
    if not path.exists() or path.stat().st_size == 0:
        return default
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return default

# === Functions ===
def _fallback_extract(text: str):
    """Simple regex fallback to extract Titlecase words/phrases."""
    import re
    candidates = re.findall(r"\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b", text)
    seen = set()
    out = []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _normalize_entities(items):
    """Normalize: strip, remove empties, title-case multi-word names, dedupe preserving order."""
    out = []
    seen = set()
    for it in items:
        if not isinstance(it, str):
            continue
        s = it.strip()
        if not s:
            continue
        # unify separators and title-case (keep existing capitalization if it seems intentional)
        s = " ".join(part.capitalize() for part in s.split())
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def extract_proper_nouns(text: str):
    """Use LLM to extract proper nouns/entities. Fall back to regex on error or missing API key.

    Returns a list of unique, normalized entity strings.
    """
    if not text or not text.strip():
        return []

    # If no API key configured, skip the LLM call and use the fallback extractor
    if not genai.api_key:
        app.logger.info("No GenAI key: using fallback extractor")
        return _normalize_entities(_fallback_extract(text))

    prompt = f"""
    Extract all proper nouns (people, places, objects, named things)
    from the following dream entry. Return them as a comma-separated list.

    Dream: {text}
    """
    try:
        client = genai.Client(api_key=genai.api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )

        # response may be an object with .text or a dict-like result
        entities_text = ""
        if hasattr(response, "text") and isinstance(response.text, str):
            entities_text = response.text
        elif isinstance(response, dict):
            # try common keys
            entities_text = response.get("text") or response.get("output") or ""
        else:
            entities_text = str(response)

        app.logger.info("LLM response: %s", entities_text)

        # split on commas, newlines, or semicolons
        parts = []
        for chunk in entities_text.splitlines():
            for sub in chunk.split(","):
                for sub2 in sub.split(";"):
                    if sub2:
                        parts.append(sub2)

        return _normalize_entities(parts)
    except Exception as e:
        app.logger.exception("LLM extraction failed, using fallback extractor: %s", e)
        return _normalize_entities(_fallback_extract(text))

@app.route("/api/graph", methods=["GET"])
def get_graph():
    graph_data = load_json_file(GRAPH_PATH, {"nodes": [], "links": []})
    return jsonify(graph_data), 200

def build_graph(entries):
    """Build a co-occurrence graph as nodes + links for the frontend."""
    G = nx.Graph()

    for entities in entries:
        if not entities:
            continue
        # ensure we only add non-empty strings
        cleaned = [e for e in entities if isinstance(e, str) and e.strip()]
        for entity in cleaned:
            G.add_node(entity)

        for i in range(len(cleaned)):
            for j in range(i + 1, len(cleaned)):
                a = cleaned[i]
                b = cleaned[j]
                if G.has_edge(a, b):
                    G[a][b]["weight"] += 1
                else:
                    G.add_edge(a, b, weight=1)

    nodes = [{"id": n} for n in G.nodes()]
    links = [{"source": u, "target": v, "value": d["weight"]}
             for u, v, d in G.edges(data=True)]
    return {"nodes": nodes, "links": links}

# === Routes ===
@app.route("/api/submit", methods=["POST"])
def submit():
    if not request.is_json:
        return jsonify({"error": "Invalid request format. Expected JSON."}), 400

    data = request.get_json()
    dream_text = data.get("dream", "").strip()
    if not dream_text:
        return jsonify({"error": "Dream text is required"}), 400

    entities = extract_proper_nouns(dream_text)

    # ✅ safely load dreams.json
    dreams_data = load_json_file(DREAMS_PATH, {"entries": []})

    new_entry = {"dream": dream_text, "entities": entities}
    dreams_data["entries"].append(new_entry)

    with DREAMS_PATH.open("w") as f:
        json.dump(dreams_data, f, indent=2)

    # ✅ safely build graph and save
    graph_data = build_graph([entry["entities"] for entry in dreams_data["entries"]])
    with GRAPH_PATH.open("w") as f:
        json.dump(graph_data, f, indent=2)

    return jsonify({
        "status": "success",
        "entry": new_entry,
        "graph": graph_data
    }), 200


# === Run ===
if __name__ == "__main__":
    print("🔥 Flask is starting...")
    app.run(port=5050, host="0.0.0.0", debug=False, use_reloader=False)
