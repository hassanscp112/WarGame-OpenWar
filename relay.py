import asyncio
import json
import secrets
import websockets

# Simple WebSocket Relay Server for Rocket Game
# Usage: python relay.py
# Clients connect to ws://YOUR_RADMIN_IP:10294

rooms = {}

async def handler(websocket):
    print(f"New connection: {websocket.remote_address}")
    current_room = None
    
    try:
        async for message in websocket:
            data = json.loads(message)
            m_type = data.get("type")
            
            if m_type == "create_room":
                room_code = secrets.token_hex(3).upper()
                rooms[room_code] = {"host": websocket, "guest": None}
                current_room = room_code
                await websocket.send(json.dumps({"type": "room_created", "code": room_code}))
                print(f"Room Created: {room_code}")
                
            elif m_type == "join_room":
                code = data.get("code")
                if code in rooms and rooms[code]["guest"] is None:
                    rooms[code]["guest"] = websocket
                    current_room = code
                    # Notify both that game starts
                    # Host gets 'player' (Side A), Guest gets 'enemy' (Side B/Opponent)
                    await rooms[code]["host"].send(json.dumps({"type": "game_start", "side": "player"}))
                    await rooms[code]["guest"].send(json.dumps({"type": "game_start", "side": "enemy"}))
                    print(f"User joined room: {code}")
                else:
                    await websocket.send(json.dumps({"type": "error", "msg": "Room full or not found"}))
            
            elif m_type == "game_action":
                if current_room and current_room in rooms:
                    # Relay to the other player in the room
                    room = rooms[current_room]
                    target = room["guest"] if websocket == room["host"] else room["host"]
                    if target:
                        await target.send(json.dumps({
                            "type": "opponent_action",
                            "action": data.get("action")
                        }))

    except websockets.exceptions.ConnectionClosed:
        print(f"Connection lost: {websocket.remote_address}")
    finally:
        if current_room and current_room in rooms:
            room = rooms[current_room]
            other = room["guest"] if websocket == room["host"] else room["host"]
            if other:
                try:
                    await other.send(json.dumps({"type": "opponent_disconnected"}))
                except:
                    pass
            del rooms[current_room]
            print(f"Room {current_room} closed")

async def main():
    async with websockets.serve(handler, "0.0.0.0", 10294):
        print("Rocket Game Relay Server running on port 10294")
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
