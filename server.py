from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
from typing import Dict, List, Any, cast, Tuple
import json
import os
import time
import asyncio
app = FastAPI()

@app.get("/")
async def get():
    with open("toss.html", "r", encoding="utf-8") as f:
        html_content = f.read()
    return HTMLResponse(content=html_content)

# --- LEADERBOARD LOGIC ---
LEADERBOARD_FILE = "leaderboard.json"

def load_leaderboard() -> Dict[str, List[Dict[str, Any]]]:
    if os.path.exists(LEADERBOARD_FILE):
        try:
            with open(LEADERBOARD_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading leaderboard: {e}")
    # Default empty leaderboard
    return {
        "30": [],
        "60": [],
        "120": []
    }

def save_leaderboard(data: Dict[str, List[Dict[str, Any]]]):
    try:
        with open(LEADERBOARD_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        print(f"Error saving leaderboard: {e}")

leaderboard_data = load_leaderboard()

@app.get("/leaderboard")
async def get_leaderboard():
    return leaderboard_data

@app.post("/leaderboard")
async def post_score(request: Request):
    entry = await request.json()
    time_key = str(entry.get("time", "60"))
    
    if time_key not in leaderboard_data:
        leaderboard_data[time_key] = []
        
    # Add new score
    leaderboard_data[time_key].append({"name": entry.get("name", "Anonymous"), "score": entry.get("score", 0)})
    
    # Sort descending by score
    leaderboard_data[time_key].sort(key=lambda x: x["score"], reverse=True)
    
    # Keep top 3
    current_list = leaderboard_data[time_key]
    leaderboard_data[time_key] = cast(List[Dict[str, Any]], current_list[:3])
    
    # Save after updating
    save_leaderboard(leaderboard_data)
    
    return {"status": "success"}

# Store active rooms and their connections/scores
# rooms = {
#     "room_code": {
#         "players": [ { "ws": WebSocket, "id": "player1", "score": 0 } ],
#         "state": "waiting" | "playing"
#     }
# }
rooms: Dict[str, Dict[str, Any]] = {}

class ConnectionManager:
    def __init__(self):
        # Maps websocket to (room_code, player_id)
        self.active_connections: Dict[WebSocket, Tuple[str, str]] = {}

    async def connect(self, websocket: WebSocket, room_code: str, player_id: str, player_name: str, time_mode: int, is_creator: bool):
        await websocket.accept()
        
        if room_code not in rooms:
            if is_creator:
                rooms[room_code] = {"players": [], "state": "waiting", "time_mode": time_mode, "created_at": time.time()}
            else:
                await websocket.send_json({"type": "error", "message": "Room Doesn't exist!"})
                await asyncio.sleep(1.5)
                await websocket.close()
                return False
            
        # Check if room has expired (30 seconds)
        if rooms[room_code]["state"] == "waiting" and (time.time() - rooms[room_code].get("created_at", time.time())) > 30:
            await websocket.send_json({"type": "error", "message": "Room expired (30s limit to join). Please create a new room!"})
            await asyncio.sleep(1.5)
            await websocket.close()
            return False
            
        # Check if room is full
        if len(rooms[room_code]["players"]) >= 2:
            await websocket.send_json({"type": "error", "message": "Room is full! Already 2 players."})
            await asyncio.sleep(1.5)
            await websocket.close()
            return False

        # Add player
        player_data = {"ws": websocket, "id": player_id, "name": player_name, "score": 0}
        rooms[room_code]["players"].append(player_data)
        self.active_connections[websocket] = (room_code, player_id)

        # Notify room state
        await self.broadcast_room_state(room_code)
        
        # If 2 players, start game
        if len(rooms[room_code]["players"]) == 2:
            rooms[room_code]["state"] = "playing"
            await self.broadcast(room_code, {
                "type": "game_start", 
                "message": "Game starting!",
                "time_mode": rooms[room_code]["time_mode"]
            })

        return True

    async def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            room_code, player_id = self.active_connections[websocket]
            del self.active_connections[websocket]
            
            if room_code in rooms:
                # Remove player
                rooms[room_code]["players"] = [p for p in rooms[room_code]["players"] if p["ws"] != websocket]
                
                # If room empty, delete
                if len(rooms[room_code]["players"]) == 0:
                    del rooms[room_code]
                else:
                    # Notify remaining player
                    rooms[room_code]["state"] = "waiting"
                    await self.broadcast(room_code, {
                        "type": "player_left", 
                        "message": "Opponent disconnected."
                    })
                    await self.broadcast_room_state(room_code)

    async def broadcast(self, room_code: str, message: dict):
        if room_code in rooms:
            for player in rooms[room_code]["players"]:
                try:
                    await player["ws"].send_json(message)
                except Exception:
                    pass

    async def broadcast_room_state(self, room_code: str):
        if room_code in rooms:
            players_info = [{"id": p["id"], "name": p.get("name", "Player"), "score": p["score"]} for p in rooms[room_code]["players"]]
            await self.broadcast(room_code, {
                "type": "room_state",
                "players": players_info,
                "state": rooms[room_code]["state"]
            })

    async def update_score(self, room_code: str, player_id: str, new_score: int):
        if room_code in rooms:
            for p in rooms[room_code]["players"]:
                if p["id"] == player_id:
                    p["score"] = new_score
            
            # Broadcast new scores
            await self.broadcast_room_state(room_code)

manager = ConnectionManager()

@app.websocket("/ws/{room_code}/{player_id}/{player_name}/{time_mode}/{is_creator}")
async def websocket_endpoint(websocket: WebSocket, room_code: str, player_id: str, player_name: str, time_mode: int, is_creator: str):
    creator_flag = is_creator.lower() == "true"
    success = await manager.connect(websocket, room_code, player_id, player_name, time_mode, creator_flag)
    if not success:
        return

    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            if payload.get("type") == "score_update":
                new_score = payload.get("score", 0)
                await manager.update_score(room_code, player_id, new_score)
                
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception as e:
        print(f"Error: {e}")
        await manager.disconnect(websocket)

# Mount static files last so it doesn't intercept /ws routes
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
