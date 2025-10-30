from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel
from typing import Dict, List, Optional
import uuid
import random
import asyncio
import string
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# In-memory game storage
game_sessions: Dict[str, dict] = {}
active_connections: Dict[str, Dict[str, WebSocket]] = {}  # {session_id: {player_id: websocket}}

# Game configuration
ROOMS_CONFIG = {
    "basement": ["Cave", "Wine Cellar", "Boiler Room", "Storage"],
    "ground_floor": ["Kitchen", "Living Room", "Dining Room", "Hallway"],
    "upper_floor": ["Master Bedroom", "Guest Room", "Bathroom", "Attic"]
}

AVATARS = ["👤", "👨", "👩", "🧑", "👦", "👧", "🧓", "👨‍🦰", "👩‍🦰", "👨‍🦱"]

# Models
class CreateGameRequest(BaseModel):
    host_name: str
    host_avatar: str
    role: str  # "survivor" or "killer"
    conspiracy_mode: bool = False  # NEW: conspiracy mode for random role assignment

class JoinGameRequest(BaseModel):
    player_name: str
    player_avatar: str
    role: str  # "survivor" or "killer"

class StartGameRequest(BaseModel):
    pass

class PlayerAction(BaseModel):
    action: str  # "select_room", "use_medikit"
    room: Optional[str] = None
    target_player: Optional[str] = None

# Helper functions
def generate_short_code() -> str:
    """Generate a short 4-character alphanumeric code"""
    characters = string.ascii_uppercase + string.digits
    while True:
        code = ''.join(random.choice(characters) for _ in range(4))
        # Check if code already exists
        if code not in game_sessions:
            return code

def create_game_state(host_id: str, host_name: str, host_avatar: str, host_role: str) -> dict:
    """Initialize a new game state"""
    all_rooms = []
    for floor, rooms in ROOMS_CONFIG.items():
        for room in rooms:
            all_rooms.append({"name": room, "floor": floor})

    # Initialize rooms WITHOUT any keys or medikit
    rooms_state = {}
    for room_info in all_rooms:
        room_name = room_info["name"]
        rooms_state[room_name] = {
            "floor": room_info["floor"],
            "has_key": False,
            "has_medikit": False,
            "locked": False,
            "eliminated_players": [],
            "trapped": False,  # NEW: for piege power
            "highlighted": False  # NEW: for vision power
        }

    return {
        "session_id": generate_short_code(),  # MODIFIED: Use short code instead of UUID
        "host_id": host_id,
        "players": {
            host_id: {
                "id": host_id,
                "name": host_name,
                "avatar": host_avatar,
                "is_host": True,
                "eliminated": False,
                "current_room": None,
                "has_medikit": False,
                "role": host_role,  # "survivor" or "killer"
                "immobilized_next_turn": False  # NEW: for piege power
            }
        },
        "rooms": rooms_state,
        "keys_collected": 0,
        "keys_needed": 1,
        "game_started": False,
        "turn": 0,
        "phase": "waiting",  # waiting, survivor_selection, killer_power_selection, killer_selection, processing, game_over
        "events": [],
        "pending_actions": {},
        "should_place_next_key": False,
        "conspiracy_mode": False,  # NEW: conspiracy mode flag
        "active_powers": {},  # NEW: {power_name: {used_by: [player_ids], data: {...}}}
        "pending_power_selections": {},  # NEW: {player_id: {selected_power: str, options: [str], action_data: {...}}}
        "rooms_searched_this_key": [],  # NEW: track rooms searched since last key found (for vision power)
        "created_at": datetime.now(timezone.utc).isoformat()
    }

def place_next_key(game_state: dict) -> Optional[str]:
    """Place ONE key randomly in an available room"""
    available_rooms = []

    # Get all killer positions
    killer_positions = [p["current_room"] for p in game_state["players"].values()\
                       if p["role"] == "killer" and p["current_room"]]

    for room_name, room_data in game_state["rooms"].items():
        # Room is available if: not locked, no key already, not a killer's position
        if (not room_data["locked"] and
            not room_data["has_key"] and
            room_name not in killer_positions):
            available_rooms.append(room_name)

    if available_rooms:
        selected_room = random.choice(available_rooms)
        game_state["rooms"][selected_room]["has_key"] = True
        logger.info(f"Placed key in room: {selected_room}")
        return selected_room

    return None

def respawn_medikit(game_state: dict) -> Optional[str]:
    """Respawn medikit randomly in an available room after use"""
    available_rooms = []

    # Get all killer positions
    killer_positions = [p["current_room"] for p in game_state["players"].values()\
                       if p["role"] == "killer" and p["current_room"]]

    for room_name, room_data in game_state["rooms"].items():
        # Room is available if: not locked, no medikit already, no key, not a killer's position
        if (not room_data["locked"] and
            not room_data["has_medikit"] and
            not room_data["has_key"] and
            room_name not in killer_positions):
            available_rooms.append(room_name)

    if available_rooms:
        selected_room = random.choice(available_rooms)
        game_state["rooms"][selected_room]["has_medikit"] = True
        logger.info(f"Respawned medikit in room: {selected_room}")
        return selected_room

    return None

def get_survivor_floor_hints(game_state: dict) -> dict:
    """
    Get floor hints for survivors' positions.
    This function is kept for future use (e.g., Traque power).
    Returns: {floor: [player_names]}
    """
    floor_hints = {}
    
    for player_id, action in game_state.get("pending_actions", {}).items():
        if player_id in game_state["players"]:
            player = game_state["players"][player_id]
            if player["role"] == "survivor" and action.get("room"):
                room_name = action["room"]
                floor = game_state["rooms"][room_name]["floor"]
                if floor not in floor_hints:
                    floor_hints[floor] = []
                floor_hints[floor].append(player["name"])
    
    return floor_hints

