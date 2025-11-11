from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Query
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
    "basement": ["Les Cryptes", "Les Cachots", "La Cave", "Salle des Ruines"],
    "ground_floor": ["Hall Principal", "Salle du Banquet", "Armurerie", "Cour Intérieure"],
    "upper_floor": ["Chambre Cérémoniale", "Laboratoire", "Salle des Miroirs", "Sanctuaire"]
}

# Avatar images by role with their associated classes
SURVIVOR_AVATARS = [
    {"path": "/avatars/Archère.png", "class": "Archère"},
    {"path": "/avatars/Assassin.png", "class": "Assassin"},
    {"path": "/avatars/Barbare.png", "class": "Barbare"},
    {"path": "/avatars/Barde.png", "class": "Barde"},
    {"path": "/avatars/Elfe.png", "class": "Elfe"},
    {"path": "/avatars/Guerrier.png", "class": "Guerrier"},
    {"path": "/avatars/Mage.png", "class": "Mage"}
]

KILLER_AVATARS = [
    {"path": "/avatars/Orc Berzerker.png", "class": "Orc Berzerker"},
    {"path": "/avatars/Orc Chaman.png", "class": "Orc Chaman"},
    {"path": "/avatars/Orc Roi.png", "class": "Orc Roi"}
]

# All avatars (for validation)
ALL_AVATARS = SURVIVOR_AVATARS + KILLER_AVATARS

# Helper function to get class from avatar path
def get_avatar_class(avatar_path: str) -> Optional[str]:
    """Get the class associated with an avatar path"""
    for avatar in ALL_AVATARS:
        if avatar["path"] == avatar_path:
            return avatar["class"]
    return None

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
            "highlighted": False,  # NEW: for vision power
            "has_quest": False,  # NEW: for quest system
            "quest_class": None,  # NEW: class required for the quest
            "poisoned_turns_remaining": 0,  # NEW: for toxine power (0-3 turns)
            "has_mimic": False,  # NEW: for mimic power
            "has_crystal": False  # NEW: for crystal system
        }

    # Get character class from avatar
    character_class = get_avatar_class(host_avatar)

    return {
        "session_id": generate_short_code(),  # MODIFIED: Use short code instead of UUID
        "host_id": host_id,
        "players": {
            host_id: {
                "id": host_id,
                "name": host_name,
                "avatar": host_avatar,
                "character_class": character_class,  # NEW: character class based on avatar
                "is_host": True,
                "eliminated": False,
                "current_room": None,
                "has_medikit": False,
                "role": host_role,  # "survivor" or "killer"
                "immobilized_next_turn": False,  # NEW: for piege power
                "poisoned_countdown": 0,  # NEW: for toxine power (0-10 turns, 0 = not poisoned)
                "gold": 0  # NEW: gold accumulated by survivors
            }
        },
        "rooms": rooms_state,
        "keys_collected": 0,
        "keys_needed": 1,
        "game_started": False,
        "turn": 0,
        "phase": "waiting",  # waiting, survivor_selection, killer_power_selection, killer_selection, processing, game_over, rage_second_selection
        "events": [],
        "pending_actions": {},
        "should_place_next_key": False,
        "conspiracy_mode": False,  # NEW: conspiracy mode flag
        "active_powers": {},  # NEW: {power_name: {used_by: [player_ids], data: {...}}}
        "pending_power_selections": {},  # NEW: {player_id: {selected_power: str, options: [str], action_data: {...}}}
        "rooms_searched_this_key": [],  # NEW: track rooms searched since last key found (for vision power)
        "quests": [],  # NEW: list of all quests to complete
        "active_quest": None,  # NEW: current active quest {class: "Mage", room: "Les Cryptes"}
        "completed_quests": [],  # NEW: list of completed quest classes
        "rage_second_chances": {},  # NEW: {killer_id: {"can_select": True/False, "room_selected": None}}
        "crystal_spawned": False,  # NEW: whether crystal has been spawned
        "crystal_destroyed": False,  # NEW: whether crystal has been destroyed (victory condition)
        "created_at": datetime.now(timezone.utc).isoformat()
    }

def generate_quests(survivors: list) -> list:
    """Generate a randomized list of quests based on survivor classes"""
    quests = []
    for survivor in survivors:
        if survivor.get("character_class"):
            quests.append({
                "class": survivor["character_class"],
                "player_id": survivor["id"],
                "player_name": survivor["name"]
            })
    
    # Randomize quest order
    random.shuffle(quests)
    return quests

def place_quest(game_state: dict, quest_class: str) -> Optional[str]:
    """Place a quest in a random available room"""
    available_rooms = []

    # Get all killer positions
    killer_positions = [p["current_room"] for p in game_state["players"].values()
                       if p["role"] == "killer" and p["current_room"]]

    for room_name, room_data in game_state["rooms"].items():
        # Room is available if: not locked, no quest already, not a killer's position
        if (not room_data["locked"] and
            not room_data.get("has_quest", False) and
            room_name not in killer_positions):
            available_rooms.append(room_name)

    if available_rooms:
        selected_room = random.choice(available_rooms)
        game_state["rooms"][selected_room]["has_quest"] = True
        game_state["rooms"][selected_room]["quest_class"] = quest_class
        logger.info(f"Placed quest for class {quest_class} in room: {selected_room}")
        return selected_room

    return None

def place_crystal(game_state: dict) -> Optional[str]:
    """Place the crystal in a random available room after all quests are completed"""
    available_rooms = []

    # Get all killer positions
    killer_positions = [p["current_room"] for p in game_state["players"].values()
                       if p["role"] == "killer" and p["current_room"]]

    for room_name, room_data in game_state["rooms"].items():
        # Room is available if: not locked, no crystal already, not a killer's position
        if (not room_data["locked"] and
            not room_data.get("has_crystal", False) and
            room_name not in killer_positions):
            available_rooms.append(room_name)

    if available_rooms:
        selected_room = random.choice(available_rooms)
        game_state["rooms"][selected_room]["has_crystal"] = True
        game_state["crystal_spawned"] = True
        logger.info(f"Crystal placed in room: {selected_room}")
        return selected_room

    return None

