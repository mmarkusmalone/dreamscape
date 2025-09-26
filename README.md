# Dreamscape –  Dream Journal with Insight Visualization

Dreamscape is an interactive web application for recording, analyzing, and visualizing dream entries. It combines a timeline journal with a relational **co-occurrence graph**, letting users explore recurring words, themes, and symbolic connections across their dreams.

---

##  Features

- **Add Dream Entries** – Record free-text dreams with date stamps.
- **Word Co-occurrence Analysis** – Backend generates `cooccurrences.json` capturing associations between words across entries.
- **Interactive Graph Visualization** – Navigate your dreamscape via nodes (words, entries) and edges (connections).
- **Timeline Journal** – Browse past dreams in chronological order.
- **Search & Filtering** – Filter by keywords, tags, and dates.
- **Responsive UI** – Works across devices and screen sizes.

---

## Getting Started

### Prerequisites
- **Frontend**: Any modern web browser (Chrome, Firefox, Edge, Safari)
- **Backend**:
  - Node.js (v16+ recommended)
  - npm or yarn
- **Optional**: GPU support for faster model inference (if using a large model)

### Installation

1. **Clone this repository**:
   ```bash
   git clone https://github.com/yourusername/dreamscape.git
2. **Create a Virtual Environment and download the dependencies: requirements.txt**

5. **Run the program**
   For the frontend server:
    ``` bash
   npx vite
   ```
  For the backend server:
   ``` bash
   python app.py
   ```

