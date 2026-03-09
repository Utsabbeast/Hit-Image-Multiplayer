# HIT THE IMAGE Multiplayer 🗑️🏀

Welcome to **HIT THE IMAGE Multiplayer**, a real-time multiplayer web game where two players compete to see who can toss the most paper balls into a trash can before the timer runs out!

## Features ✨
- **Real-Time Multiplayer**: Built with Python WebSockets (FastAPI) for instant syncing between two players.
- **Room Codes**: Create private rooms and share 4-digit codes with friends to play together.
- **Customizable Timers**: Choose from 30, 60, or 120-second game modes.
- **Global Leaderboards**: Top scores for each time limit are saved and displayed.
- **Responsive UI**: Works smoothly on desktop and mobile browsers.

## How to Play 🎮
1. Open the game link.
2. Enter your name.
3. Choose to either **Create** a new room or **Join** an existing one.
4. If you create a room, select a time limit (30s, 60s, or 120s) and share the 4-digit code with a friend.
5. If you join a room, enter the 4-digit code.
6. Once both players are connected, the game starts!
7. **Click or tap** the screen to throw the paper ball into the moving trash can.

## Tech Stack 🛠️
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (Canvas API)
- **Backend / WebSockets**: Python, FastAPI, Uvicorn

## Local Development 💻

If you want to run the game on your own machine:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/bench-toss-multiplayer.git
   cd Hit-Image-Multiplayer
   ```

2. **Set up a Python Virtual Environment:**
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On Mac/Linux:
   source venv/bin/activate
   ```

3. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the Server:**
   ```bash
   uvicorn server:app --host 0.0.0.0 --port 8000 --reload
   ```

5. **Play:**
   Open your browser and navigate to `http://localhost:8000`

---
*Created by Utsab Das*