# Power definitions
POWERS = {
    "vision": {
        "name": "👁️ Vision",
        "description": "Révèle en surbrillance les pièces que les survivants n'ont pas encore fouillé depuis l'obtention de la précédente clef",
        "icon": "vision.svg",
        "requires_action": False
    },
    "secousse": {
        "name": "↩️ Secousse",
        "description": "Si la clef n'est pas trouvée après le tour des tueurs, alors sa localisation change de pièce",
        "icon": "secousse.svg",
        "requires_action": False
    },
    "piege": {
        "name": "🕸️ Piège",
        "description": "Vous permet de piéger au choix une pièce par étage, immobilisant pour un tour le joueur survivant qui choisit prochainement cette pièce",
        "icon": "piege.svg",
        "requires_action": True,
        "action_type": "select_rooms_per_floor"  # select one room per floor
    },
    "traque": {
        "name": "🔊 Traque",
        "description": "Notifie les tueurs dans le journal d'événement de la présence de joueurs survivants selon l'étage",
        "icon": "traque.svg",
        "requires_action": False
    },
    "barricade": {
        "name": "🔒 Barricade",
        "description": "Vous permet de verrouiller au choix 2 pièces pour le prochain tour",
        "icon": "barricade.svg",
        "requires_action": True,
        "action_type": "select_rooms",  # select 2 rooms
        "rooms_count": 2
    }
}

def get_random_powers(exclude_powers: list = []) -> list:
    """Get 3 random unique powers"""
    available = [p for p in POWERS.keys() if p not in exclude_powers]
    return random.sample(available, min(3, len(available)))

async def check_power_selection_complete(session_id: str):
    """Check if all killers have completed their power selection"""
    game = game_sessions[session_id]
    
    alive_killers = [p for p in game["players"].values() if p["role"] == "killer" and not p["eliminated"]]
    
    all_complete = True
    for killer in alive_killers:
        killer_id = killer["id"]
        if killer_id not in game["pending_power_selections"]:
            all_complete = False
            break
        selection = game["pending_power_selections"][killer_id]
        if not selection.get("action_complete", False):
            all_complete = False
            break
    
    if all_complete:
        # Apply all selected powers
        await apply_powers(session_id)
        
        # Move to killer selection phase
        game["phase"] = "killer_selection"
        await broadcast_to_session(session_id, {
            "type": "phase_change",
            "phase": "killer_selection",
            "message": f"🔪 Les tueurs sélectionnent leur pièce"
        })

async def apply_powers(session_id: str):
    """Apply all selected powers"""
    game = game_sessions[session_id]
    game["active_powers"] = {}
    
    floor_names = {
        "basement": "au sous-sol",
        "ground_floor": "au rez-de-chaussée",
        "upper_floor": "à l'étage"
    }
    
    for player_id, selection in game["pending_power_selections"].items():
        power_name = selection["selected_power"]
        if not power_name:
            continue
        
        player = game["players"][player_id]
        
        # Initialize power in active_powers if not exists
        if power_name not in game["active_powers"]:
            game["active_powers"][power_name] = {
                "used_by": [],
                "data": {}
            }
        
        game["active_powers"][power_name]["used_by"].append(player_id)
        
        # Apply power-specific logic
        if power_name == "vision":
            # Highlight rooms not searched since last key - distributed across floors
            rooms_searched = game.get("rooms_searched_this_key", [])
            
            # Group unsearched rooms by floor for better distribution
            unsearched_by_floor = {
                "basement": [],
                "ground_floor": [],
                "upper_floor": []
            }
            
            for room_name, room_data in game["rooms"].items():
                if room_name not in rooms_searched:
                    floor = room_data.get("floor", "ground_floor")
                    unsearched_by_floor[floor].append(room_name)
            
            # Calculate total number to highlight (50% rounded down)
            total_unsearched = sum(len(rooms) for rooms in unsearched_by_floor.values())
            num_to_highlight = total_unsearched // 2
            
            # Select rooms with better distribution across floors
            rooms_to_highlight = []
            if num_to_highlight > 0 and total_unsearched > 0:
                # Create a list of all unsearched rooms with their floor info
                all_unsearched_with_floor = []
                for floor, rooms in unsearched_by_floor.items():
                    for room in rooms:
                        all_unsearched_with_floor.append((room, floor))
                
                # Shuffle to randomize
                random.shuffle(all_unsearched_with_floor)
                
                # Use round-robin selection to distribute across floors
                selected_count = 0
                floor_indices = {floor: 0 for floor in unsearched_by_floor.keys()}
                
                # Keep cycling through floors until we have enough selections
                while selected_count < num_to_highlight:
                    # Shuffle floor order for each round to add more randomness
                    floors = [f for f in unsearched_by_floor.keys() if unsearched_by_floor[f]]
                    random.shuffle(floors)
                    
                    for floor in floors:
                        if selected_count >= num_to_highlight:
                            break
                        
                        floor_rooms = unsearched_by_floor[floor]
                        if floor_indices[floor] < len(floor_rooms):
                            # Select next room from this floor
                            room = floor_rooms[floor_indices[floor]]
                            rooms_to_highlight.append(room)
                            floor_indices[floor] += 1
                            selected_count += 1
                    
                    # Safety check to avoid infinite loop
                    if all(floor_indices[f] >= len(unsearched_by_floor[f]) for f in floors):
                        break
                
                # Highlight selected rooms
                for room_name in rooms_to_highlight:
                    game["rooms"][room_name]["highlighted"] = True
            
            event_msg = f"👁️ {player['name']} utilise Vision !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
        
        elif power_name == "secousse":
            # Mark that key should move if not found
            game["active_powers"][power_name]["data"]["should_relocate_key"] = True
            
            event_msg = f"↩️ {player['name']} utilise Secousse !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
        
        elif power_name == "piege":
            # Trap selected rooms
            action_data = selection.get("action_data", {})
            trapped_rooms = action_data.get("rooms", [])
            
            for room_name in trapped_rooms:
                if room_name in game["rooms"]:
                    game["rooms"][room_name]["trapped"] = True
            
            game["active_powers"][power_name]["data"]["trapped_rooms"] = trapped_rooms
            
            event_msg = f"🕸️ {player['name']} utilise Piège !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
        
        elif power_name == "traque":
            # Get floor hints and send to killers
            floor_hints = get_survivor_floor_hints(game)
            
            for floor, names in floor_hints.items():
                floor_name_fr = floor_names.get(floor, floor)
                sound_event_msg = f"👂 Vous entendez du bruit {floor_name_fr}..."
                game["events"].append({"message": sound_event_msg, "type": "sound_clue", "for_role": "killer"})
                await broadcast_to_session(session_id, {"type": "event", "message": sound_event_msg}, role_filter="killer")
            
            event_msg = f"🔊 {player['name']} utilise Traque !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
        
        elif power_name == "barricade":
            # Lock selected rooms for next turn
            action_data = selection.get("action_data", {})
            locked_rooms = action_data.get("rooms", [])
            
            game["active_powers"][power_name]["data"]["locked_rooms_next_turn"] = locked_rooms
            
            event_msg = f"🔒 {player['name']} utilise Barricade !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