def place_next_key(game_state: dict) -> Optional[str]:
    """Place ONE key randomly in an available room (legacy function kept for compatibility)"""
    available_rooms = []

    # Get all killer positions
    killer_positions = [p["current_room"] for p in game_state["players"].values()
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

def generate_gold_reward() -> tuple[int, str]:
    """
    Generate a random gold reward and return the corresponding image path.
    Returns: (gold_amount, image_path)
    """
    gold_amount = random.randint(15, 200)
    
    # Determine image based on gold amount
    if 15 <= gold_amount <= 50:
        image_path = "/gold/small.png"
    elif 51 <= gold_amount <= 125:
        image_path = "/gold/big.png"
    else:  # 126-200
        image_path = "/gold/huge.png"
    
    return gold_amount, image_path


# Power definitions
POWERS = {
    "vision": {
        "name": "👁️ Vision",
        "description": "Révèle en surbrillance les pièces que les survivants n'ont pas encore fouillé depuis l'obtention de la précédente clef",
        "icon": "Vision.mp4",
        "requires_action": False
    },
    "secousse": {
        "name": "↩️ Secousse",
        "description": "Si la clef n'est pas trouvée après le tour des tueurs, alors sa localisation change de pièce",
        "icon": "secousse.mp4",
        "requires_action": False
    },
    "piege": {
        "name": "🥶 Blizzard",
        "description": "Déployez un blizzard dans une pièce par étage, immobilisant pour un tour le joueur survivant qui choisit prochainement cette pièce",
        "icon": "blizzard.mp4",
        "requires_action": True,
        "action_type": "select_rooms_per_floor"  # select one room per floor
    },
    "toxine": {
        "name": "😷 Toxine",
        "description": "Diffusez un gaz toxique dans une pièce sur plusieurs tours, empoisonnant tout aventurier y pénétrant",
        "icon": "Toxine.mp4",
        "requires_action": True,
        "action_type": "select_room"  # select one room
    },
    "traque": {
        "name": "🔊 Traque",
        "description": "Choisissez un niveau (sous-sol, rez-de-chaussée ou étage) et découvrez si des survivants s'y cachent",
        "icon": "Traque.mp4",
        "requires_action": True,
        "action_type": "select_floor"  # select one floor
    },
    "barricade": {
        "name": "🔒 Barricade",
        "description": "Vous permet de verrouiller au choix 2 pièces pour le prochain tour",
        "icon": "Barricade.mp4",
        "requires_action": True,
        "action_type": "select_rooms",  # select 2 rooms
        "rooms_count": 2
    },
    "rage": {
        "name": "😡 Rage",
        "description": "Si vous trouvez un survivant en fouillant une pièce, vous pouvez fouiller une seconde pièce ce tour-ci",
        "icon": "rage.mp4",
        "requires_action": False
    },
    "mimic": {
        "name": "💰 Mimic",
        "description": "Invoquez 4 terribles mimiques pour 1 tour. Elles volent la totalité de l'or des aventuriers qui les croisent au tour suivant.",
        "icon": "Mimic.mp4",
        "requires_action": True,
        "action_type": "select_rooms",  # select 4 rooms
        "rooms_count": 4
    }
}

def get_random_powers(exclude_powers: list = []) -> list:
    """Get 3 random unique powers"""
    available = [p for p in POWERS.keys() if p not in exclude_powers]
    return random.sample(available, min(3, len(available)))

def validate_game_start(game: dict) -> tuple[bool, Optional[str]]:
    """
    Validate if game can start based on player roles and classes.
    Returns: (is_valid, error_message)
    """
    players = game["players"]
    
    # Count players by role
    survivors = [p for p in players.values() if p["role"] == "survivor"]
    killers = [p for p in players.values() if p["role"] == "killer"]
    
    # Check 1: At least 1 survivor
    if len(survivors) < 1:
        return False, "❌ La partie ne peut pas démarrer : il faut au moins 1 survivant."
    
    # Check 2: At least 1 killer
    if len(killers) < 1:
        return False, "❌ La partie ne peut pas démarrer : il faut au moins 1 tueur."
    
    # Check 3: No duplicate classes among survivors
    survivor_classes = []
    for survivor in survivors:
        char_class = survivor.get("character_class")
        if char_class:
            if char_class in survivor_classes:
                return False, f"❌ La partie ne peut pas démarrer : il existe un doublon de classe chez les survivants ({char_class}). Chaque survivant doit avoir une classe unique."
            survivor_classes.append(char_class)
    
    # All checks passed
    return True, None

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
            "message": "🔪 Les tueurs sélectionnent leur pièce"
        })