def filter_game_state(game_state: dict, player_role: str) -> dict:
    """
    Filter game state based on player role for visibility rules:
    - Survivors see: other survivors' positions + eliminated players
    - Killers see: other killers' positions + eliminated players + highlighted rooms (Vision power)
    - pending_actions are filtered to only show actions from same role
    """
    filtered_state = game_state.copy()
    filtered_state["players"] = {}
    filtered_state["pending_actions"] = {}
    
    # Filter rooms based on role
    filtered_state["rooms"] = {}
    for room_name, room_data in game_state["rooms"].items():
        room_copy = room_data.copy()
        
        if player_role == "survivor":
            # Survivors see trap_triggered but not highlighted or just trapped
            room_copy["highlighted"] = False
            if not room_copy.get("trap_triggered", False):
                room_copy["trapped"] = False
        elif player_role == "killer":
            # Killers see trapped and highlighted, but not trap_triggered
            room_copy.pop("trap_triggered", None)
        
        filtered_state["rooms"][room_name] = room_copy

    for pid, player_data in game_state["players"].items():
        player_copy = player_data.copy()

        if player_role == "survivor":
            # Survivors see all survivors' positions and eliminated players
            if player_data["role"] == "survivor" or player_data["eliminated"]:
                filtered_state["players"][pid] = player_copy
            else:
                # Hide killer position (but keep player in list without current_room)
                player_copy["current_room"] = None
                filtered_state["players"][pid] = player_copy

        elif player_role == "killer":
            # Killers see other killers' positions and eliminated players
            if player_data["role"] == "killer" or player_data["eliminated"]:
                filtered_state["players"][pid] = player_copy
            else:
                # Hide survivor position (but keep player in list without current_room)
                player_copy["current_room"] = None
                filtered_state["players"][pid] = player_copy

    # Filter pending_actions: only show actions from same role
    for pid, action in game_state.get("pending_actions", {}).items():
        if pid in game_state["players"]:
            player = game_state["players"][pid]
            if player["role"] == player_role:
                filtered_state["pending_actions"][pid] = action
    
    # Filter pending_power_selections: only show to killers
    if player_role == "killer":
        filtered_state["pending_power_selections"] = game_state.get("pending_power_selections", {})
    else:
        filtered_state["pending_power_selections"] = {}

    return filtered_state

async def broadcast_to_session(session_id: str, message: dict, role_filter: Optional[str] = None):
    """
    Send message to all players in a session
    If role_filter is provided, only send to players with that role
    """
    if session_id not in active_connections:
        return

    game = game_sessions.get(session_id)
    if not game:
        return

    disconnected = []
    for player_id, websocket in active_connections[session_id].items():
        # Check if we should send to this player based on role_filter
        if role_filter:
            player = game["players"].get(player_id)
            if not player or player["role"] != role_filter:
                continue

        try:
            # If sending state_update, filter it based on player's role
            if message.get("type") == "state_update" and player_id in game["players"]:
                player_role = game["players"][player_id]["role"]
                filtered_game = filter_game_state(game, player_role)
                filtered_message = message.copy()
                filtered_message["game"] = filtered_game
                await websocket.send_json(filtered_message)
            else:
                await websocket.send_json(message)
        except:
            disconnected.append(player_id)

    # Clean up disconnected players
    for player_id in disconnected:
        del active_connections[session_id][player_id]

async def process_turn(session_id: str):
    """Process a complete turn - survivors and killers have already selected their rooms"""
    game = game_sessions[session_id]
    
    key_found_this_turn = False

    # At the start of the turn, place a new key if needed
    if game["should_place_next_key"]:
        placed_room = place_next_key(game)
        if placed_room:
            game["should_place_next_key"] = False

    # Unlock previously locked rooms (except those locked by Barricade)
    barricade_locked_rooms = []
    if "barricade" in game.get("active_powers", {}):
        barricade_locked_rooms = game["active_powers"]["barricade"]["data"].get("locked_rooms_next_turn", [])
    
    for room_name, room_data in game["rooms"].items():
        if room_data["locked"] and room_name not in barricade_locked_rooms:
            room_data["locked"] = False
    
    # Apply Barricade locked rooms for next turn
    for room_name in barricade_locked_rooms:
        if room_name in game["rooms"]:
            game["rooms"][room_name]["locked"] = True
            event_msg = f"🔒 La pièce {room_name} est barricadée pour ce tour."
            game["events"].append({"message": event_msg, "type": "room_locked"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
    
    # Clear vision highlights from rooms
    for room_name, room_data in game["rooms"].items():
        room_data["highlighted"] = False
    
    # NOTE: Traps are NOT cleared here anymore!
    # They need to persist until AFTER survivors make their selection in the next turn
    # Traps will be cleared in the survivor_selection phase after all survivors have selected

    # Separate survivors and killers actions
    survivors_actions = {}
    killers_actions = {}

    for player_id, action in game["pending_actions"].items():
        player = game["players"][player_id]
        if player["role"] == "survivor" and not player["eliminated"]:
            survivors_actions[player_id] = action
        elif player["role"] == "killer" and not player["eliminated"]:
            killers_actions[player_id] = action

    floor_names = {
        "basement": "au sous-sol",
        "ground_floor": "au rez-de-chaussée",
        "upper_floor": "à l'étage"
    }

    # ============================================
    # PHASE 1: SURVIVORS PLAY FIRST
    # ============================================

    # Move survivors to their selected rooms
    for player_id, action in survivors_actions.items():
        game["players"][player_id]["current_room"] = action["room"]

    # Survivors interact with rooms (keys, medikits, auto-revival)
    for player_id, action in survivors_actions.items():
        player = game["players"][player_id]
        room = game["rooms"][action["room"]]

        # Check for key
        if room["has_key"]:
            room["has_key"] = False
            game["keys_collected"] += 1
            keys_left = game["keys_needed"] - game["keys_collected"]
            event_msg = f"🔑 {player['name']} a trouvé une clef ! Il reste {keys_left} clef(s) à trouver."
            game["events"].append({"message": event_msg, "type": "key_found", "for_role": "survivor"})
            # Notify only survivors about key found
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="survivor")
            
            # Send popup notification to the player who found the key
            if player_id in active_connections.get(session_id, {}):
                try:
                    await active_connections[session_id][player_id].send_json({
                        "type": "key_found_popup",
                        "message": f"Vous avez trouvé une clef ! Plus que {keys_left} clef(s) pour vous enfuir !",
                        "keys_left": keys_left
                    })
                except:
                    pass
            
            key_found_this_turn = True
            # Reset rooms searched for Vision power
            game["rooms_searched_this_key"] = []

            # Set flag to place next key
            if game["keys_collected"] < game["keys_needed"]:
                game["should_place_next_key"] = True
        else:
            # Log unsuccessful search - only visible to survivors
            event_msg = f"🔍 {player['name']} fouille {action['room']} mais ne trouve aucune clef."
            game["events"].append({"message": event_msg, "type": "search_no_key", "for_role": "survivor"})
            # Notify only survivors about unsuccessful search
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="survivor")

        # Check for medikit
        if room["has_medikit"]:
            room["has_medikit"] = False
            player["has_medikit"] = True
            event_msg = f"🩺 {player['name']} a trouvé le medikit et en est désormais le porteur."
            game["events"].append({"message": event_msg, "type": "medikit_found"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

        # Auto-revive: If survivor has medikit and enters room with eliminated player
        if player["has_medikit"] and room["eliminated_players"]:
            # Revive the first eliminated player in this room
            target_player_id = room["eliminated_players"][0]
            if target_player_id in game["players"] and game["players"][target_player_id]["eliminated"]:
                # Revive the player
                game["players"][target_player_id]["eliminated"] = False
                player["has_medikit"] = False
                room["eliminated_players"].remove(target_player_id)

                event_msg = f"💚 {player['name']} a ranimé {game['players'][target_player_id]['name']} !"
                game["events"].append({"message": event_msg, "type": "revival"})
                await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

                # Respawn the medikit
                new_medikit_room = respawn_medikit(game)
                if new_medikit_room:
                    respawn_msg = f"🩺 Le medikit réapparaît quelque part dans la maison..."
                    game["events"].append({"message": respawn_msg, "type": "medikit_respawn"})
                    await broadcast_to_session(session_id, {"type": "event", "message": respawn_msg})

    # ============================================
    # PHASE 2: KILLERS PLAY SECOND
    # ============================================

    # Move killers to their selected rooms
    for player_id, action in killers_actions.items():
        game["players"][player_id]["current_room"] = action["room"]

    # Check for eliminations (killers finding survivors in same room)
    eliminated_rooms = []

    for killer_id, killer_action in killers_actions.items():
        killer = game["players"][killer_id]
        killer_room = killer["current_room"]

        # Check if any survivors are in the same room
        for survivor_id, survivor in game["players"].items():
            if (survivor["role"] == "survivor" and
                not survivor["eliminated"] and
                survivor["current_room"] == killer_room):

                # Eliminate the survivor
                survivor["eliminated"] = True
                game["rooms"][killer_room]["eliminated_players"].append(survivor_id)
                eliminated_rooms.append(killer_room)

                event_msg = f"💀 {survivor['name']} a été éliminé dans {killer_room} !"
                game["events"].append({"message": event_msg, "type": "elimination"})
                await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

                # If survivor had medikit, destroy it and respawn a new one
                if survivor["has_medikit"]:
                    survivor["has_medikit"] = False
                    new_medikit_room = respawn_medikit(game)
                    if new_medikit_room:
                        respawn_msg = f"🩺 Le medikit réapparaît quelque part dans la maison..."
                        game["events"].append({"message": respawn_msg, "type": "medikit_respawn"})
                        await broadcast_to_session(session_id, {"type": "event", "message": respawn_msg})

    # Lock rooms where eliminations occurred
    for room_name in set(eliminated_rooms):
        game["rooms"][room_name]["locked"] = True
        event_msg = f"⚠️ La pièce {room_name} est condamnée pour ce tour."
        game["events"].append({"message": event_msg, "type": "room_locked"})
        await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
    
    # Apply Secousse power: relocate key if not found this turn
    if not key_found_this_turn and "secousse" in game.get("active_powers", {}):
        if game["active_powers"]["secousse"]["data"].get("should_relocate_key", False):
            # Find current key location and remove it
            current_key_room = None
            for room_name, room_data in game["rooms"].items():
                if room_data.get("has_key", False):
                    room_data["has_key"] = False
                    current_key_room = room_name
                    break
            
            # Place key in new location
            if current_key_room:
                new_key_room = place_next_key(game)
                if new_key_room:
                    event_msg = f"↩️ La clef s'est déplacée vers une nouvelle pièce !"
                    game["events"].append({"message": event_msg, "type": "key_relocated"})
                    await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

    # Check victory conditions
    alive_survivors = [p for p in game["players"].values() if p["role"] == "survivor" and not p["eliminated"]]

    if game["keys_collected"] >= game["keys_needed"] and len(alive_survivors) > 0:
        game["phase"] = "game_over"
        game["winner"] = "survivors"

        # Send different messages based on role
        survivor_msg = "🎉 VICTOIRE ! Les survivants ont collecté toutes les clefs !"
        killer_msg = "🎉 DEFAITE ! Les survivants ont collecté toutes les clefs !"

        game["events"].append({"message": survivor_msg, "type": "game_over", "for_role": "survivor"})
        game["events"].append({"message": killer_msg, "type": "game_over", "for_role": "killer"})

        # Send to survivors
        await broadcast_to_session(session_id, {"type": "game_over", "winner": "survivors", "message": survivor_msg}, role_filter="survivor")
        # Send to killers
        await broadcast_to_session(session_id, {"type": "game_over", "winner": "survivors", "message": killer_msg}, role_filter="killer")

    elif len(alive_survivors) == 0:
        game["phase"] = "game_over"
        game["winner"] = "killers"

        # Send different messages based on role
        survivor_msg = "🎉 DEFAITE ! Tous les survivants ont été éliminés..."
        killer_msg = "💀 VICTOIRE ! Tous les survivants ont été éliminés ..."

        game["events"].append({"message": survivor_msg, "type": "game_over", "for_role": "survivor"})
        game["events"].append({"message": killer_msg, "type": "game_over", "for_role": "killer"})

        # Send to survivors
        await broadcast_to_session(session_id, {"type": "game_over", "winner": "killers", "message": survivor_msg}, role_filter="survivor")
        # Send to killers
        await broadcast_to_session(session_id, {"type": "game_over", "winner": "killers", "message": killer_msg}, role_filter="killer")

    else:
        # Next turn - Start with survivors selection
        game["turn"] += 1
        game["phase"] = "survivor_selection"
        game["pending_actions"] = {}
        # Clear active powers
        game["active_powers"] = {}
        game["pending_power_selections"] = {}
        await broadcast_to_session(session_id, {
            "type": "new_turn",
            "turn": game["turn"],
            "phase": "survivor_selection",
            "message": f"🔄 Tour {game['turn']} - Les survivants sélectionnent leur pièce"
        })

# REST API Endpoints
@api_router.post("/game/create")
async def create_game(request: CreateGameRequest):
    """Create a new game session"""
    host_id = str(uuid.uuid4())
    game_state = create_game_state(host_id, request.host_name, request.host_avatar, request.role)
    session_id = game_state["session_id"]
    
    # NEW: Set conspiracy mode if enabled
    game_state["conspiracy_mode"] = request.conspiracy_mode

    game_sessions[session_id] = game_state
    active_connections[session_id] = {}

    return {
        "session_id": session_id,
        "player_id": host_id,
        "join_link": f"/join/{session_id}"
    }

@api_router.post("/game/{session_id}/join")
async def join_game(session_id: str, request: JoinGameRequest):
    """Join an existing game session"""
    # MODIFIED: Accept case-insensitive session_id
    session_id_upper = session_id.upper()
    
    # Find the matching session (case-insensitive)
    matching_session = None
    for sid in game_sessions.keys():
        if sid.upper() == session_id_upper:
            matching_session = sid
            break
    
    if not matching_session:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[matching_session]

    if game["game_started"]:
        raise HTTPException(status_code=400, detail="Game already started")

    if len(game["players"]) >= 8:
        raise HTTPException(status_code=400, detail="Game is full")

    player_id = str(uuid.uuid4())
    game["players"][player_id] = {
        "id": player_id,
        "name": request.player_name,
        "avatar": request.player_avatar,
        "is_host": False,
        "eliminated": False,
        "current_room": None,
        "has_medikit": False,
        "role": request.role,  # "survivor" or "killer"
        "immobilized_next_turn": False  # NEW: for piege power
    }

    # Broadcast new player joined
    await broadcast_to_session(matching_session, {
        "type": "player_joined",
        "player": game["players"][player_id]
    })

    return {
        "session_id": matching_session,
        "player_id": player_id
    }

@api_router.post("/game/{session_id}/start")
async def start_game(session_id: str):
    """Start the game"""
    logger.info(f"Attempting to start game: {session_id}")

    if session_id not in game_sessions:
        logger.error(f"Session not found: {session_id}")
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]
    logger.info(f"Game state: game_started={game['game_started']}, players={len(game['players'])}")

    if game["game_started"]:
        logger.error(f"Game already started: {session_id}")
        raise HTTPException(status_code=400, detail="Game already started")

    # NEW: Handle conspiracy mode - randomly assign roles
    if game.get("conspiracy_mode", False):
        player_count = len(game["players"])
        
        # Define role distribution based on player count
        role_distribution = {
            3: {"survivors": 2, "killers": 1},
            4: {"survivors": 2, "killers": 2},
            5: {"survivors": 3, "killers": 2},
            6: {"survivors": 4, "killers": 2},
            7: {"survivors": 4, "killers": 3},
            8: {"survivors": 5, "killers": 3}
        }
        
        # Get the distribution for current player count
        distribution = role_distribution.get(player_count, {"survivors": max(1, player_count - 1), "killers": 1})
        
        # Get all player IDs and shuffle them
        player_ids = list(game["players"].keys())
        random.shuffle(player_ids)
        
        # Assign roles
        for i, player_id in enumerate(player_ids):
            if i < distribution["survivors"]:
                game["players"][player_id]["role"] = "survivor"
            else:
                game["players"][player_id]["role"] = "killer"
        
        logger.info(f"Conspiracy mode: Assigned {distribution['survivors']} survivors and {distribution['killers']} killers")

    # Count survivors (only survivors need to collect keys)
    survivors = [p for p in game["players"].values() if p["role"] == "survivor"]
    game["keys_needed"] = len(survivors)
    game["game_started"] = True
    game["phase"] = "survivor_selection"  # Start with survivors
    game["turn"] = 1

    # Place the FIRST key at game start
    first_key_room = place_next_key(game)
    logger.info(f"First key placed in: {first_key_room}")

    # Place the FIRST medikit at game start
    medikit_room = respawn_medikit(game)
    logger.info(f"First medikit placed in: {medikit_room}")

    await broadcast_to_session(session_id, {
        "type": "game_started",
        "keys_needed": game["keys_needed"],
        "phase": "survivor_selection",
        "message": f"🎮 Le jeu commence ! Les survivants doivent collecter {game['keys_needed']} clefs pour gagner. Tour 1 - Les survivants sélectionnent leur pièce."
    })

    return {"status": "started"}

@api_router.get("/game/{session_id}/state")
async def get_game_state(session_id: str, player_id: Optional[str] = None):
    """Get current game state, filtered by player role if player_id provided"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]

    # If player_id provided, filter state based on role
    if player_id and player_id in game["players"]:
        player_role = game["players"][player_id]["role"]
        return filter_game_state(game, player_role)

    return game

@api_router.get("/powers")
async def get_powers():
    """Get all available powers"""
    return POWERS

@api_router.post("/game/{session_id}/reset")
async def reset_game(session_id: str):
    """Reset the game to lobby state for a rematch"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]
    
    # Reset all game state while keeping players
    for player_id, player in game["players"].items():
        player["eliminated"] = False
        player["current_room"] = None
        player["has_medikit"] = False
        player["immobilized_next_turn"] = False  # NEW: reset immobilization
    
    # Reset rooms
    for room_name, room_data in game["rooms"].items():
        room_data["has_key"] = False
        room_data["has_medikit"] = False
        room_data["locked"] = False
        room_data["eliminated_players"] = []
        room_data["trapped"] = False  # NEW: reset traps
        room_data["highlighted"] = False  # NEW: reset highlights
        room_data.pop("trap_triggered", None)  # NEW: remove trap_triggered
    
    # Reset game state
    game["keys_collected"] = 0
    game["keys_needed"] = 1
    game["game_started"] = False
    game["turn"] = 0
    game["phase"] = "waiting"
    game["events"] = []
    game["pending_actions"] = {}
    game["should_place_next_key"] = False
    game["active_powers"] = {}  # NEW: reset powers
    game["pending_power_selections"] = {}  # NEW: reset power selections
    game["rooms_searched_this_key"] = []  # NEW: reset searched rooms
    
    logger.info(f"Game reset for session: {session_id}")
    
    # Broadcast game reset to all players
    await broadcast_to_session(session_id, {
        "type": "game_reset",
        "message": "La partie est terminée. Prêts pour une revanche ?"
    })
    
    # Send updated state to all players so they see the correct lobby state
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })
    
    return {"status": "reset"}