async def apply_powers(session_id: str):
    """Apply all selected powers"""
    game = game_sessions[session_id]
    game["active_powers"] = {}
    
    floor_names = {
        "basement": "🕳️ Sous-sol",
        "ground_floor": "🏰 Rez-de-chaussée",
        "upper_floor": "🕯️ Étage"
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
            
            event_msg = f"🥶 {player['name']} utilise Blizzard !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
        
        elif power_name == "toxine":
            # Poison selected room for 3 turns
            action_data = selection.get("action_data", {})
            poisoned_room = action_data.get("room")
            
            if poisoned_room and poisoned_room in game["rooms"]:
                game["rooms"][poisoned_room]["poisoned_turns_remaining"] = 3
            
            game["active_powers"][power_name]["data"]["poisoned_room"] = poisoned_room
            
            event_msg = f"😷 {player['name']} utilise Toxine !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
        
        elif power_name == "traque":
            # Get selected floor from action_data
            action_data = selection.get("action_data", {})
            selected_floor = action_data.get("floor")
            
            if selected_floor:
                # Get floor hints for all survivors
                floor_hints = get_survivor_floor_hints(game)
                
                # Check if any survivors are on the selected floor
                if selected_floor in floor_hints:
                    floor_name_fr = floor_names.get(selected_floor, selected_floor)
                    sound_event_msg = f"👂 Vous entendez du bruit {floor_name_fr}... Des survivants sont présents !"
                    game["events"].append({"message": sound_event_msg, "type": "sound_clue", "for_role": "killer"})
                    await broadcast_to_session(session_id, {"type": "event", "message": sound_event_msg}, role_filter="killer")
                else:
                    floor_name_fr = floor_names.get(selected_floor, selected_floor)
                    sound_event_msg = f"🤫 Aucun bruit {floor_name_fr}... Aucun survivant détecté."
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
        
        elif power_name == "rage":
            # Mark that this killer has rage power active for this turn
            game["active_powers"][power_name]["data"][player_id] = {
                "has_second_chance": False,
                "used_second_chance": False
            }
            
            event_msg = f"😡 {player['name']} utilise Rage !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
        
        elif power_name == "mimic":
            # Place mimics in selected rooms for next turn
            action_data = selection.get("action_data", {})
            mimic_rooms = action_data.get("rooms", [])
            
            for room_name in mimic_rooms:
                if room_name in game["rooms"]:
                    game["rooms"][room_name]["has_mimic"] = True
            
            game["active_powers"][power_name]["data"]["mimic_rooms"] = mimic_rooms
            
            event_msg = f"💰 {player['name']} utilise Mimic !"
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
                player_copy["gold"] = 0  # Hide gold from killers
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
            # If sending state_update, filter it based on player's role (only during active game)
            if message.get("type") == "state_update" and player_id in game["players"]:
                # Only filter game state during active gameplay, not in lobby
                if game.get("game_started", False):
                    player_role = game["players"][player_id]["role"]
                    filtered_game = filter_game_state(game, player_role)
                    filtered_message = message.copy()
                    filtered_message["game"] = filtered_game
                    await websocket.send_json(filtered_message)
                else:
                    # In lobby, send unfiltered state so everyone sees all players with is_host property
                    await websocket.send_json(message)
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

    # ============================================
    # PHASE 1: SURVIVORS PLAY FIRST
    # ============================================

    # Move survivors to their selected rooms
    for player_id, action in survivors_actions.items():
        game["players"][player_id]["current_room"] = action["room"]

    # Survivors interact with rooms (medikits, auto-revival)
    # NOTE: Quest handling is now done immediately when survivor selects room (not here)
    for player_id, action in survivors_actions.items():
        player = game["players"][player_id]
        room = game["rooms"][action["room"]]

        # Check for medikit
        if room["has_medikit"]:
            room["has_medikit"] = False
            player["has_medikit"] = True
            event_msg = f"⚗️ {player['name']} a trouvé la potion de résurrection et en est désormais le porteur."
            game["events"].append({"message": event_msg, "type": "medikit_found"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

        # Auto-revive: If survivor has medikit and enters room with eliminated player
        if player["has_medikit"] and room["eliminated_players"]:
            # Revive the first eliminated player in this room
            target_player_id = room["eliminated_players"][0]
            if target_player_id in game["players"] and game["players"][target_player_id]["eliminated"]:
                # Revive the player
                game["players"][target_player_id]["eliminated"] = False
                # Reset poison status when revived
                game["players"][target_player_id]["poisoned_countdown"] = 0
                player["has_medikit"] = False
                room["eliminated_players"].remove(target_player_id)

                event_msg = f"💚 {player['name']} a ranimé {game['players'][target_player_id]['name']} !"
                game["events"].append({"message": event_msg, "type": "revival"})
                await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

                # Respawn the medikit
                new_medikit_room = respawn_medikit(game)
                if new_medikit_room:
                    respawn_msg = "⚗️ La potion de résurrection réapparaît quelque part dans la maison..."
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
    killers_with_rage_second_chance = {}  # {killer_id: True} for killers who get a second chance

    for killer_id, killer_action in killers_actions.items():
        killer = game["players"][killer_id]
        killer_room = killer["current_room"]

        found_survivor = False
        # Check if any survivors are in the same room
        for survivor_id, survivor in game["players"].items():
            if (survivor["role"] == "survivor" and
                not survivor["eliminated"] and
                survivor["current_room"] == killer_room):

                # Eliminate the survivor
                survivor["eliminated"] = True
                survivor["gold"] = 0  # Reset gold when eliminated
                game["rooms"][killer_room]["eliminated_players"].append(survivor_id)
                eliminated_rooms.append(killer_room)
                found_survivor = True

                # Get survivor class for death image
                survivor_class = survivor.get("character_class", "")
                death_image_path = f"/death/{survivor_class}.png" if survivor_class else ""

                event_msg = f"💀 {survivor['name']} a été éliminé dans {killer_room} !"
                game["events"].append({"message": event_msg, "type": "elimination"})
                await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
                
                # Send elimination popup to ALL players with dramatic effect
                elimination_message = f"{killer['name']} a tué {survivor['name']} dans {killer_room}"
                await broadcast_to_session(session_id, {
                    "type": "killer_elimination_popup",
                    "killer_name": killer['name'],
                    "survivor_name": survivor['name'],
                    "room_name": killer_room,
                    "survivor_class": survivor_class,
                    "death_image": death_image_path,
                    "message": elimination_message
                })

                # If survivor had medikit, destroy it and respawn a new one
                if survivor["has_medikit"]:
                    survivor["has_medikit"] = False
                    new_medikit_room = respawn_medikit(game)
                    if new_medikit_room:
                        respawn_msg = "⚗️ La potion de résurrection réapparaît quelque part dans la maison..."
                        game["events"].append({"message": respawn_msg, "type": "medikit_respawn"})
                        await broadcast_to_session(session_id, {"type": "event", "message": respawn_msg})
        
        # Check if this killer has rage power and found a survivor
        if found_survivor and "rage" in game.get("active_powers", {}):
            rage_data = game["active_powers"]["rage"]["data"].get(killer_id)
            if rage_data and not rage_data.get("used_second_chance", False):
                # Grant second chance to this killer
                killers_with_rage_second_chance[killer_id] = True
                rage_data["has_second_chance"] = True
                
                # Notify killer they get a second chance
                if killer_id in active_connections.get(session_id, {}):
                    try:
                        await active_connections[session_id][killer_id].send_json({
                            "type": "rage_second_chance",
                            "message": "😡 Rage activé ! Vous pouvez fouiller une seconde pièce !"
                        })
                    except:
                        pass

    # Lock rooms where eliminations occurred
    for room_name in set(eliminated_rooms):
        game["rooms"][room_name]["locked"] = True
        event_msg = f"⚠️ La pièce {room_name} est condamnée pour ce tour."
        game["events"].append({"message": event_msg, "type": "room_locked"})
        await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
    
    # Check if any killers with rage have second chances
    if killers_with_rage_second_chance:
        # Set up the rage second selection phase
        game["rage_second_chances"] = {}
        for killer_id in killers_with_rage_second_chance.keys():
            game["rage_second_chances"][killer_id] = {
                "can_select": True,
                "room_selected": None
            }
        
        # Change phase to rage second selection
        game["phase"] = "rage_second_selection"
        await broadcast_to_session(session_id, {
            "type": "phase_change",
            "phase": "rage_second_selection",
            "message": "😡 Tueurs en rage - Sélectionnez une seconde pièce !"
        })
        return  # Exit early, will continue after second room selections
    
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
                    event_msg = "↩️ La clef s'est déplacée vers une nouvelle pièce !"
                    game["events"].append({"message": event_msg, "type": "key_relocated"})
                    await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

    # Check victory conditions
    alive_survivors = [p for p in game["players"].values() if p["role"] == "survivor" and not p["eliminated"]]

    # Check if all quests completed but crystal not spawned yet
    if len(game["completed_quests"]) >= len(game["quests"]) and len(alive_survivors) > 0 and not game["crystal_spawned"]:
        # Spawn the crystal for final quest
        crystal_room = place_crystal(game)
        if crystal_room:
            # Send different messages based on role with crystal spawn video
            survivor_msg = "💎 Le cristal est apparu : détruisez-le pour vous échapper d'ici !"
            killer_msg = "💎 Le cristal est apparu : Empêchez-les de le détruire !"

            game["events"].append({"message": survivor_msg, "type": "crystal_spawned", "for_role": "survivor"})
            game["events"].append({"message": killer_msg, "type": "crystal_spawned", "for_role": "killer"})

            # Send crystal spawn video to survivors
            await broadcast_to_session(session_id, {
                "type": "crystal_spawned",
                "message": survivor_msg,
                "video_path": "/event/Cristal_spawn.mp4"
            }, role_filter="survivor")
            
            # Send crystal spawn video to killers
            await broadcast_to_session(session_id, {
                "type": "crystal_spawned",
                "message": killer_msg,
                "video_path": "/event/Cristal_spawn.mp4"
            }, role_filter="killer")
    
    # Victory for survivors: crystal destroyed
    if game.get("crystal_destroyed", False) and len(alive_survivors) > 0:
        game["phase"] = "game_over"
        game["winner"] = "survivors"
        # Victory messages already sent when crystal was destroyed
        return  # Exit early, game is over

    # Victory for killers: all survivors eliminated
    if len(alive_survivors) == 0:
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
        return  # Exit early, game is over

    # Game continues - Handle toxine countdowns before next turn
    # Decrement room poison durations
    for room_name, room_data in game["rooms"].items():
        if room_data.get("poisoned_turns_remaining", 0) > 0:
            room_data["poisoned_turns_remaining"] -= 1
    
    # NOTE: Mimics are NOT cleared here anymore!
    # Like traps, they need to persist until AFTER survivors make their selection in the next turn
    # Mimics will be cleared in the survivor_selection phase after all survivors have selected
    
    # Decrement player poison countdowns and check for elimination
    players_to_eliminate = []
    for player_id, player in game["players"].items():
        if player["role"] == "survivor" and not player["eliminated"]:
            poison_countdown = player.get("poisoned_countdown", 0)
            if poison_countdown > 0:
                player["poisoned_countdown"] -= 1
                
                # Check if player suffocates
                if player["poisoned_countdown"] == 0:
                    players_to_eliminate.append(player_id)
                else:
                    # Send notification to poisoned survivor about remaining turns
                    if player_id in active_connections.get(session_id, {}):
                        try:
                            await active_connections[session_id][player_id].send_json({
                                "type": "poison_countdown",
                                "countdown": player["poisoned_countdown"],
                                "message": f"😷 Vous êtes empoisonné ! Il vous reste {player['poisoned_countdown']} tour(s) avant de suffoquer."
                            })
                        except:
                            pass
    
    # Eliminate poisoned players
    for player_id in players_to_eliminate:
        player = game["players"][player_id]
        player["eliminated"] = True
        player["poisoned_countdown"] = 0
        player["gold"] = 0  # Reset gold when eliminated
        
        event_msg = f"💀 {player['name']} a succombé au poison toxique !"
        game["events"].append({"message": event_msg, "type": "player_eliminated"})
        
        # Get player class from avatar to determine death video
        player_class = get_avatar_class(player.get("avatar", ""))
        video_path = ""
        if player_class:
            # Format: /death/ClassName_toxine.mp4
            video_path = f"/death/{player_class}_toxine.mp4"
        
        # Send toxin death popup to all players with video
        toxin_death_msg = f"{player['name']} a succombé de la toxine !"
        await broadcast_to_session(session_id, {
            "type": "toxin_death_popup",
            "message": toxin_death_msg,
            "video_path": video_path,
            "player_name": player['name']
        })
    
    # Check if all survivors died from toxin (after toxin eliminations)
    alive_survivors_after_toxin = [p for p in game["players"].values() if p["role"] == "survivor" and not p["eliminated"]]
    
    if len(alive_survivors_after_toxin) == 0:
        # Wait for death videos to play (5 seconds) before sending game over messages
        if len(players_to_eliminate) > 0:
            await asyncio.sleep(5)
        
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
        return  # Exit early, game is over
    
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

async def process_rage_second_selections(session_id: str):
    """Process second room selections for killers with rage power"""
    game = game_sessions[session_id]
    
    # Get all second room selections
    for killer_id, rage_data in game["rage_second_chances"].items():
        second_room = rage_data.get("room_selected")
        if not second_room:
            continue
        
        killer = game["players"][killer_id]
        
        # Move killer to second room
        killer["current_room"] = second_room
        
        # Check for eliminations in second room
        eliminated_in_second_room = []
        for survivor_id, survivor in game["players"].items():
            if (survivor["role"] == "survivor" and
                not survivor["eliminated"] and
                survivor["current_room"] == second_room):
                
                # Eliminate the survivor
                survivor["eliminated"] = True
                survivor["gold"] = 0  # Reset gold when eliminated
                game["rooms"][second_room]["eliminated_players"].append(survivor_id)
                eliminated_in_second_room.append(survivor_id)
                
                # Get survivor class for death image
                survivor_class = survivor.get("character_class", "")
                death_image_path = f"/death/{survivor_class}.png" if survivor_class else ""
                
                event_msg = f"💀😡 {survivor['name']} a été éliminé dans {second_room} (Rage) !"
                game["events"].append({"message": event_msg, "type": "elimination"})
                await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
                
                # Send elimination popup to ALL players with dramatic effect
                elimination_message = f"{killer['name']} a tué {survivor['name']} dans {second_room}"
                await broadcast_to_session(session_id, {
                    "type": "killer_elimination_popup",
                    "killer_name": killer['name'],
                    "survivor_name": survivor['name'],
                    "room_name": second_room,
                    "survivor_class": survivor_class,
                    "death_image": death_image_path,
                    "message": elimination_message
                })
                
                # If survivor had medikit, destroy it and respawn a new one
                if survivor["has_medikit"]:
                    survivor["has_medikit"] = False
                    new_medikit_room = respawn_medikit(game)
                    if new_medikit_room:
                        respawn_msg = "⚗️ La potion de résurrection réapparaît quelque part dans la maison..."
                        game["events"].append({"message": respawn_msg, "type": "medikit_respawn"})
                        await broadcast_to_session(session_id, {"type": "event", "message": respawn_msg})
        
        # Lock second room if eliminations occurred
        if eliminated_in_second_room:
            game["rooms"][second_room]["locked"] = True
            event_msg = f"⚠️ La pièce {second_room} est condamnée pour ce tour."
            game["events"].append({"message": event_msg, "type": "room_locked"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
    
    # Clear rage second chances
    game["rage_second_chances"] = {}
    
    # Check victory conditions again
    alive_survivors = [p for p in game["players"].values() if p["role"] == "survivor" and not p["eliminated"]]
    
    # Check if all quests completed but crystal not spawned yet
    if len(game["completed_quests"]) >= len(game["quests"]) and len(alive_survivors) > 0 and not game["crystal_spawned"]:
        # Spawn the crystal for final quest
        crystal_room = place_crystal(game)
        if crystal_room:
            # Send different messages based on role with crystal spawn video
            survivor_msg = "💎 Le cristal est apparu : détruisez-le pour vous échapper d'ici !"
            killer_msg = "💎 Le cristal est apparu : Empêchez-les de le détruire !"

            game["events"].append({"message": survivor_msg, "type": "crystal_spawned", "for_role": "survivor"})
            game["events"].append({"message": killer_msg, "type": "crystal_spawned", "for_role": "killer"})

            # Send crystal spawn video to survivors
            await broadcast_to_session(session_id, {
                "type": "crystal_spawned",
                "message": survivor_msg,
                "video_path": "/event/Cristal_spawn.mp4"
            }, role_filter="survivor")
            
            # Send crystal spawn video to killers
            await broadcast_to_session(session_id, {
                "type": "crystal_spawned",
                "message": killer_msg,
                "video_path": "/event/Cristal_spawn.mp4"
            }, role_filter="killer")
    
    # Victory for survivors: crystal destroyed
    if game.get("crystal_destroyed", False) and len(alive_survivors) > 0:
        game["phase"] = "game_over"
        game["winner"] = "survivors"
        # Victory messages already sent when crystal was destroyed
        return  # Exit early, game is over
    
    # Victory for killers: all survivors eliminated
    if len(alive_survivors) == 0:
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
        return  # Exit early, game is over
    
    # Game continues - Handle toxine countdowns before next turn
    # Decrement room poison durations
    for room_name, room_data in game["rooms"].items():
        if room_data.get("poisoned_turns_remaining", 0) > 0:
            room_data["poisoned_turns_remaining"] -= 1
    
    # NOTE: Mimics are NOT cleared here anymore!
    # Like traps, they need to persist until AFTER survivors make their selection in the next turn
    # Mimics will be cleared in the survivor_selection phase after all survivors have selected
    
    # Decrement player poison countdowns and check for elimination
    players_to_eliminate = []
    for player_id, player in game["players"].items():
        if player["role"] == "survivor" and not player["eliminated"]:
            poison_countdown = player.get("poisoned_countdown", 0)
            if poison_countdown > 0:
                player["poisoned_countdown"] -= 1
                
                # Check if player suffocates
                if player["poisoned_countdown"] == 0:
                    players_to_eliminate.append(player_id)
                else:
                    # Send notification to poisoned survivor about remaining turns
                    if player_id in active_connections.get(session_id, {}):
                        try:
                            await active_connections[session_id][player_id].send_json({
                                "type": "poison_countdown",
                                "countdown": player["poisoned_countdown"],
                                "message": f"😷 Vous êtes empoisonné ! Il vous reste {player['poisoned_countdown']} tour(s) avant de suffoquer."
                            })
                        except:
                            pass
    
    # Eliminate poisoned players
    for player_id in players_to_eliminate:
        player = game["players"][player_id]
        player["eliminated"] = True
        player["poisoned_countdown"] = 0
        player["gold"] = 0  # Reset gold when eliminated
        
        event_msg = f"💀 {player['name']} a succombé au poison toxique !"
        game["events"].append({"message": event_msg, "type": "player_eliminated"})
        
        # Get player class from avatar to determine death video
        player_class = get_avatar_class(player.get("avatar", ""))
        video_path = ""
        if player_class:
            # Format: /death/ClassName_toxine.mp4
            video_path = f"/death/{player_class}_toxine.mp4"
        
        # Send toxin death popup to all players with video
        toxin_death_msg = f"{player['name']} a succombé de la toxine !"
        await broadcast_to_session(session_id, {
            "type": "toxin_death_popup",
            "message": toxin_death_msg,
            "video_path": video_path,
            "player_name": player['name']
        })
    
    # Check if all survivors died from toxin (after toxin eliminations)
    alive_survivors_after_toxin = [p for p in game["players"].values() if p["role"] == "survivor" and not p["eliminated"]]
    
    if len(alive_survivors_after_toxin) == 0:
        # Wait for death videos to play (5 seconds) before sending game over messages
        if len(players_to_eliminate) > 0:
            await asyncio.sleep(5)
        
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
        return  # Exit early, game is over
    
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
    
    # Get character class from avatar
    character_class = get_avatar_class(request.player_avatar)
    
    game["players"][player_id] = {
        "id": player_id,
        "name": request.player_name,
        "avatar": request.player_avatar,
        "character_class": character_class,  # NEW: character class based on avatar
        "is_host": False,
        "eliminated": False,
        "current_room": None,
        "has_medikit": False,
        "role": request.role,  # "survivor" or "killer"
        "immobilized_next_turn": False,  # NEW: for piege power
        "poisoned_countdown": 0,  # NEW: for toxine power (0-10 turns, 0 = not poisoned)
        "gold": 0  # NEW: gold accumulated by survivors
    }

    # Broadcast new player joined
    await broadcast_to_session(matching_session, {
        "type": "player_joined",
        "player": game["players"][player_id]
    })
    
    # FIXED: Also broadcast complete state update to ensure all players see the new player
    await broadcast_to_session(matching_session, {
        "type": "state_update",
        "game": game
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

    # NEW: Handle conspiracy mode - randomly assign roles AND classes
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
        
        # Shuffle available avatars for unique assignment
        available_survivor_avatars = SURVIVOR_AVATARS.copy()
        random.shuffle(available_survivor_avatars)
        
        available_killer_avatars = KILLER_AVATARS.copy()
        
        survivor_index = 0
        killer_index = 0
        
        # Assign roles AND unique classes
        for i, player_id in enumerate(player_ids):
            if i < distribution["survivors"]:
                # Assign survivor role
                game["players"][player_id]["role"] = "survivor"
                
                # Assign unique survivor avatar and class
                if survivor_index < len(available_survivor_avatars):
                    avatar_data = available_survivor_avatars[survivor_index]
                    game["players"][player_id]["avatar"] = avatar_data["path"]
                    game["players"][player_id]["character_class"] = avatar_data["class"]
                    survivor_index += 1
                    logger.info(f"Assigned survivor class {avatar_data['class']} to player {game['players'][player_id]['name']}")
            else:
                # Assign killer role
                game["players"][player_id]["role"] = "killer"
                
                # Assign killer avatar (can be duplicate)
                avatar_data = random.choice(available_killer_avatars)
                game["players"][player_id]["avatar"] = avatar_data["path"]
                game["players"][player_id]["character_class"] = avatar_data["class"]
                killer_index += 1
                logger.info(f"Assigned killer class {avatar_data['class']} to player {game['players'][player_id]['name']}")
        
        logger.info(f"Conspiracy mode: Assigned {distribution['survivors']} survivors and {distribution['killers']} killers with unique survivor classes")

    # Validate game can start (after role assignment in conspiracy mode)
    is_valid, error_message = validate_game_start(game)
    if not is_valid:
        logger.warning(f"Game start validation failed: {error_message}")
        raise HTTPException(status_code=400, detail=error_message)

    # Count survivors (only survivors need to complete quests)
    survivors = [p for p in game["players"].values() if p["role"] == "survivor"]
    game["keys_needed"] = len(survivors)  # Keep for compatibility with frontend display
    game["game_started"] = True
    game["phase"] = "survivor_selection"  # Start with survivors
    game["turn"] = 1

    # Generate quests for all survivors
    game["quests"] = generate_quests(survivors)
    logger.info(f"Generated {len(game['quests'])} quests: {[q['class'] for q in game['quests']]}")

    # Place the FIRST quest at game start
    if game["quests"]:
        first_quest = game["quests"][0]
        first_quest_room = place_quest(game, first_quest["class"])
        if first_quest_room:
            game["active_quest"] = {
                "class": first_quest["class"],
                "room": first_quest_room,
                "player_id": first_quest["player_id"],
                "player_name": first_quest["player_name"]
            }
            logger.info(f"First quest placed for {first_quest['class']} in: {first_quest_room}")

    # Place the FIRST medikit at game start
    medikit_room = respawn_medikit(game)
    logger.info(f"First medikit placed in: {medikit_room}")

    await broadcast_to_session(session_id, {
        "type": "game_started",
        "keys_needed": game["keys_needed"],
        "phase": "survivor_selection",
        "message": "🎮 Le jeu commence ! Les survivants doivent chacun compléter leur quête pour gagner. Tour 1 - Les survivants sélectionnent leur pièce."
    })

    return {"status": "started"}

@api_router.get("/game/{session_id}/state")
async def get_game_state(session_id: str, player_id: Optional[str] = None):
    """Get current game state, filtered by player role if player_id provided"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]

    # If player_id provided, filter state based on role (only during active game, not in lobby)
    if player_id and player_id in game["players"] and game.get("game_started", False):
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
        player["poisoned_countdown"] = 0  # NEW: reset poison
        player["gold"] = 0  # NEW: reset gold
    
    # Reset rooms
    for room_name, room_data in game["rooms"].items():
        room_data["has_key"] = False
        room_data["has_medikit"] = False
        room_data["locked"] = False
        room_data["eliminated_players"] = []
        room_data["trapped"] = False  # NEW: reset traps
        room_data["highlighted"] = False  # NEW: reset highlights
        room_data.pop("trap_triggered", None)  # NEW: remove trap_triggered
        room_data["poisoned_turns_remaining"] = 0  # NEW: reset poison
        room_data["has_mimic"] = False  # NEW: reset mimics
        room_data["has_quest"] = False  # NEW: reset quests
        room_data["quest_class"] = None  # NEW: reset quest class
        room_data["has_crystal"] = False  # NEW: reset crystal
    
    # Reset game state
    game["keys_collected"] = 0
    game["keys_needed"] = 1
    game["game_started"] = False
    game["turn"] = 0
    game["phase"] = "waiting"
    game["events"] = []
    game["pending_actions"] = {}
    game["should_place_next_key"] = False
    game["quests"] = []  # NEW: reset quests
    game["active_quest"] = None  # NEW: reset active quest
    game["completed_quests"] = []  # NEW: reset completed quests
    game["active_powers"] = {}  # NEW: reset powers
    game["pending_power_selections"] = {}  # NEW: reset power selections
    game["rooms_searched_this_key"] = []  # NEW: reset searched rooms
    game["crystal_spawned"] = False  # NEW: reset crystal spawned
    game["crystal_destroyed"] = False  # NEW: reset crystal destroyed
    
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

@api_router.post("/game/{session_id}/update_player")
async def update_player(session_id: str, request: JoinGameRequest, player_id: str = Query(...)):
    """Update player's avatar and role in the lobby"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]
    
    if game["game_started"]:
        raise HTTPException(status_code=400, detail="Cannot update player during game")
    
    if player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")
    
    if request.role not in ["survivor", "killer"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    # Get character class from new avatar
    character_class = get_avatar_class(request.player_avatar)
    
    # FIXED: Preserve is_host status when updating player
    is_host = game["players"][player_id].get("is_host", False)
    
    # Update the player's profile
    game["players"][player_id]["name"] = request.player_name
    game["players"][player_id]["avatar"] = request.player_avatar
    game["players"][player_id]["character_class"] = character_class
    game["players"][player_id]["role"] = request.role
    game["players"][player_id]["is_host"] = is_host  # Preserve host status
    
    logger.info(f"Player {player_id} updated profile in session {session_id}, is_host={is_host}")
    
    # Broadcast player update to all players
    await broadcast_to_session(session_id, {
        "type": "player_updated",
        "player": game["players"][player_id]
    })
    
    # FIXED: Also broadcast complete state update to ensure all players see the updated state
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })
    
    return {"status": "success", "player_id": player_id}

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

    try:
        # Send current game state (filtered by player role only during active game)
        game = game_sessions[session_id]
        if player_id in game["players"]:
            # Only filter during active game, not in lobby
            if game.get("game_started", False):
                player_role = game["players"][player_id]["role"]
                filtered_game = filter_game_state(game, player_role)
                await websocket.send_json({
                    "type": "state_update",
                    "game": filtered_game
                })
            else:
                # In lobby, send unfiltered state
                await websocket.send_json({
                    "type": "state_update",
                    "game": game
                })
                
                # FIXED: Notify all other connected players that someone reconnected
                # This ensures everyone sees the complete player list when someone refreshes or reconnects
                await broadcast_to_session(session_id, {
                    "type": "state_update",
                    "game": game
                })

        while True:
            data = await websocket.receive_json()
            game = game_sessions[session_id]
            player = game["players"][player_id]

            if data["type"] == "select_room":
                room_name = data["room"]
                
                # Check immobilization for survivors FIRST (before phase check)
                if player["role"] == "survivor" and player.get("immobilized_next_turn", False):
                    current_room = player.get("current_room")
                    
                    # If player tries to select a different room, block it
                    if room_name != current_room:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"🥶 Vous êtes immobilisé par un blizzard ! Cliquez sur '{current_room}' pour passer votre tour."
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
                    
                    # LOG: Player room selection (immobilized case)
                    logger.info(f"🎯 {player['name']}, {player['character_class']}, {player['role']} a choisi la pièce '{room_name}' (immobilisé)")
                    
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
                            # All survivors have selected, NOW clear traps and mimics from previous turn
                            for room_name_clear, room_data in game["rooms"].items():
                                room_data["trapped"] = False
                                room_data.pop("trap_triggered", None)
                                room_data["has_mimic"] = False  # Clear mimics after all survivors have selected
                            
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
                                "message": "🎴 Les tueurs choisissent leur pouvoir"
                            })
                    
                    # Broadcast updated state
                    await broadcast_to_session(session_id, {
                        "type": "state_update",
                        "game": game_sessions[session_id]
                    })
                    continue
                
                # Check if it's the player's turn based on their role and current phase (AFTER immobilization check)
                if player["role"] == "survivor" and game["phase"] != "survivor_selection":
                    continue
                if player["role"] == "killer" and game["phase"] not in ["killer_selection", "rage_second_selection"]:
                    continue
                
                # Handle rage second selection differently
                if game["phase"] == "rage_second_selection":
                    # Only killers with rage second chance can select
                    if player_id not in game.get("rage_second_chances", {}):
                        continue
                    
                    if room_name in game["rooms"] and not game["rooms"][room_name]["locked"]:
                        game["rage_second_chances"][player_id]["room_selected"] = room_name
                        game["rage_second_chances"][player_id]["can_select"] = False
                        
                        # LOG: Rage second room selection
                        logger.info(f"😡 {player['name']} a choisi la seconde pièce '{room_name}' (Rage)")
                        
                        # Check if all killers with rage have selected their second room
                        all_selected = all(not data["can_select"] for data in game["rage_second_chances"].values())
                        
                        if all_selected:
                            # Process rage second selections
                            game["phase"] = "processing"
                            await process_rage_second_selections(session_id)
                        
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
                    
                    # LOG: Player room selection
                    logger.info(f"🎯 {player['name']}, {player['character_class']}, {player['role']} a choisi la pièce '{room_name}'")

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
                        
                        # Get player class for video path
                        player_class = player.get("character_class", "Mage").lower()
                        video_path = f"/death/Blizzard_{player_class}.mp4"
                        
                        # NEW: Send trap notification immediately to the survivor with video
                        await websocket.send_json({
                            "type": "trapped_notification",
                            "message": "🥶 C'est un blizzard ! Vous n'avez pas d'autre choix que de vous cacher ce tour-ci.",
                            "video_path": video_path
                        })
                    
                    # Check if survivor enters poisoned room
                    if player["role"] == "survivor" and game["rooms"][room_name].get("poisoned_turns_remaining", 0) > 0:
                        # Only poison if not already poisoned
                        if player.get("poisoned_countdown", 0) == 0:
                            player["poisoned_countdown"] = 10
                            
                            # Send poisoned notification immediately to the survivor
                            await websocket.send_json({
                                "type": "poisoned_notification",
                                "message": "😷 Vous avez été empoisonné par un gaz toxique ! Il vous reste 10 tours avant de suffoquer.",
                                "countdown": 10
                            })
                    
                    # Check for quest immediately when survivor selects room
                    if player["role"] == "survivor":
                        room = game["rooms"][room_name]
                        
                        if room.get("has_quest", False) and room.get("quest_class"):
                            quest_class = room["quest_class"]
                            player_class = player.get("character_class")
                            
                            if player_class == quest_class:
                                # Correct class! Quest completed
                                room["has_quest"] = False
                                room["quest_class"] = None
                                game["completed_quests"].append(quest_class)
                                game["keys_collected"] = len(game["completed_quests"])  # Update for frontend compatibility
                                
                                quests_left = game["keys_needed"] - len(game["completed_quests"])
                                event_msg = f"✅ {player['name']} a complété sa quête ! Il reste {quests_left} quête(s) à compléter."
                                game["events"].append({"message": event_msg, "type": "quest_completed", "for_role": "survivor"})
                                # Notify only survivors about quest completed
                                await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="survivor")
                                
                                # Send video popup to the player who completed the quest
                                try:
                                    video_path = f"/event/{quest_class}.mp4"
                                    await websocket.send_json({
                                        "type": "quest_completed_popup",
                                        "message": f"Vous avez complété votre quête ! Plus que {quests_left} quête(s) pour vous enfuir !",
                                        "video_path": video_path,
                                        "quests_left": quests_left
                                    })
                                except:
                                    pass
                                
                                # Reset rooms searched for Vision power
                                game["rooms_searched_this_key"] = []
                                game["active_quest"] = None

                                # Place next quest if there are more to complete
                                if len(game["completed_quests"]) < len(game["quests"]):
                                    # Find the next quest to place
                                    next_quest_index = len(game["completed_quests"])
                                    next_quest = game["quests"][next_quest_index]
                                    next_quest_room = place_quest(game, next_quest["class"])
                                    if next_quest_room:
                                        game["active_quest"] = {
                                            "class": next_quest["class"],
                                            "room": next_quest_room,
                                            "player_id": next_quest["player_id"],
                                            "player_name": next_quest["player_name"]
                                        }
                                        logger.info(f"Next quest placed for {next_quest['class']} in: {next_quest_room}")
                            else:
                                # Wrong class! Show required class popup
                                try:
                                    required_class_image = f"/requis/{quest_class}-requis.png"
                                    await websocket.send_json({
                                        "type": "wrong_class_popup",
                                        "message": f"Cette quête nécessite la classe {quest_class}.",
                                        "required_class": quest_class,
                                        "required_class_image": required_class_image
                                    })
                                except:
                                    pass
                                
                                # Log that a survivor tried but wrong class - only visible to survivors
                                event_msg = f"🔍 {player['name']} explore {room_name} mais ne peut pas accomplir cette quête."
                                game["events"].append({"message": event_msg, "type": "search_wrong_class", "for_role": "survivor"})
                                await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="survivor")
                        else:
                            # No quest in this room
                            # Log unsuccessful search - only visible to survivors
                            event_msg = f"🔍 {player['name']} fouille {room_name} mais ne trouve rien de particulier."
                            game["events"].append({"message": event_msg, "type": "search_no_quest", "for_role": "survivor"})
                            # Notify only survivors about unsuccessful search
                            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="survivor")
                        
                        # Check for crystal (no class requirement - any survivor can destroy it)
                        if room.get("has_crystal", False) and game.get("crystal_spawned", False):
                            # Survivor found the crystal!
                            room["has_crystal"] = False
                            game["crystal_destroyed"] = True
                            game["phase"] = "game_over"
                            game["winner"] = "survivors"
                            
                            # Get the survivor's class for the appropriate video
                            survivor_class = player.get("character_class", "Guerrier")  # Default to Guerrier if class not found
                            crystal_video = f"/event/Cristal_{survivor_class}.mp4"
                            
                            # Send different messages based on role
                            survivor_msg = "🎉 VICTOIRE ! Le cristal a été détruit ! Vous vous êtes échappés !"
                            killer_msg = "💀 DEFAITE ! Le cristal a été détruit..."
                            
                            game["events"].append({"message": survivor_msg, "type": "game_over", "for_role": "survivor"})
                            game["events"].append({"message": killer_msg, "type": "game_over", "for_role": "killer"})
                            
                            # Send game over to survivors with crystal destroyed video
                            await broadcast_to_session(session_id, {
                                "type": "game_over",
                                "winner": "survivors",
                                "message": survivor_msg,
                                "video_path": crystal_video
                            }, role_filter="survivor")
                            
                            # Send game over to killers with crystal destroyed video
                            await broadcast_to_session(session_id, {
                                "type": "game_over",
                                "winner": "survivors",
                                "message": killer_msg,
                                "video_path": crystal_video
                            }, role_filter="killer")
                    
                    # GOLD SYSTEM: Give gold to survivor if not trapped (blizzard)
                    if player["role"] == "survivor" and not game["rooms"][room_name].get("trap_triggered", False):
                        # Generate gold reward
                        gold_amount, gold_image = generate_gold_reward()
                        player["gold"] += gold_amount
                        
                        # Send personal gold notification to this survivor only
                        try:
                            await websocket.send_json({
                                "type": "gold_found",
                                "message": f"Vous fouillez la pièce et trouvez {gold_amount} pièces d'or !",
                                "gold_amount": gold_amount,
                                "total_gold": player["gold"],
                                "gold_image": gold_image
                            })
                        except:
                            pass
                    
                    # Check if survivor enters room with mimic (AFTER gold is awarded)
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_mimic", False):
                        gold_stolen = player.get("gold", 0)
                        player["gold"] = 0
                        
                        # Clear mimic from room after it triggers
                        game["rooms"][room_name]["has_mimic"] = False
                        
                        # Send mimic notification immediately to the survivor with video
                        await websocket.send_json({
                            "type": "mimic_notification",
                            "message": f"💰 Vous croisez la mimic ! Attirée par votre or, elle vous poursuit ! Vous lachez vos {gold_stolen} pièces d'or pour rester en vie.",
                            "video_path": "/death/Mimic.mp4",
                            "gold_stolen": gold_stolen
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
                            # All survivors have selected, NOW clear traps and mimics from previous turn
                            # This ensures traps and mimics persist for exactly one turn after being set
                            for room_name, room_data in game["rooms"].items():
                                room_data["trapped"] = False
                                room_data.pop("trap_triggered", None)
                                room_data["has_mimic"] = False  # Clear mimics after all survivors have selected
                            
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
                                "message": "🎴 Les tueurs choisissent leur pouvoir"
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
                        # Reset poison status when revived
                        game["players"][target_player_id]["poisoned_countdown"] = 0
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
                            respawn_msg = "🩺 Le medikit réapparaît quelque part dans la maison..."
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

@api_router.get("/avatars")
async def get_avatars():
    """Get all available avatars with their classes"""
    return {
        "survivors": SURVIVOR_AVATARS,
        "killers": KILLER_AVATARS
    }

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