@api_router.post("/game/{session_id}/change_role")
async def change_role(session_id: str, player_id: str, new_role: str):
    """Allow a player to change their role in the lobby"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]
    
    if game["game_started"]:
        raise HTTPException(status_code=400, detail="Cannot change role during game")
    
    if player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")
    
    if new_role not in ["survivor", "killer"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    # Change the player's role
    game["players"][player_id]["role"] = new_role
    
    logger.info(f"Player {player_id} changed role to {new_role} in session {session_id}")
    
    # Broadcast role change to all players
    await broadcast_to_session(session_id, {
        "type": "role_changed",
        "player_id": player_id,
        "player_name": game["players"][player_id]["name"],
        "new_role": new_role
    })
    
    return {"status": "success", "new_role": new_role}

# WebSocket endpoint
@app.websocket("/api/ws/{session_id}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str, player_id: str):
    """WebSocket connection for real-time game updates"""
    await websocket.accept()

    if session_id not in game_sessions:
        await websocket.close(code=1008)
        return

    if session_id not in active_connections:
        active_connections[session_id] = {}

    active_connections[session_id][player_id] = websocket

    floor_names = {
        "basement": "au sous-sol",
        "ground_floor": "au rez-de-chaussée",
        "upper_floor": "à l'étage"
    }

    try:
        # Send current game state (filtered by player role)
        game = game_sessions[session_id]
        if player_id in game["players"]:
            player_role = game["players"][player_id]["role"]
            filtered_game = filter_game_state(game, player_role)
            await websocket.send_json({
                "type": "state_update",
                "game": filtered_game
            })

        while True:
            data = await websocket.receive_json()
            game = game_sessions[session_id]
            player = game["players"][player_id]

            if data["type"] == "select_room":
                # Check if it's the player's turn based on their role and current phase
                if player["role"] == "survivor" and game["phase"] != "survivor_selection":
                    continue
                if player["role"] == "killer" and game["phase"] != "killer_selection":
                    continue

                room_name = data["room"]
                
                # Check immobilization for survivors
                if player["role"] == "survivor" and player.get("immobilized_next_turn", False):
                    current_room = player.get("current_room")
                    
                    # If player tries to select a different room, block it
                    if room_name != current_room:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"🕸️ Vous êtes immobilisé par un piège ! Cliquez sur '{current_room}' pour passer votre tour."
                        })
                        # Broadcast updated state even on error so frontend stays responsive
                        await broadcast_to_session(session_id, {
                            "type": "state_update",
                            "game": game_sessions[session_id]
                        })
                        continue
                    
                    # Player selected their current room - they pass their turn
                    player["immobilized_next_turn"] = False
                    game["pending_actions"][player_id] = {
                        "action": "select_room",
                        "room": room_name
                    }
                    
                    # Notify the player they've passed their turn
                    await websocket.send_json({
                        "type": "turn_skipped",
                        "message": "🕸️ Vous passez votre tour car vous êtes immobilisé."
                    })
                    
                    # Notify all players
                    await broadcast_to_session(session_id, {
                        "type": "player_action",
                        "player_id": player_id,
                        "player_name": game["players"][player_id]["name"],
                        "message": f"✅ {game['players'][player_id]['name']} a fait son choix"
                    })
                    
                    # Check if all survivors have selected
                    if game["phase"] == "survivor_selection":
                        alive_survivors = [p for p in game["players"].values()\
                                         if p["role"] == "survivor" and not p["eliminated"]]
                        survivors_selected = [pid for pid in game["pending_actions"].keys()\
                                            if game["players"][pid]["role"] == "survivor"]

                        if len(survivors_selected) == len(alive_survivors):
                            # All survivors have selected, NOW clear traps from previous turn
                            for room_name_clear, room_data in game["rooms"].items():
                                room_data["trapped"] = False
                                room_data.pop("trap_triggered", None)
                            
                            # Move to killer power selection
                            game["phase"] = "killer_power_selection"
                            game["pending_power_selections"] = {}
                            
                            # Assign 3 random powers to each killer
                            alive_killers = [p for p in game["players"].values() if p["role"] == "killer" and not p["eliminated"]]
                            for killer in alive_killers:
                                killer_id = killer["id"]
                                power_options = get_random_powers()
                                game["pending_power_selections"][killer_id] = {
                                    "options": power_options,
                                    "selected_power": None,
                                    "action_data": None,
                                    "action_complete": False
                                }
                            
                            await broadcast_to_session(session_id, {
                                "type": "phase_change",
                                "phase": "killer_power_selection",
                                "message": f"🎴 Les tueurs choisissent leur pouvoir"
                            })
                    
                    # Broadcast updated state
                    await broadcast_to_session(session_id, {
                        "type": "state_update",
                        "game": game_sessions[session_id]
                    })
                    continue
                
                if room_name in game["rooms"] and not game["rooms"][room_name]["locked"]:
                    game["pending_actions"][player_id] = {
                        "action": "select_room",
                        "room": room_name
                    }

                    # DISABLED: Sound clue functionality kept for Traque power
                    # The get_survivor_floor_hints() function can be used when Traque is activated
                    # if player["role"] == "survivor":
                    #     survivor_floor = game["rooms"][room_name]["floor"]
                    #     sound_event_msg = f"👂 Vous entendez du bruit {floor_names[survivor_floor]}..."
                    #     game["events"].append({"message": sound_event_msg, "type": "sound_clue", "for_role": "killer"})
                    #     await broadcast_to_session(session_id, {"type": "event", "message": sound_event_msg}, role_filter="killer")
                    
                    # Track rooms searched for Vision power
                    if player["role"] == "survivor" and room_name not in game.get("rooms_searched_this_key", []):
                        if "rooms_searched_this_key" not in game:
                            game["rooms_searched_this_key"] = []
                        game["rooms_searched_this_key"].append(room_name)
                    
                    # Check if survivor enters trapped room
                    if player["role"] == "survivor" and game["rooms"][room_name].get("trapped", False):
                        player["immobilized_next_turn"] = True
                        # Mark room as trap triggered for survivors
                        game["rooms"][room_name]["trap_triggered"] = True
                        
                        # NEW: Send trap notification immediately to the survivor
                        await websocket.send_json({
                            "type": "trapped_notification",
                            "message": "🕸️ Vous êtes tombé dans un piège ! Vous ne pourrez pas bouger au prochain tour."
                        })

                    # Notify all players
                    await broadcast_to_session(session_id, {
                        "type": "player_action",
                        "player_id": player_id,
                        "player_name": game["players"][player_id]["name"],
                        "message": f"✅ {game['players'][player_id]['name']} a fait son choix"
                    })

                    # Check if all players of the current role have selected
                    if game["phase"] == "survivor_selection":
                        alive_survivors = [p for p in game["players"].values()\
                                         if p["role"] == "survivor" and not p["eliminated"]]
                        survivors_selected = [pid for pid in game["pending_actions"].keys()\
                                            if game["players"][pid]["role"] == "survivor"]

                        if len(survivors_selected) == len(alive_survivors):
                            # All survivors have selected, NOW clear traps from previous turn
                            # This ensures traps persist for exactly one turn after being set
                            for room_name, room_data in game["rooms"].items():
                                room_data["trapped"] = False
                                room_data.pop("trap_triggered", None)
                            
                            # Move to killer power selection
                            game["phase"] = "killer_power_selection"
                            game["pending_power_selections"] = {}
                            
                            # Assign 3 random powers to each killer
                            alive_killers = [p for p in game["players"].values() if p["role"] == "killer" and not p["eliminated"]]
                            for killer in alive_killers:
                                killer_id = killer["id"]
                                power_options = get_random_powers()
                                game["pending_power_selections"][killer_id] = {
                                    "options": power_options,
                                    "selected_power": None,
                                    "action_data": None,
                                    "action_complete": False
                                }
                            
                            await broadcast_to_session(session_id, {
                                "type": "phase_change",
                                "phase": "killer_power_selection",
                                "message": f"🎴 Les tueurs choisissent leur pouvoir"
                            })

                    elif game["phase"] == "killer_selection":
                        alive_killers = [p for p in game["players"].values()\
                                       if p["role"] == "killer" and not p["eliminated"]]
                        killers_selected = [pid for pid in game["pending_actions"].keys()\
                                          if game["players"][pid]["role"] == "killer"]

                        if len(killers_selected) == len(alive_killers):
                            # All killers have selected, process the turn
                            game["phase"] = "processing"
                            await process_turn(session_id)
            
            elif data["type"] == "select_power":
                # Only killers can select powers during power selection phase
                if player["role"] != "killer" or game["phase"] != "killer_power_selection":
                    continue
                
                if player_id not in game["pending_power_selections"]:
                    continue
                
                power_name = data["power"]
                if power_name not in game["pending_power_selections"][player_id]["options"]:
                    continue
                
                game["pending_power_selections"][player_id]["selected_power"] = power_name
                
                # Check if power requires action
                power_def = POWERS[power_name]
                if power_def["requires_action"]:
                    game["pending_power_selections"][player_id]["action_complete"] = False
                    await websocket.send_json({
                        "type": "power_action_required",
                        "power": power_name,
                        "action_type": power_def["action_type"],
                        "rooms_count": power_def.get("rooms_count", 1)
                    })
                else:
                    game["pending_power_selections"][player_id]["action_complete"] = True
                    await broadcast_to_session(session_id, {
                        "type": "player_action",
                        "player_id": player_id,
                        "player_name": game["players"][player_id]["name"],
                        "message": f"✅ {game['players'][player_id]['name']} a choisi son pouvoir"
                    })
                    
                    # Check if all killers have completed their power selection
                    await check_power_selection_complete(session_id)
            
            elif data["type"] == "power_action":
                # Handle power actions (e.g., selecting rooms for piege or barricade)
                if player["role"] != "killer" or game["phase"] != "killer_power_selection":
                    continue
                
                if player_id not in game["pending_power_selections"]:
                    continue
                
                power_selection = game["pending_power_selections"][player_id]
                if not power_selection["selected_power"]:
                    continue
                
                power_selection["action_data"] = data["action_data"]
                power_selection["action_complete"] = True
                
                await broadcast_to_session(session_id, {
                    "type": "player_action",
                    "player_id": player_id,
                    "player_name": game["players"][player_id]["name"],
                    "message": f"✅ {game['players'][player_id]['name']} a configuré son pouvoir"
                })
                
                # Check if all killers have completed their power selection
                await check_power_selection_complete(session_id)

            elif data["type"] == "use_medikit":
                # Only survivors can use medikits
                if game["players"][player_id]["role"] != "survivor":
                    continue

                if not game["players"][player_id]["has_medikit"]:
                    continue

                target_player_id = data["target_player_id"]
                if target_player_id in game["players"] and game["players"][target_player_id]["eliminated"]:
                    target_room = game["players"][target_player_id]["current_room"]
                    current_room = game["players"][player_id]["current_room"]

                    if target_room == current_room:
                        # Revive player
                        game["players"][target_player_id]["eliminated"] = False
                        game["players"][player_id]["has_medikit"] = False

                        # Remove from eliminated list
                        if target_player_id in game["rooms"][target_room]["eliminated_players"]:
                            game["rooms"][target_room]["eliminated_players"].remove(target_player_id)

                        event_msg = f"💚 {game['players'][player_id]['name']} a ranimé {game['players'][target_player_id]['name']} !"
                        game["events"].append({"message": event_msg, "type": "revival"})
                        await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

                        # Respawn the medikit
                        new_medikit_room = respawn_medikit(game)
                        if new_medikit_room:
                            respawn_msg = f"🩺 Le medikit réapparaît quelque part dans la maison..."
                            game["events"].append({"message": respawn_msg, "type": "medikit_respawn"})
                            await broadcast_to_session(session_id, {"type": "event", "message": respawn_msg})

            # Broadcast updated state (filtered per player)
            await broadcast_to_session(session_id, {
                "type": "state_update",
                "game": game_sessions[session_id]
            })

    except WebSocketDisconnect:
        if session_id in active_connections and player_id in active_connections[session_id]:
            del active_connections[session_id][player_id]

@api_router.get("/")
async def root():
    return {"message": "Yishimo Kawazaki's Game API"}

# Include the router
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
