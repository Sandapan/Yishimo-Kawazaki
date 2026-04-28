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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

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
    action: str  # "select_room", "use_medikit", "use_antidote"
    room: Optional[str] = None
    target_player: Optional[str] = None

class ResolveCombatRequest(BaseModel):
    attacker_id: str
    defender_id: str
    result: str  # "attacker_win" or "defender_win"


# Helper functions

# Inventory helpers
def has_item(player: dict, item_type: str) -> bool:
    """Check if player has an item of the specified type in their inventory"""
    inventory = player.get("inventory") or []
    return any(slot is not None and slot.get("type") == item_type for slot in inventory)

def remove_item(player: dict, item_type: str) -> bool:
    """Remove the first occurrence of item_type from inventory. Returns True if removed."""
    inventory = player.get("inventory") or []
    for i, slot in enumerate(inventory):
        if slot is not None and slot.get("type") == item_type:
            inventory[i] = None
            return True
    return False

def add_item(player: dict, item_type: str) -> bool:
    """Add item to the first empty slot. Returns False if inventory is full."""
    inventory = player.get("inventory") or []
    for i, slot in enumerate(inventory):
        if slot is None:
            inventory[i] = {"type": item_type}
            return True
    return False

def is_inventory_full(player: dict) -> bool:
    """Check if all inventory slots are occupied"""
    inventory = player.get("inventory") or []
    return all(slot is not None for slot in inventory)

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
            "has_crystal": False,  # NEW: for crystal system
            "teleportation_trap": False,  # NEW: for teleportation power (entrance trap ➡️🌀)
            "teleportation_exit": False,  # NEW: for teleportation power (exit portal 🌀➡️)
            "teleportation_target_room": None,  # NEW: destination room for teleportation
            "has_merchant": False,  # NEW: for merchant system
            "merchant_discovered": False,  # NOUVEAU: pour afficher l'avatar du marchand aux survivants
            "has_patrol": False,  # NEW: for patrouille power - goblin patrol indicator
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
                "role": host_role,  # "survivor" or "killer"
                "immobilized_next_turn": False,  # NEW: for piege power
                "poisoned_countdown": 0,  # NEW: for toxine power (0-10 turns, 0 = not poisoned)
                "gold": 0,  # NEW: gold accumulated by survivors
                "hp": 36 if host_role == "survivor" else None,  # PV pour les aventuriers (36 au départ)
                "max_hp": 36 if host_role == "survivor" else None,  # NEW: PV max (peut être augmenté par améliorations)
                "initiative_bonus": 0 if host_role == "survivor" else 0,  # NEW: bonus d'initiative individuel
                "damage_bonus": 0 if host_role == "survivor" else 0,  # NEW: bonus de dégâts individuel
                "inventory": [None] * 9 if host_role == "survivor" else None
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
        "pending_events": {},  # NEW: Track players with active event popups
        "survivors_ended_turn": [],  # NEW: list of player_ids that have clicked "Terminer mon tour"
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
        "merchant_placed": False,  # NEW: whether merchant has been placed
        "goliath_active": False,  # NEW: whether Goliath is active
        "goliath_turns_remaining": 0,  # NEW: turns remaining for Goliath
        "goliath_previous_turn_rooms": [],  # NEW: rooms visited by survivors in the previous turn
        "goliath_killed_this_turn": False,  # NEW: whether Goliath has killed a survivor this turn (only one kill per turn)
        "eboulement_active": False,  # NEW: whether Eboulement is active (blocks floor changes for 1 turn)
        "eboulement_locked_floors": {},  # NEW: stores which floor each survivor is locked to during eboulement {player_id: floor}
        "patrouille_patrol": None,  # NEW: {room: str, floor: str, active: bool} - gobelin de patrouille
        "patrol_revealed_survivors": {},  # NEW: {player_id: room_name} - survivants revealed by patrol goblin during this turn
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

def place_merchant(game_state: dict) -> Optional[str]:
    """Place the merchant in a random available room at game start (once per game)"""
    available_rooms = []

    # Get all killer positions
    killer_positions = [p["current_room"] for p in game_state["players"].values()
                       if p["role"] == "killer" and p["current_room"]]

    for room_name, room_data in game_state["rooms"].items():
        # Room is available if: not locked, no quest already, no merchant already, not a killer's position
        if (not room_data["locked"] and
            not room_data.get("has_quest", False) and
            not room_data.get("has_merchant", False) and
            room_name not in killer_positions):
            available_rooms.append(room_name)

    if available_rooms:
        selected_room = random.choice(available_rooms)
        game_state["rooms"][selected_room]["has_merchant"] = True
        game_state["merchant_placed"] = True
        logger.info(f"Merchant placed in room: {selected_room}")
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
        "description": "Révèle en surbrillance les pièces que les aventuriers n'ont pas encore fouillé depuis l'obtention de la précédente clef",
        "icon": "Vision.mp4",
        "requires_action": False
    },
    "secousse": {
        "name": "↩️ Secousse",
        "description": "Si la clef n'est pas trouvée après le tour des orcs, alors sa localisation change de pièce",
        "icon": "secousse.mp4",
        "requires_action": False
    },
    "piege": {
        "name": "🥶 Blizzard",
        "description": "Déployez un blizzard dans une pièce par étage, immobilisant pour un tour l'aventurier qui choisit prochainement cette pièce",
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
        "description": "Choisissez un niveau (sous-sol, rez-de-chaussée ou étage) et découvrez si des aventuriers s'y cachent",
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
        "description": "Si vous trouvez un aventurier en fouillant une pièce, vous pouvez fouiller une seconde pièce ce tour-ci",
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
    },
    "teleportation": {
        "name": "🌀 Piège de Téléportation",
        "description": "Créez un portail qui téléporte n'importe quel joueur d'une pièce à une autre, avant même qu'il puisse la visiter.",
        "icon": "Teleportation.mp4",
        "requires_action": True,
        "action_type": "select_two_rooms"  # select two rooms sequentially
    },
    "goliath": {
        "name": "🕷️ La Goliath",
        "description": "Invoquez la Goliath pour plusieurs tours. Cette araignée géante traque les aventuriers qui revisitent une pièce fouillée au tour précédent.",
        "icon": "La goliath.mp4",
        "requires_action": False
    },
    "eboulement": {
        "name": "⛰️ Eboulement",
        "description": "Bloquez les escaliers et forcez les joueurs à rester dans leur étage durant 1 tour",
        "icon": "Eboulement.mp4",
        "requires_action": False
    },
    "patrouille": {
        "name": "🔍 Patrouille",
        "description": "Placez un gobelin de patrouille dans une pièce. Tant qu'il n'est pas trouvé, il révèle la position des aventuriers présent dans son étage.",
        "icon": "Patrouille.mp4",
        "requires_action": True,
        "action_type": "select_room"  # select one room
    }
}
def get_random_powers(exclude_powers: list = [], game_state: dict = None) -> list:
    """Get 3 random unique powers, excluding goliath if already active"""
    excluded = list(exclude_powers)
    
    # Exclude goliath if already active
    if game_state and game_state.get("goliath_active", False):
        excluded.append("goliath")
    
    available = [p for p in POWERS.keys() if p not in excluded]
    return random.sample(available, min(3, len(available)))

def validate_game_start(game: dict) -> tuple[bool, Optional[str]]:
    """
    Validate if game can start based on player roles and classes.
    Returns: (is_valid, error_message)
    """
    players = game["players"]
    
    # Compter les joueurs par rôle
    survivors = [p for p in players.values() if p["role"] == "survivor"]
    killers = [p for p in players.values() if p["role"] == "killer"]
    
    # Vérif 1 : au moins 1 aventurier
    if len(survivors) < 1:
        return False, "❌ La partie ne peut pas démarrer : il faut au moins 1 aventurier."
    
    # Vérif 2 : au moins 1 orc
    if len(killers) < 1:
        return False, "❌ La partie ne peut pas démarrer : il faut au moins 1 orc."
    
    # Vérif 3 : pas de doublons de classe chez les aventuriers
    survivor_classes = []
    for survivor in survivors:
        char_class = survivor.get("character_class")
        if char_class:
            if char_class in survivor_classes:
                return False, f"❌ La partie ne peut pas démarrer : il existe un doublon de classe chez les aventuriers ({char_class}). Chaque aventurier doit avoir une classe unique."
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
            "message": "🔪 Choisissez une pièce à fouiller",
        "game": game
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
                    sound_event_msg = f"👂 Vous entendez du bruit {floor_name_fr}... Des aventuriers sont présents !"
                    game["events"].append({"message": sound_event_msg, "type": "sound_clue", "for_role": "killer"})
                    await broadcast_to_session(session_id, {"type": "event", "message": sound_event_msg}, role_filter="killer")
                else:
                    floor_name_fr = floor_names.get(selected_floor, selected_floor)
                    sound_event_msg = f"🤫 Aucun bruit {floor_name_fr}... Aucun aventurier détecté."
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
        
        elif power_name == "teleportation":
            # Set teleportation trap (entrance) and exit portal in selected rooms
            action_data = selection.get("action_data", {})
            trap_room = action_data.get("trap_room")
            exit_room = action_data.get("exit_room")
            
            if trap_room and trap_room in game["rooms"] and exit_room and exit_room in game["rooms"]:
                game["rooms"][trap_room]["teleportation_trap"] = True
                game["rooms"][trap_room]["teleportation_target_room"] = exit_room
                game["rooms"][exit_room]["teleportation_exit"] = True
            
            game["active_powers"][power_name]["data"]["trap_room"] = trap_room
            game["active_powers"][power_name]["data"]["exit_room"] = exit_room
            
            event_msg = f"🌀 {player['name']} utilise Piège de Téléportation !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
        
        elif power_name == "goliath":
            # Activate the Goliath for 7-10 turns
            goliath_duration = random.randint(7, 10)
            game["goliath_active"] = True
            game["goliath_turns_remaining"] = goliath_duration
            game["goliath_previous_turn_rooms"] = []  # Will be populated at end of survivor turn
            
            # Log event for killers
            event_msg = f"🕷️ {player['name']} utilise La Goliath !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
            
            # Log event for everyone (appearance)
            goliath_spawn_msg = f"🕷️ La Goliath apparait pour {goliath_duration} tours !"
            game["events"].append({"message": goliath_spawn_msg, "type": "goliath_spawned"})
            await broadcast_to_session(session_id, {"type": "event", "message": goliath_spawn_msg})
            
            # Send popup with video to all survivors
            await broadcast_to_session(session_id, {
                "type": "goliath_spawned",
                "message": "La Goliath est invoquée ! Ne choisissez JAMAIS une pièce que l'un d'entre vous a visité au tour précédent tant qu'elle est présente.",
                "video_path": "/event/Spawn-Goliath.mp4",
                "duration": goliath_duration
            }, role_filter="survivor")
        
        elif power_name == "eboulement":
            # Activate Eboulement for 1 turn (blocks floor changes)
            game["eboulement_active"] = True
            
            # Store the floor each survivor is currently selecting (from pending_actions)
            # This will lock them to this floor on the next turn
            game["eboulement_locked_floors"] = {}
            for survivor_id, action in game.get("pending_actions", {}).items():
                if survivor_id in game["players"] and game["players"][survivor_id]["role"] == "survivor":
                    selected_room = action.get("room")
                    if selected_room and selected_room in game["rooms"]:
                        # Store the floor of the room they're selecting THIS turn
                        game["eboulement_locked_floors"][survivor_id] = game["rooms"][selected_room]["floor"]
            
            # Log event for killers
            event_msg = f"⛰️ {player['name']} utilise Eboulement !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
            
            # Log event for everyone
            eboulement_msg = f"⛰️ Un éboulement bloque les escaliers pour 1 tour !"
            game["events"].append({"message": eboulement_msg, "type": "eboulement_activated"})
            await broadcast_to_session(session_id, {"type": "event", "message": eboulement_msg})
            
            # Send popup with video to all survivors
            await broadcast_to_session(session_id, {
                "type": "eboulement_activated",
                "message": "Un éboulement bloque les escaliers ! Vous ne pouvez pas changer d'étage ce tour-ci.",
                "video_path": "/powers/Eboulement.mp4"
            }, role_filter="survivor")
        
        elif power_name == "patrouille":
            # Place patrol goblin in selected room
            action_data = selection.get("action_data", {})
            patrol_room = action_data.get("room")
            
            if patrol_room and patrol_room in game["rooms"]:
                patrol_floor = game["rooms"][patrol_room]["floor"]
                game["patrouille_patrol"] = {
                    "room": patrol_room,
                    "floor": patrol_floor,
                    "active": True
                }
                
                # Mark room with patrol for killers only
                game["rooms"][patrol_room]["has_patrol"] = True
            
            game["active_powers"][power_name]["data"]["patrol_room"] = patrol_room
            
            event_msg = f"🔍 {player['name']} utilise Patrouille !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

def filter_game_state(game_state: dict, player_role: str, player_id: Optional[str] = None) -> dict:
    """
    Filter game state based on player role for visibility rules:
    - Survivors see: other survivors' positions + eliminated players
    - Killers see: other killers' positions + eliminated players + highlighted rooms (Vision power)
    - pending_actions are filtered to only show actions from same role
    - Blizzard: Players immobilized see all other rooms as locked (red cross)
    - Eboulement: Survivors see rooms on other floors as locked (red cross)
    """
    filtered_state = game_state.copy()
    filtered_state["players"] = {}
    filtered_state["pending_actions"] = {}
    
    # Get current player data if player_id provided
    current_player = None
    if player_id and player_id in game_state["players"]:
        current_player = game_state["players"][player_id]
    
    # Filter rooms based on role
    filtered_state["rooms"] = {}
    for room_name, room_data in game_state["rooms"].items():
        room_copy = room_data.copy()
        
        # BLIZZARD EFFECT: If current player is immobilized, lock all rooms except their current room
        if current_player and current_player.get("immobilized_next_turn", False):
            current_room = current_player.get("current_room")
            if room_name != current_room:
                room_copy["locked"] = True
        
        # EBOULEMENT EFFECT: If eboulement is active and player is survivor, lock rooms on other floors
        if current_player and player_role == "survivor" and game_state.get("eboulement_active", False):
            # Use the stored locked floor (from when eboulement was activated)
            locked_floors = game_state.get("eboulement_locked_floors", {})
            if player_id in locked_floors:
                locked_floor = locked_floors[player_id]
                room_floor = room_data["floor"]
                if locked_floor != room_floor:
                    room_copy["locked"] = True
        
        filtered_state["rooms"][room_name] = room_copy

    for pid, player_data in game_state["players"].items():
        player_copy = player_data.copy()

        if player_role == "survivor":
            # Survivors see all survivors' positions and eliminated players
            if player_data["role"] == "survivor" or player_data["eliminated"]:
                # Filter inventory: only show own inventory
                if pid != player_id:
                    player_copy["inventory"] = None
                filtered_state["players"][pid] = player_copy
            else:
                # Hide killer position (but keep player in list without current_room)
                player_copy["current_room"] = None
                player_copy["inventory"] = None
                filtered_state["players"][pid] = player_copy

        elif player_role == "killer":
            # Killers see other killers' positions and eliminated players
            if player_data["role"] == "killer" or player_data["eliminated"]:
                player_copy["inventory"] = None  # Killers don't have inventory
                filtered_state["players"][pid] = player_copy
            else:
                # Hide survivor position (but keep player in list without current_room)
                player_copy["current_room"] = None
                player_copy["gold"] = 0  # Hide gold from killers
                player_copy["inventory"] = None  # Hide inventory from killers
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
                    filtered_game = filter_game_state(game, player_role, player_id)
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

async def try_advance_to_killer_phase(session_id: str) -> bool:
    """
    Check if the survivor phase should end and transition to the killer phase.
    Conditions:
      - All alive survivors have selected a room
      - All alive survivors have clicked "Terminer mon tour" (end_turn)
      - No pending events (rune popups, trap, mimic, merchant, etc.)
    Returns True if the transition happened, False otherwise.
    """
    game = game_sessions.get(session_id)
    if not game:
        return False

    if game["phase"] != "survivor_selection":
        return False

    alive_survivors = [
        p for p in game["players"].values()
        if p["role"] == "survivor" and not p["eliminated"]
    ]
    survivors_selected = [
        pid for pid in game["pending_actions"].keys()
        if game["players"][pid]["role"] == "survivor"
        and not game["players"][pid]["eliminated"]
    ]
    survivors_ended_turn = [
        pid for pid in game.get("survivors_ended_turn", [])
        if pid in game["players"]
        and game["players"][pid]["role"] == "survivor"
        and not game["players"][pid]["eliminated"]
    ]
    pending_events = game.get("pending_events", {})

    all_selected = len(survivors_selected) == len(alive_survivors)
    all_ended = len(survivors_ended_turn) == len(alive_survivors)
    no_pending = len(pending_events) == 0

    if not (all_selected and all_ended and no_pending):
        return False

    logger.info("All survivors ended their turn - transitioning to killer phase")

    # Broadcast latest state before phase change
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })
    await asyncio.sleep(2)

    # Clear traps and mimics from previous turn
    for room_data in game["rooms"].values():
        room_data["trapped"] = False
        room_data.pop("trap_triggered", None)
        room_data["has_mimic"] = False
        room_data["teleportation_trap"] = False
        room_data["teleportation_exit"] = False
        room_data["teleportation_target_room"] = None

    # GOLIATH: track previous turn rooms
    if game.get("goliath_active", False):
        current_turn_rooms = []
        for pid, action in game["pending_actions"].items():
            if game["players"][pid]["role"] == "survivor":
                room_selected = action.get("room")
                if room_selected and room_selected not in current_turn_rooms:
                    current_turn_rooms.append(room_selected)
        game["goliath_previous_turn_rooms"] = current_turn_rooms

    # Move to killer power selection
    game["phase"] = "killer_power_selection"
    game["pending_power_selections"] = {}

    # EBOULEMENT: clear after survivor phase
    if game.get("eboulement_active", False):
        game["eboulement_active"] = False
        game["eboulement_locked_floors"] = {}
        eboulement_clear_msg = "⛰️ Les escaliers sont de nouveau accessibles !"
        game["events"].append({"message": eboulement_clear_msg, "type": "eboulement_cleared"})
        await broadcast_to_session(session_id, {"type": "event", "message": eboulement_clear_msg})

    # Assign random powers to alive killers
    alive_killers = [
        p for p in game["players"].values()
        if p["role"] == "killer" and not p["eliminated"]
    ]
    for killer in alive_killers:
        killer_id = killer["id"]
        power_options = get_random_powers(game_state=game)
        game["pending_power_selections"][killer_id] = {
            "options": power_options,
            "selected_power": None,
            "action_data": None,
            "action_complete": False
        }

    await broadcast_to_session(session_id, {
        "type": "phase_change",
        "phase": "killer_power_selection",
        "message": "🎴 Les orcs choisissent leur pouvoir",
        "game": game
    })

    return True

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
            add_item(player, "medikit")
            event_msg = f"⚗️ {player['name']} a trouvé la potion de résurrection et en est désormais le porteur."
            game["events"].append({"message": event_msg, "type": "medikit_found"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

        # Auto-revive: If survivor has medikit and enters room with eliminated player
        if has_item(player, "medikit") and room["eliminated_players"]:
            # Revive the first eliminated player in this room
            target_player_id = room["eliminated_players"][0]
            if target_player_id in game["players"] and game["players"][target_player_id]["eliminated"]:
                # Revive the player
                game["players"][target_player_id]["eliminated"] = False
                # Reset poison status when revived
                game["players"][target_player_id]["poisoned_countdown"] = 0
                remove_item(player, "medikit")
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
        # Check for killer-survivor encounters
    for killer_id, killer_action in killers_actions.items():
        killer = game["players"][killer_id]
        killer_room = killer_action.get("room")

        if not killer_room:
            continue

        # Find survivors in the same room
        for survivor_id, survivor_action in survivors_actions.items():
            survivor = game["players"][survivor_id]
            survivor_room = survivor_action.get("room")

            if survivor_room == killer_room and not survivor["eliminated"]:
                # ✅ NOUVEAU : Déclencher un combat de groupe (plusieurs survivants vs gobelins)
                # Trouver TOUS les survivants dans cette pièce
                survivors_in_room = []
                for surv_id, surv_action in game["pending_actions"].items():
                    if surv_id in game["players"]:
                        surv_player = game["players"][surv_id]
                        if (surv_player["role"] == "survivor" and 
                            not surv_player["eliminated"] and
                            surv_action.get("room") == killer_room):
                            survivors_in_room.append({
                                "id": surv_id,
                                "name": surv_player["name"],
                                "class": surv_player.get("character_class", "Survivor"),
                                "hp": surv_player.get("hp", 36),
                                "max_hp": surv_player.get("max_hp", 36),  # NEW: pour la barre de vie
                                "initiative_bonus": surv_player.get("initiative_bonus", 0),  # NEW: bonus initiative
                                "damage_bonus": surv_player.get("damage_bonus", 0),  # NEW: bonus dégâts
                                "avatar": surv_player.get("avatar", "")
                            })

                if survivors_in_room:
                    # Créer un événement de combat multi-joueurs
                    # Pour l'instant : N survivants vs 1 gobelin (hardcodé)
                    num_goblins = 1  # TODO: rendre ce paramètre variable plus tard
                    
                    combat_event = {
                        "type": "multiplayer_combat",
                        "attacker_id": killer_id,
                        "attacker_class": killer.get("character_class", "Orc"),
                        "attacker_name": killer.get("name", "Orc"),
                        "survivors": survivors_in_room,  # Liste des survivants
                        "num_goblins": num_goblins,
                        "goblin_hp": 6,  # HP par gobelin
                        "turn": game["turn"],  # NOUVEAU : numéro du tour pour seed unique
                        "combat_id": f"{killer_id}_{killer_room}_{game['turn']}"  # NOUVEAU : ID unique du combat
                    }

                    # Ajouter l'event au killer ET à tous les survivants
                    game["pending_events"][killer_id] = combat_event
                    for survivor in survivors_in_room:
                        game["pending_events"][survivor["id"]] = combat_event

                    survivor_names = ", ".join([s["name"] for s in survivors_in_room])
                    logger.info(f"⚔️ Combat multi-joueurs déclenché : {survivor_names} VS {num_goblins} Gobelin(s) dans {killer_room}")
                    
                    found_survivor = True
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
            "message": "😡 Orcs en rage - Sélectionnez une seconde pièce !",
        "game": game
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

    # Victoire pour les orcs : tous les aventuriers éliminés
    if len(alive_survivors) == 0:
        game["phase"] = "game_over"
        game["winner"] = "killers"

        # Send different messages based on role
        survivor_msg = "🎉 DEFAITE ! Tous les aventuriers ont été éliminés..."
        killer_msg = "💀 VICTOIRE ! Tous les aventuriers ont été éliminés ..."

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
        survivor_msg = "🎉 DEFAITE ! Tous les aventuriers ont été éliminés..."
        killer_msg = "💀 VICTOIRE ! Tous les aventuriers ont été éliminés ..."
        
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
    game["pending_events"] = {}
    game["survivors_ended_turn"] = []  # Reset end-turn flag for new turn
    # Clear active powers
    game["active_powers"] = {}
    game["pending_power_selections"] = {}
    
    # GOLIATH: Reset kill flag for new turn
    game["goliath_killed_this_turn"] = False
    
    # PATROUILLE: Reset revealed survivors - reveal is only valid for the turn when detected
    game["patrol_revealed_survivors"] = {}
    
    # GOLIATH: Decrement turns remaining and check for expiration
    if game.get("goliath_active", False):
        game["goliath_turns_remaining"] -= 1
        
        if game["goliath_turns_remaining"] <= 0:
            # Goliath disappears
            game["goliath_active"] = False
            game["goliath_turns_remaining"] = 0
            game["goliath_previous_turn_rooms"] = []
            
            goliath_end_msg = "🕷️ La Goliath disparait !"
            game["events"].append({"message": goliath_end_msg, "type": "goliath_disappeared"})
            await broadcast_to_session(session_id, {"type": "event", "message": goliath_end_msg})
        else:
            # Goliath still active, notify remaining turns
            turns_left = game["goliath_turns_remaining"]
            goliath_status_msg = f"🕷️ La Goliath  {turns_left} tour(s)."
            game["events"].append({"message": goliath_status_msg, "type": "goliath_status"})
            await broadcast_to_session(session_id, {"type": "event", "message": goliath_status_msg})
    
    # EBOULEMENT: Do NOT clear here - it should remain active for the next survivor selection phase
    # It will be cleared when entering killer_power_selection phase of the next turn
    
    await broadcast_to_session(session_id, {
        "type": "new_turn",
        "turn": game["turn"],
        "phase": "survivor_selection",
        "message": f"🔄 Tour {game['turn']} - Les aventuriers sélectionnent leur pièce",
        "game": game
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
                if has_item(survivor, "medikit"):
                    remove_item(survivor, "medikit")
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
    
    # Victoire pour les orcs : tous les aventuriers éliminés
    if len(alive_survivors) == 0:
        game["phase"] = "game_over"
        game["winner"] = "killers"
        
        # Send different messages based on role
        survivor_msg = "🎉 DEFAITE ! Tous les aventuriers ont été éliminés..."
        killer_msg = "💀 VICTOIRE ! Tous les aventuriers ont été éliminés ..."
        
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
        survivor_msg = "🎉 DEFAITE ! Tous les aventuriers ont été éliminés..."
        killer_msg = "💀 VICTOIRE ! Tous les aventuriers ont été éliminés ..."
        
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
    game["pending_events"] = {}
    game["survivors_ended_turn"] = []  # Reset end-turn flag for new turn
    # Clear active powers
    game["active_powers"] = {}
    game["pending_power_selections"] = {}
    
    # GOLIATH: Reset kill flag for new turn
    game["goliath_killed_this_turn"] = False
    
    # PATROUILLE: Reset revealed survivors - reveal is only valid for the turn when detected
    game["patrol_revealed_survivors"] = {}
    
    # GOLIATH: Decrement turns remaining and check for expiration
    if game.get("goliath_active", False):
        game["goliath_turns_remaining"] -= 1
        
        if game["goliath_turns_remaining"] <= 0:
            # Goliath disappears
            game["goliath_active"] = False
            game["goliath_turns_remaining"] = 0
            game["goliath_previous_turn_rooms"] = []
            
            goliath_end_msg = "🕷️ La Goliath disparait !"
            game["events"].append({"message": goliath_end_msg, "type": "goliath_disappeared"})
            await broadcast_to_session(session_id, {"type": "event", "message": goliath_end_msg})
        else:
            # Goliath still active, notify remaining turns
            turns_left = game["goliath_turns_remaining"]
            goliath_status_msg = f"🕷️ La Goliath rôde encore pour {turns_left} tour(s)..."
            game["events"].append({"message": goliath_status_msg, "type": "goliath_status"})
            await broadcast_to_session(session_id, {"type": "event", "message": goliath_status_msg})
    
    await broadcast_to_session(session_id, {
        "type": "new_turn",
        "turn": game["turn"],
        "phase": "survivor_selection",
        "message": f"🔄 Tour {game['turn']} - Les aventuriers sélectionnent leur pièce",
        "game": game
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
        "role": request.role,  # "survivor" or "killer"
        "immobilized_next_turn": False,  # NEW: for piege power
        "poisoned_countdown": 0,  # NEW: for toxine power (0-10 turns, 0 = not poisoned)
        "gold": 0,  # NEW: gold accumulated by survivors
        "hp": 36 if request.role == "survivor" else None,  # PV pour les aventuriers (36 au départ)
        "max_hp": 36 if request.role == "survivor" else None,  # NEW: PV max (peut être augmenté par améliorations)
        "initiative_bonus": 0,  # NEW: bonus d'initiative individuel
        "damage_bonus": 0,  # NEW: bonus de dégâts individuel
        "inventory": [None] * 9 if request.role == "survivor" else None
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
                # Assigner le rôle aventurier
                game["players"][player_id]["role"] = "survivor"
                
                # Assigner un avatar aventurier unique
                if survivor_index < len(available_survivor_avatars):
                    avatar_data = available_survivor_avatars[survivor_index]
                    survivor_index += 1
                else:
                    avatar_data = random.choice(SURVIVOR_AVATARS)

                game["players"][player_id]["avatar"] = avatar_data["path"]
                game["players"][player_id]["character_class"] = avatar_data["class"]
                game["players"][player_id]["hp"] = 36  # PV pour les aventuriers
                game["players"][player_id]["max_hp"] = 36  # NEW: PV max
                game["players"][player_id]["initiative_bonus"] = 0  # NEW: reset bonus initiative
                game["players"][player_id]["damage_bonus"] = 0  # NEW: reset bonus dégâts
                game["players"][player_id]["inventory"] = [None] * 9
                logger.info(f"Assigned survivor class {avatar_data['class']} to player {game['players'][player_id]['name']}")
            else:
                # Assigner le rôle orc
                game["players"][player_id]["role"] = "killer"
                
                # Assigner un avatar orc (doublons possibles)
                avatar_data = random.choice(available_killer_avatars)
                game["players"][player_id]["avatar"] = avatar_data["path"]
                game["players"][player_id]["character_class"] = avatar_data["class"]
                game["players"][player_id]["hp"] = None  # Les orcs n'ont pas de PV
                game["players"][player_id]["max_hp"] = None  # NEW
                game["players"][player_id]["initiative_bonus"] = 0  # NEW
                game["players"][player_id]["damage_bonus"] = 0  # NEW
                game["players"][player_id]["inventory"] = None
                logger.info(f"Assigned killer class {avatar_data['class']} to player {game['players'][player_id]['name']}")
        
        logger.info(f"Conspiracy mode: Assigned {distribution['survivors']} aventuriers et orcs avec classes aventurier uniques")

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
    game["survivors_ended_turn"] = []  # Reset end-turn flag for new turn
    
    # GOLIATH: Initialize kill flag for the game
    game["goliath_killed_this_turn"] = False

    # Generate quests for all survivors
    game["quests"] = generate_quests(survivors)
    logger.info(f"Generated {len(game['quests'])} quests: {[q['class'] for q in game['quests']]}")

    # Place ALL quests at game start
    if game["quests"]:
        for quest in game["quests"]:
            quest_room = place_quest(game, quest["class"])
            if quest_room:
                logger.info(f"Quest placed for {quest['class']} in: {quest_room}")
            else:
                logger.warning(f"Could not place quest for {quest['class']} - no available rooms")
        
        # Set active_quest to None since all quests are now placed
        game["active_quest"] = None

    # Place the FIRST medikit at game start
    medikit_room = respawn_medikit(game)
    logger.info(f"First medikit placed in: {medikit_room}")

    # Place the merchant at game start (once per game)
    merchant_room = place_merchant(game)
    if merchant_room:
        logger.info(f"Merchant placed in: {merchant_room}")
    else:
        logger.warning("Could not place merchant - no available rooms")

    await broadcast_to_session(session_id, {
        "type": "game_started",
        "keys_needed": game["keys_needed"],
        "phase": "survivor_selection",
        "message": "🎮 Le jeu commence ! Les aventuriers doivent chacun compléter leur quête pour gagner. Tour 1 - Les aventuriers sélectionnent leur pièce."
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
        return filter_game_state(game, player_role, player_id)

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
        # FIXED: Preserve is_host status during reset
        is_host = player.get("is_host", False)
        
        player["eliminated"] = False
        player["current_room"] = None
        player["immobilized_next_turn"] = False
        player["poisoned_countdown"] = 0
        player["gold"] = 0
        # Réinitialiser les PV des survivants à 36
        player["hp"] = 36 if player.get("role") == "survivor" else None
        player["max_hp"] = 36 if player.get("role") == "survivor" else None  # NEW: reset max_hp
        player["initiative_bonus"] = 0  # NEW: reset bonus initiative
        player["damage_bonus"] = 0  # NEW: reset bonus dégâts
        player["inventory"] = [None] * 9 if player.get("role") == "survivor" else None
        
        # FIXED: Ensure is_host is preserved
        player["is_host"] = is_host
        
        logger.info(f"Reset player {player['name']} (id={player_id}), is_host={is_host}, hp={player.get('hp')}")
    
    # Reset rooms
    for room_name, room_data in game["rooms"].items():
        room_data["has_key"] = False
        room_data["has_medikit"] = False
        room_data["locked"] = False
        room_data["eliminated_players"] = []
        room_data["trapped"] = False
        room_data["highlighted"] = False
        room_data.pop("trap_triggered", None)
        room_data["poisoned_turns_remaining"] = 0
        room_data["has_mimic"] = False
        room_data["has_quest"] = False
        room_data["quest_class"] = None
        room_data["has_crystal"] = False
        room_data["teleportation_trap"] = False
        room_data["teleportation_exit"] = False
        room_data["teleportation_target_room"] = None
        room_data["has_merchant"] = False
    
    # Reset game state
    game["keys_collected"] = 0
    game["keys_needed"] = 1
    game["game_started"] = False
    game["turn"] = 0
    game["phase"] = "waiting"
    game["events"] = []
    game["pending_actions"] = {}
    game["should_place_next_key"] = False
    game["quests"] = []
    game["active_quest"] = None
    game["completed_quests"] = []
    game["active_powers"] = {}
    game["pending_power_selections"] = {}
    game["rooms_searched_this_key"] = []
    game["crystal_spawned"] = False
    game["crystal_destroyed"] = False
    game["merchant_placed"] = False
    game["goliath_active"] = False
    game["goliath_turns_remaining"] = 0
    game["goliath_previous_turn_rooms"] = []
    game["goliath_killed_this_turn"] = False
    game["eboulement_active"] = False
    game["eboulement_locked_floors"] = {}
    game["patrouille_patrol"] = None
    game["patrol_revealed_survivors"] = {}
    
    logger.info(f"Game reset for session: {session_id}")
    
    # Build a clean players list for the frontend to re-sync
    players_list = []
    for pid, pdata in game["players"].items():
        players_list.append({
            "id": pid,
            "name": pdata.get("name", ""),
            "is_host": pdata.get("is_host", False),
            "role": pdata.get("role", "survivor"),
            "class": pdata.get("class", ""),
            "avatar": pdata.get("avatar", ""),
            "eliminated": False
        })
    
    # Broadcast game reset WITH full player data so all clients re-sync
    await broadcast_to_session(session_id, {
        "type": "game_reset",
        "message": "La partie est terminée. Prêts pour une revanche ?",
        "session_id": session_id,
        "players": players_list
    })
    
    # Send updated state to all players so they see the correct lobby state
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })
    
    return {"status": "reset", "session_id": session_id, "players": players_list}

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
     # Mettre à jour les PV selon le rôle (36 pour survivants, None pour orcs)
    game["players"][player_id]["hp"] = 36 if request.role == "survivor" else None
    game["players"][player_id]["max_hp"] = 36 if request.role == "survivor" else None  # NEW
    game["players"][player_id]["initiative_bonus"] = 0  # NEW
    game["players"][player_id]["damage_bonus"] = 0  # NEW
    game["players"][player_id]["inventory"] = [None] * 9 if request.role == "survivor" else None
    
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

@api_router.post("/shop/buy_item")
async def buy_item(session_id: str = Query(...), player_id: str = Query(...), item_name: str = Query(...)):
    """Buy an item from the merchant's shop"""
    logger.info(f"Buy item request: session={session_id}, player={player_id}, item={item_name}")
    
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    game = game_sessions[session_id]
    
    if player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")
    
    player = game["players"][player_id]
    
    # Only survivors can buy items
    if player["role"] != "survivor":
        raise HTTPException(status_code=400, detail="Only survivors can buy items")
    
    # Define items and their prices
    items = {
        "resurrection_potion": {
            "price": 1000,
            "item_type": "medikit",
            "name": "Potion de résurrection"
        },
        "antidote": {
            "price": 300,
            "item_type": "antidote",
            "name": "Antidote"
        }
    }
    
    if item_name not in items:
        raise HTTPException(status_code=400, detail="Invalid item name")
    
    item = items[item_name]
    
    # Check if player already has this item
    if has_item(player, item["item_type"]):
        raise HTTPException(status_code=400, detail=f"Vous possédez déjà {item['name']}")
    
    # Check if player has enough gold
    if player.get("gold", 0) < item["price"]:
        raise HTTPException(status_code=400, detail="Pas assez d'or")
    
    # Check if inventory is full
    if is_inventory_full(player):
        raise HTTPException(status_code=400, detail="Inventaire plein")
    
    # Deduct gold
    player["gold"] -= item["price"]
    
    # Special handling for antidote - auto-consume if poisoned
    if item_name == "antidote":
        if player.get("poisoned_countdown", 0) > 0:
            # Player is poisoned - consume antidote immediately
            player["poisoned_countdown"] = 0
            logger.info(f"Player {player_id} bought antidote and was cured of poison immediately")
            
            # Broadcast cure notification to all players
            await broadcast_to_session(session_id, {
                "type": "antidote_used",
                "message": f"💊 {player['name']} utilise un antidote et est guéri du poison !"
            })
            
            # Broadcast state update so UI reflects cure
            await broadcast_to_session(session_id, {
                "type": "state_update",
                "game": game
            })
            
            return {"status": "success", "message": f"{item['name']} acheté et utilisé immédiatement !"}
        else:
            # Player is not poisoned - give antidote for future use
            add_item(player, item["item_type"])
            logger.info(f"Player {player_id} bought antidote for future use")
    else:
        # For other items (resurrection potion), just add to inventory
        add_item(player, item["item_type"])
        logger.info(f"Player {player_id} bought {item_name}")
    
    # Broadcast state update
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })
    
    return {"status": "success", "message": f"{item['name']} acheté !"}

# Inventory system endpoints
class PickupRuneRequest(BaseModel):
    player_id: str
    rune_type: str

class DismissRuneRequest(BaseModel):
    player_id: str

class UseItemRequest(BaseModel):
    player_id: str
    slot_index: int

@api_router.post("/game/{session_id}/pickup_rune")
async def pickup_rune(session_id: str, request: PickupRuneRequest):
    """Add rune to player's inventory, or refuse if full"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    game = game_sessions[session_id]
    
    if request.player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")
    
    player = game["players"][request.player_id]
    
    if player["role"] != "survivor":
        raise HTTPException(status_code=400, detail="Only survivors can pickup runes")
    
    # Check if there's a pending rune event
    if request.player_id not in game["pending_events"]:
        raise HTTPException(status_code=400, detail="No rune to pickup")
    
    event = game["pending_events"][request.player_id]
    if not isinstance(event, dict) or event.get("type") != "rune_found":
        raise HTTPException(status_code=400, detail="No rune to pickup")
    
    # Check if inventory is full
    if is_inventory_full(player):
        raise HTTPException(status_code=400, detail="Inventaire plein")
    
    # Add rune to inventory
    if not add_item(player, request.rune_type):
        raise HTTPException(status_code=400, detail="Impossible d'ajouter la rune")
    
    # Remove pending event
    del game["pending_events"][request.player_id]
    
    # Broadcast state update
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })
    
    logger.info(f"Player {request.player_id} picked up rune: {request.rune_type}")
    
    return {"status": "success", "message": "Rune ramassée !"}

@api_router.post("/game/{session_id}/dismiss_rune")
async def dismiss_rune(session_id: str, request: DismissRuneRequest):
    """Dismiss/ignore the found rune"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    game = game_sessions[session_id]
    
    if request.player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")
    
    # Remove pending event if exists
    if request.player_id in game["pending_events"]:
        del game["pending_events"][request.player_id]
    
    # Broadcast state update so the popup disappears
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })
    
    logger.info(f"Player {request.player_id} dismissed rune")
    
    return {"status": "success", "message": "Rune ignorée"}

@api_router.post("/game/{session_id}/use_item")
async def use_item(session_id: str, request: UseItemRequest):
    """Use item from inventory slot (medikit/antidote)"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    game = game_sessions[session_id]
    
    if request.player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")
    
    player = game["players"][request.player_id]
    
    if player["role"] != "survivor":
        raise HTTPException(status_code=400, detail="Only survivors can use items")
    
    # Get inventory
    inventory = player.get("inventory") or []
    
    if request.slot_index < 0 or request.slot_index >= len(inventory):
        raise HTTPException(status_code=400, detail="Invalid slot index")
    
    item = inventory[request.slot_index]
    
    if item is None:
        raise HTTPException(status_code=400, detail="Slot is empty")
    
    item_type = item.get("type")
    
    # Handle medikit usage
    if item_type == "medikit":
        # TODO: For now, just consume the item. Revival logic should be handled separately
        inventory[request.slot_index] = None
        logger.info(f"Player {request.player_id} used medikit from slot {request.slot_index}")
        
        # Broadcast state update
        await broadcast_to_session(session_id, {
            "type": "state_update",
            "game": game
        })
        
        return {"status": "success", "message": "Médikit utilisé !"}
    
    # Handle antidote usage
    elif item_type == "antidote":
        if player.get("poisoned_countdown", 0) <= 0:
            raise HTTPException(status_code=400, detail="Vous n'êtes pas empoisonné !")
        
        player["poisoned_countdown"] = 0
        inventory[request.slot_index] = None
        
        event_msg = f"💊 {player['name']} utilise un antidote et est guéri du poison !"
        game["events"].append({"message": event_msg, "type": "antidote_used"})
        
        # Broadcast event
        await broadcast_to_session(session_id, {
            "type": "antidote_used",
            "message": event_msg
        })
        
        # Broadcast state update
        await broadcast_to_session(session_id, {
            "type": "state_update",
            "game": game
        })
        
        logger.info(f"Player {request.player_id} used antidote from slot {request.slot_index}")
        
        return {"status": "success", "message": "Antidote utilisé !"}
    
    else:
        raise HTTPException(status_code=400, detail="Cet item ne peut pas être utilisé directement")

# Combat resolution models
class CombatLogUpdate(BaseModel):
    attacker_id: str
    defender_id: str
    log_entry: str

class CombatResultRequest(BaseModel):
    attacker_id: str
    defender_id: str
    result: str  # "defender_win" or "attacker_win"
    damage_dealt: int = 0
    combat_log: List[str] = []

@api_router.post("/game/{session_id}/combat_log")
async def send_combat_log(session_id: str, request: CombatLogUpdate):
    """Send a combat log entry to the attacker (orc) in real-time"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    game = game_sessions[session_id]
    attacker_id = request.attacker_id
    
    # Send log entry to the attacker via WebSocket
    if session_id in active_connections and attacker_id in active_connections[session_id]:
        try:
            await active_connections[session_id][attacker_id].send_json({
                "type": "combat_log_update",
                "log_entry": request.log_entry,
                "attacker_id": request.attacker_id,
                "defender_id": request.defender_id
            })
        except Exception as e:
            logger.error(f"Failed to send combat log to attacker: {e}")
    
    return {"status": "success"}

# Modèle pour la résolution de combat multi-joueurs
class MultiPlayerCombatResultRequest(BaseModel):
    attacker_id: str  # Le killer
    survivors_results: List[dict]  # [{id, damage_dealt, eliminated}, ...]
    goblins_defeated: int  # Nombre de gobelins vaincus
    combat_log: List[str] = []

@api_router.post("/game/{session_id}/resolve_combat")
async def resolve_combat(session_id: str, request: CombatResultRequest):
    """Resolve a combat between an orc and a survivor"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    game = game_sessions[session_id]
    attacker_id = request.attacker_id
    defender_id = request.defender_id
    result = request.result
    
    logger.info(f"⚔️ Résolution combat: attacker={attacker_id}, defender={defender_id}, result={result}, damage_dealt={request.damage_dealt}")
    
    # Get player info
    attacker = game["players"].get(attacker_id)
    defender = game["players"].get(defender_id)
    
    if not attacker or not defender:
        raise HTTPException(status_code=404, detail="Player not found")
 
     # Mettre à jour les PV du survivant (défenseur) - les dégâts subis pendant le combat
    if defender.get("hp") is not None and request.damage_dealt > 0:
        defender["hp"] = max(0, defender["hp"] - request.damage_dealt)
        logger.info(f"❤️ PV de {defender['name']} mis à jour: {defender['hp']} (dégâts subis: {request.damage_dealt})")
   
    # Handle combat result
    if result == "attacker_win":
        # Orc wins - survivor is eliminated (PV à 0)
        defender["eliminated"] = True
        defender["hp"] = 0  # Assurer que les PV sont à 0
        defender["gold"] = 0
        defender_room = defender.get("current_room")
        if defender_room and defender_room in game["rooms"]:
            game["rooms"][defender_room]["eliminated_players"].append(defender_id)
        
        # Log event
        event_msg = f"💀 {defender['name']} a été vaincu par {attacker['name']} !"
        game["events"].append({"message": event_msg, "type": "combat_elimination"})
        await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
    else:
        # Survivor wins - on vérifie si ses PV sont à 0 (il devrait être éliminé)
        if defender.get("hp") is not None and defender["hp"] <= 0:
            defender["eliminated"] = True
            defender["gold"] = 0
            defender_room = defender.get("current_room")
            if defender_room and defender_room in game["rooms"]:
                game["rooms"][defender_room]["eliminated_players"].append(defender_id)

            event_msg = f"💀 {defender['name']} a succombé à ses blessures après le combat !"
            game["events"].append({"message": event_msg, "type": "combat_elimination"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

            
        else:
            # Survivor wins and still has HP       
            event_msg = f"⚔️ {defender['name']} a repoussé l'attaque de {attacker['name']} !"
            game["events"].append({"message": event_msg, "type": "combat_survived"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
    
    # Send combat result to the attacker (orc) so they can close the modal
    if session_id in active_connections and attacker_id in active_connections[session_id]:
        try:
            await active_connections[session_id][attacker_id].send_json({
                "type": "combat_result",
                "result": result,
                "winner": "attacker" if result == "attacker_win" else "defender",
                "attacker_name": attacker["name"],
                "defender_name": defender["name"],
                "combat_log": request.combat_log,
                "attacker_id": attacker_id,
                "defender_id": defender_id
            })
        except Exception as e:
            logger.error(f"Failed to send combat result to attacker: {e}")
    
    # Clear pending events for both players
    if defender_id in game.get("pending_events", {}):
        del game["pending_events"][defender_id]
    if attacker_id in game.get("pending_events", {}):
        del game["pending_events"][attacker_id]
    
    # Broadcast updated state
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })
    
    # Check victory conditions after combat
    alive_survivors = [p for p in game["players"].values() if p["role"] == "survivor" and not p["eliminated"]]
    
    if len(alive_survivors) == 0:
        game["phase"] = "game_over"
        game["winner"] = "killers"
        
        survivor_msg = "💀 DÉFAITE ! Tous les aventuriers ont été éliminés..."
        killer_msg = "🎉 VICTOIRE ! Tous les aventuriers ont été éliminés !"
        
        game["events"].append({"message": survivor_msg, "type": "game_over", "for_role": "survivor"})
        game["events"].append({"message": killer_msg, "type": "game_over", "for_role": "killer"})
        
        await broadcast_to_session(session_id, {"type": "game_over", "winner": "killers", "message": survivor_msg}, role_filter="survivor")
        await broadcast_to_session(session_id, {"type": "game_over", "winner": "killers", "message": killer_msg}, role_filter="killer")
    
    return {"status": "success", "result": result}

@api_router.post("/game/{session_id}/resolve_multiplayer_combat")
async def resolve_multiplayer_combat(session_id: str, request: MultiPlayerCombatResultRequest):
    """Resolve a multiplayer combat between multiple survivors and goblins"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    game = game_sessions[session_id]
    attacker_id = request.attacker_id
    
    logger.info(f"⚔️ Résolution combat multi-joueurs: attacker={attacker_id}, survivors={len(request.survivors_results)}, goblins_defeated={request.goblins_defeated}")
    
    # Mettre à jour chaque survivant
    eliminated_survivors = []
    for survivor_result in request.survivors_results:
        survivor_id = survivor_result["id"]
        damage_dealt = survivor_result["damage_dealt"]
        is_eliminated = survivor_result["eliminated"]
        
        if survivor_id in game["players"]:
            survivor = game["players"][survivor_id]
            
            # Mettre à jour les PV
            if survivor.get("hp") is not None and damage_dealt > 0:
                survivor["hp"] = max(0, survivor["hp"] - damage_dealt)
                logger.info(f"❤️ PV de {survivor['name']} mis à jour: {survivor['hp']} (dégâts: {damage_dealt})")
            
            # Gérer l'élimination
            if is_eliminated or (survivor.get("hp") is not None and survivor["hp"] <= 0):
                survivor["eliminated"] = True
                survivor["hp"] = 0
                survivor["gold"] = 0
                survivor_room = survivor.get("current_room")
                if survivor_room and survivor_room in game["rooms"]:
                    game["rooms"][survivor_room]["eliminated_players"].append(survivor_id)
                
                eliminated_survivors.append(survivor["name"])
                event_msg = f"💀 {survivor['name']} a été vaincu dans le combat !"
                game["events"].append({"message": event_msg, "type": "combat_elimination"})
    
    # Broadcast les éliminations
    for name in eliminated_survivors:
        await broadcast_to_session(session_id, {"type": "event", "message": f"💀 {name} a été éliminé !"})
    
    # Message récapitulatif du combat
    if request.goblins_defeated > 0:
        event_msg = f"⚔️ Combat terminé ! {request.goblins_defeated} Gobelin(s) vaincu(s) !"
        if eliminated_survivors:
            event_msg += f" Aventuriers perdus : {', '.join(eliminated_survivors)}"
        game["events"].append({"message": event_msg, "type": "combat_completed"})
        await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
    
    # Clear pending events pour le killer et tous les survivants
    if attacker_id in game.get("pending_events", {}):
        del game["pending_events"][attacker_id]
    for survivor_result in request.survivors_results:
        survivor_id = survivor_result["id"]
        if survivor_id in game.get("pending_events", {}):
            del game["pending_events"][survivor_id]
    
    # Broadcast updated state
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })
    
    # Check victory conditions
    alive_survivors = [p for p in game["players"].values() if p["role"] == "survivor" and not p["eliminated"]]
    
    if len(alive_survivors) == 0:
        game["phase"] = "game_over"
        game["winner"] = "killers"
        
        survivor_msg = "💀 DÉFAITE ! Tous les aventuriers ont été éliminés..."
        killer_msg = "🎉 VICTOIRE ! Tous les aventuriers ont été exterminés !"
        
        await broadcast_to_role(session_id, "survivor", {
            "type": "game_over",
            "winner": "killers",
            "message": survivor_msg
        })
        
        await broadcast_to_role(session_id, "killer", {
            "type": "game_over",
            "winner": "killers",
            "message": killer_msg
        })
    
    return {"status": "success"}

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

    # ✅ AJOUTÉ: Fermer l'ancienne connexion WS si ce joueur en avait déjà une (stale après navigation)
    if player_id in active_connections[session_id]:
        old_ws = active_connections[session_id][player_id]
        try:
            await old_ws.close()
        except Exception:
            pass
        logger.info(f"Closed stale WS for player {player_id} in session {session_id}")

    active_connections[session_id][player_id] = websocket

    try:
        # Send current game state (filtered by player role only during active game)
        game = game_sessions[session_id]
        if player_id in game["players"]:
            # Only filter during active game, not in lobby
            if game.get("game_started", False):
                player_role = game["players"][player_id]["role"]
                filtered_game = filter_game_state(game, player_role, player_id)
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
                
                # ✅ AJOUTÉ: Envoyer aussi un player_list_update pour que le client se sync correctement
                players_list = []
                for pid, pdata in game["players"].items():
                    players_list.append({
                        "id": pid,
                        "name": pdata.get("name", ""),
                        "is_host": pdata.get("is_host", False),
                        "role": pdata.get("role", "survivor"),
                        "class": pdata.get("class", ""),
                        "character_class": pdata.get("character_class", ""),
                        "avatar": pdata.get("avatar", ""),
                        "eliminated": pdata.get("eliminated", False)
                    })
                await websocket.send_json({
                    "type": "player_list_update",
                    "players": players_list
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
                    
                   # Check if all survivors have selected and ended their turn
                    if game["phase"] == "survivor_selection":
                        await try_advance_to_killer_phase(session_id)
                    
                    # Broadcast updated state
                    await broadcast_to_session(session_id, {
                        "type": "state_update",
                        "game": game_sessions[session_id]
                    })
                    continue
                
                # Check if it's the player's turn based on their role and current phase
                if player["role"] == "survivor" and game["phase"] != "survivor_selection":
                    continue
                if player["role"] == "killer" and game["phase"] not in ["killer_selection", "rage_second_selection"]:
                    continue
                
                # Check Eboulement restriction for survivors
                if player["role"] == "survivor" and game.get("eboulement_active", False):
                    locked_floors = game.get("eboulement_locked_floors", {})
                    if player_id in locked_floors:
                        locked_floor = locked_floors[player_id]
                        
                        if room_name in game["rooms"]:
                            selected_floor = game["rooms"][room_name]["floor"]
                            
                            if locked_floor != selected_floor:
                                await websocket.send_json({
                                    "type": "error",
                                    "message": "⛰️ Un éboulement bloque les escaliers ! Vous ne pouvez pas changer d'étage ce tour-ci."
                                })
                                await broadcast_to_session(session_id, {
                                    "type": "state_update",
                                    "game": game_sessions[session_id]
                                })
                                continue
                
                # Handle rage second selection differently
                if game["phase"] == "rage_second_selection":
                    if player_id not in game.get("rage_second_chances", {}):
                        continue
                    
                    if room_name in game["rooms"] and not game["rooms"][room_name]["locked"]:
                        game["rage_second_chances"][player_id]["room_selected"] = room_name
                        game["rage_second_chances"][player_id]["can_select"] = False
                        
                        logger.info(f"😡 {player['name']} a choisi la seconde pièce '{room_name}' (Rage)")
                        
                        all_selected = all(not data["can_select"] for data in game["rage_second_chances"].values())
                        
                        if all_selected:
                            game["phase"] = "processing"
                            await process_rage_second_selections(session_id)
                        
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
                    
                    original_room_name = room_name
                    logger.info(f"🎯 {player['name']}, {player['character_class']}, {player['role']} a choisi la pièce '{room_name}'")

                    # PATROUILLE CHECK: Reveal survivors on same floor
                    if player["role"] == "survivor" and game.get("patrouille_patrol") and game["patrouille_patrol"].get("active"):
                        patrol_data = game["patrouille_patrol"]
                        selected_floor = game["rooms"][room_name]["floor"]
                        
                        # If survivor is on the same floor as the patrol
                        if selected_floor == patrol_data["floor"]:
                            # Track revealed survivor so killers see their avatar for this turn
                            if "patrol_revealed_survivors" not in game:
                                game["patrol_revealed_survivors"] = {}
                            game["patrol_revealed_survivors"][player_id] = room_name

                            # If survivor found the exact room with patrol, deactivate it
                            if room_name == patrol_data["room"]:
                                game["patrouille_patrol"]["active"] = False
                                if patrol_data["room"] in game["rooms"]:
                                    game["rooms"][patrol_data["room"]]["has_patrol"] = False
                                
                                # Notify survivor they found the patrol
                                await websocket.send_json({
                                    "type": "patrol_found",
                                    "message": f"Un gobelin de Patrouille a révélé votre position ! Il se trouve dans une pièce de l'étage.",
                                    "video_path": "/powers/Patrouille.mp4"
                                })
                                
                                logger.info(f"🔍 {player['name']} a trouvé le gobelin de patrouille dans {room_name}")
                            else:
                                # Survivor is on same floor but not in patrol room - just reveal position
                                await websocket.send_json({
                                    "type": "patrol_detected",
                                    "message": f"Un gobelin de Patrouille a révélé votre position ! Il se trouve dans une pièce de l'étage.",
                                    "video_path": "/powers/Patrouille.mp4"
                                })
                                
                                logger.info(f"🔍 {player['name']} a été détecté par le gobelin de patrouille")

                            # Notify killers that a survivor has been revealed (show avatar in the room)
                            await broadcast_to_session(session_id, {
                                "type": "patrol_reveal",
                                "player_id": player_id,
                                "player_name": player["name"],
                                "room": room_name,
                                "floor": selected_floor
                            }, role_filter="killer")
                            # Push full state so killer UI re-renders with patrol_revealed_survivors
                            await broadcast_to_session(session_id, {
                                "type": "state_update",
                                "game": game_sessions[session_id]
                            }, role_filter="killer")

                    # PRIORITY CHECK: Teleportation trap

                    if player["role"] == "survivor" and game["rooms"][room_name].get("teleportation_trap", False):
                        target_room = game["rooms"][room_name].get("teleportation_target_room")
                        
                        if target_room and target_room in game["rooms"]:

                            game["pending_events"][player_id] = "teleportation"
                            player_class = player.get("character_class", "Mage")
                            video_path = f"/death/{player_class}_teleportation.mp4"
                            
                            await websocket.send_json({
                                "type": "teleportation_notification",
                                "message": f"Vous déclenchez un piège de téléportation vers {target_room} !",
                                "video_path": video_path,
                                "target_room": target_room
                            })
                            
                            game["pending_actions"][player_id]["room"] = target_room
                            room_name = target_room
                            
                            logger.info(f"🌀 {player['name']} téléporté de {original_room_name} vers {target_room}")
                    
                    # GOLIATH CHECK
                    if (player["role"] == "survivor" and 
                        game.get("goliath_active", False) and 
                        not game.get("goliath_killed_this_turn", False)):
                        previous_turn_rooms = game.get("goliath_previous_turn_rooms", [])
                        if room_name in previous_turn_rooms:
                            player["eliminated"] = True
                            player["gold"] = 0
                            game["rooms"][room_name]["eliminated_players"].append(player_id)
                            
                            game["goliath_killed_this_turn"] = True
                            
                            player_class = player.get("character_class", "Assassin")
                            death_video_path = f"/death/{player_class}_La Goliath.mp4"
                            
                            event_msg = f"💀🕷️ {player['name']} s'est fait tuer par la Goliath dans {room_name} !"
                            game["events"].append({"message": event_msg, "type": "goliath_elimination"})
                            await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
                            
                            await websocket.send_json({
                                "type": "goliath_death_popup",
                                "message": "Vous avez été éliminé par la Goliath !",
                                "video_path": death_video_path
                            })
                            
                            for other_pid, other_ws in active_connections.get(session_id, {}).items():
                                if other_pid != player_id:
                                    try:
                                        await other_ws.send_json({
                                            "type": "goliath_death_popup",
                                            "message": f"{player['name']} s'est fait tuer par la Goliath dans {room_name} !",
                                            "video_path": death_video_path,
                                            "victim_name": player['name'],
                                            "room_name": room_name
                                        })
                                    except:
                                        pass
                            
                            logger.info(f"🕷️ {player['name']} tué par la Goliath dans {room_name} (Goliath désactivée pour ce tour)")
                            
                            game["rooms"][room_name]["locked"] = True
                            lock_msg = f"⚠️ La pièce {room_name} est condamnée pour ce tour."
                            game["events"].append({"message": lock_msg, "type": "room_locked"})
                            await broadcast_to_session(session_id, {"type": "event", "message": lock_msg})
                            
                            if has_item(player, "medikit"):
                                remove_item(player, "medikit")
                                new_medikit_room = respawn_medikit(game)
                                if new_medikit_room:
                                    respawn_msg = "⚗️ La potion de résurrection réapparaît quelque part dans la maison..."
                                    game["events"].append({"message": respawn_msg, "type": "medikit_respawn"})
                                    await broadcast_to_session(session_id, {"type": "event", "message": respawn_msg})
                            
                            await broadcast_to_session(session_id, {
                                "type": "player_action",
                                "player_id": player_id,
                                "player_name": player["name"],
                                "message": f"✅ {player['name']} a fait son choix"
                            })
                            
                            alive_survivors = [p for p in game["players"].values() if p["role"] == "survivor" and not p["eliminated"]]
                            if len(alive_survivors) == 0:
                                game["phase"] = "game_over"
                                game["winner"] = "killers"
                                
                                survivor_msg = "🎉 DEFAITE ! Tous les aventuriers ont été éliminés..."
                                killer_msg = "💀 VICTOIRE ! Tous les aventuriers ont été éliminés ..."
                                
                                game["events"].append({"message": survivor_msg, "type": "game_over", "for_role": "survivor"})
                                game["events"].append({"message": killer_msg, "type": "game_over", "for_role": "killer"})
                                
                                await broadcast_to_session(session_id, {"type": "game_over", "winner": "killers", "message": survivor_msg}, role_filter="survivor")
                                await broadcast_to_session(session_id, {"type": "game_over", "winner": "killers", "message": killer_msg}, role_filter="killer")
                            
                            await broadcast_to_session(session_id, {
                                "type": "state_update",
                                "game": game_sessions[session_id]
                            })
                            continue
                    
                    # Track rooms searched for Vision power
                    if player["role"] == "survivor" and room_name not in game.get("rooms_searched_this_key", []):
                        if "rooms_searched_this_key" not in game:
                            game["rooms_searched_this_key"] = []
                        game["rooms_searched_this_key"].append(room_name)
                    
                    # Check if survivor enters trapped room
                    if player["role"] == "survivor" and game["rooms"][room_name].get("trapped", False):
                        player["immobilized_next_turn"] = True
                        game["rooms"][room_name]["trap_triggered"] = True

                        game["pending_events"][player_id] = "trap"
                        
                        player_class = player.get("character_class", "Mage").lower()
                        video_path = f"/death/Blizzard_{player_class}.mp4"
                        
                        await websocket.send_json({
                            "type": "trapped_notification",
                            "message": "🥶 C'est un blizzard ! Vous n'avez pas d'autre choix que de vous cacher ce tour-ci.",
                            "video_path": video_path
                        })
                    
                    # Check if survivor enters poisoned room
                    if player["role"] == "survivor" and game["rooms"][room_name].get("poisoned_turns_remaining", 0) > 0:
                        if player.get("poisoned_countdown", 0) == 0:
                            player["poisoned_countdown"] = 10

                            game["pending_events"][player_id] = "poison"
                            
                            player_class = player.get("character_class", "Assassin")
                            video_path = f"/death/{player_class}_toxine.mp4"
                            
                            await websocket.send_json({
                                "type": "poisoned_notification",
                                "message": "😷 Vous avez été empoisonné par un gaz toxique ! Il vous reste 10 tours avant de suffoquer.",
                                "countdown": 10,
                                "video_path": video_path
                            })
                    
                    # Check for quest immediately when survivor selects room
                    if player["role"] == "survivor":
                        room = game["rooms"][room_name]
                        is_trapped = game["rooms"][room_name].get("trap_triggered", False)
                        
                        if room.get("has_quest", False) and room.get("quest_class"):
                            quest_class = room["quest_class"]
                            player_class = player.get("character_class")
                            
                            if player_class == quest_class:
                                if is_trapped:
                                    pass
                                else:
                                    room["has_quest"] = False
                                    room["quest_class"] = None
                                    game["completed_quests"].append(quest_class)
                                    game["keys_collected"] = len(game["completed_quests"])
                                    
                                    quests_left = game["keys_needed"] - len(game["completed_quests"])
                                    event_msg = f"✅ {player['name']} a complété sa quête ! Il reste {quests_left} quête(s) à compléter."
                                    game["events"].append({"message": event_msg, "type": "quest_completed", "for_role": "survivor"})
                                    await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="survivor")
                                    
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
                                    
                                    game["rooms_searched_this_key"] = []
                            else:
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
                                
                                event_msg = f"🔍 {player['name']} explore {room_name} mais ne peut pas accomplir cette quête."
                                game["events"].append({"message": event_msg, "type": "search_wrong_class", "for_role": "survivor"})
                                await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="survivor")
                        else:
                            event_msg = f"🔍 {player['name']} fouille {room_name} mais ne trouve rien de particulier."
                            game["events"].append({"message": event_msg, "type": "search_no_quest", "for_role": "survivor"})
                            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="survivor")
                        
                        # Check for crystal
                        if room.get("has_crystal", False) and game.get("crystal_spawned", False):
                            room["has_crystal"] = False
                            game["crystal_destroyed"] = True
                            game["phase"] = "game_over"
                            game["winner"] = "survivors"
                            
                            survivor_class = player.get("character_class", "Guerrier")
                            crystal_video = f"/event/Cristal_{survivor_class}.mp4"
                            
                            survivor_msg = "🎉 VICTOIRE ! Le cristal a été détruit ! Vous vous êtes échappés !"
                            killer_msg = "💀 DEFAITE ! Le cristal a été détruit..."
                            
                            game["events"].append({"message": survivor_msg, "type": "game_over", "for_role": "survivor"})
                            game["events"].append({"message": killer_msg, "type": "game_over", "for_role": "killer"})
                            
                            await broadcast_to_session(session_id, {
                                "type": "game_over",
                                "winner": "survivors",
                                "message": survivor_msg,
                                "video_path": crystal_video
                            }, role_filter="survivor")
                            
                            await broadcast_to_session(session_id, {
                                "type": "game_over",
                                "winner": "survivors",
                                "message": killer_msg,
                                "video_path": crystal_video
                            }, role_filter="killer")
                    
                    # GOLD SYSTEM
                    if player["role"] == "survivor" and not game["rooms"][room_name].get("trap_triggered", False):
                        gold_amount, gold_image = generate_gold_reward()
                        player["gold"] += gold_amount                        
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
                        
                        # RUNE DROP SYSTEM (after gold)
                        roll = random.random()
                        rune_type = None
                        if roll < 0.05:
                            rune_type = "rune_vitalite"
                        elif roll < 0.15:
                            rune_type = "rune_initiative"
                        elif roll < 0.30:
                            rune_type = "rune_dommage"
                        
                        if rune_type:
                            game["pending_events"][player_id] = {
                                "type": "rune_found",
                                "rune_type": rune_type,
                                "inventory_full": is_inventory_full(player)
                            }
                            logger.info(f"Player {player_id} found rune: {rune_type}")
                    
                    # Check for mimic
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_mimic", False):
                        gold_stolen = player.get("gold", 0)
                        player["gold"] = 0
                        
                        game["rooms"][room_name]["has_mimic"] = False

                        game["pending_events"][player_id] = "mimic"
                        
                        await websocket.send_json({
                            "type": "mimic_notification",
                            "message": f"💰 Vous croisez la mimic ! Attirée par votre or, elle vous poursuit ! Vous lachez vos {gold_stolen} pièces d'or pour rester en vie.",
                            "video_path": "/death/Mimic.mp4",
                            "gold_stolen": gold_stolen
                        })
                    
                    # Check for merchant
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_merchant", False):
                        is_trapped = game["rooms"][room_name].get("trap_triggered", False)
                        
                        if not is_trapped:
                            game["rooms"][room_name]["merchant_discovered"] = True

                            game["pending_events"][player_id] = "merchant"
                            await websocket.send_json({
                                "type": "merchant_encounter",
                                "message": "🧙 Vous rencontrez le marchand !",
                                "video_path": "/event/marchand.mp4"
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
                        await try_advance_to_killer_phase(session_id)

                    elif game["phase"] == "killer_selection":
                        alive_killers = [p for p in game["players"].values()\
                                       if p["role"] == "killer" and not p["eliminated"]]
                        killers_selected = [pid for pid in game["pending_actions"].keys()\
                                          if game["players"][pid]["role"] == "killer"]

                        if len(killers_selected) == len(alive_killers):
                            game["phase"] = "processing"
                            await process_turn(session_id)
            
            elif data["type"] == "select_power":
                if player["role"] != "killer" or game["phase"] != "killer_power_selection":
                    continue
                
                if player_id not in game["pending_power_selections"]:
                    continue
                
                power_name = data["power"]
                if power_name not in game["pending_power_selections"][player_id]["options"]:
                    continue
                
                game["pending_power_selections"][player_id]["selected_power"] = power_name
                
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
                    
                    await check_power_selection_complete(session_id)
            
            elif data["type"] == "power_action":
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
                
                await check_power_selection_complete(session_id)

            elif data["type"] == "use_medikit":
                if game["players"][player_id]["role"] != "survivor":
                    continue

                if not has_item(game["players"][player_id], "medikit"):
                    continue

                target_player_id = data["target_player_id"]
                if target_player_id in game["players"] and game["players"][target_player_id]["eliminated"]:
                    target_room = game["players"][target_player_id]["current_room"]
                    current_room = game["players"][player_id]["current_room"]

                    if target_room == current_room:
                        game["players"][target_player_id]["eliminated"] = False
                        game["players"][target_player_id]["poisoned_countdown"] = 0
                        remove_item(game["players"][player_id], "medikit")

                        if target_player_id in game["rooms"][target_room]["eliminated_players"]:
                            game["rooms"][target_room]["eliminated_players"].remove(target_player_id)

                        event_msg = f"💚 {game['players'][player_id]['name']} a ranimé {game['players'][target_player_id]['name']} !"
                        game["events"].append({"message": event_msg, "type": "revival"})
                        await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

                        new_medikit_room = respawn_medikit(game)
                        if new_medikit_room:
                            respawn_msg = "🩺 Le medikit réapparaît quelque part dans la maison..."
                            game["events"].append({"message": respawn_msg, "type": "medikit_respawn"})
                            await broadcast_to_session(session_id, {"type": "event", "message": respawn_msg})

            elif data["type"] == "use_antidote":
                if game["players"][player_id]["role"] != "survivor":
                    continue

                if not has_item(game["players"][player_id], "antidote"):
                    continue

                if game["players"][player_id].get("poisoned_countdown", 0) <= 0:
                    await websocket.send_json({
                        "type": "event",
                        "message": "Vous n'êtes pas empoisonné !"
                    })
                    continue

                game["players"][player_id]["poisoned_countdown"] = 0
                remove_item(game["players"][player_id], "antidote")

                event_msg = f"💊 {game['players'][player_id]['name']} utilise un antidote et est guéri du poison !"
                game["events"].append({"message": event_msg, "type": "antidote_used"})
                await broadcast_to_session(session_id, {"type": "antidote_used", "message": event_msg})
                
                logger.info(f"Player {player_id} used antidote to cure poison")

            
            # NEW: Handle event completion notification from frontend
            elif data["type"] == "event_completed":
                if player_id in game.get("pending_events", {}):
                    del game["pending_events"][player_id]
                    logger.info(f"Player {player_id} completed their event")
                
                # Check if we can now transition to killer phase
                if game["phase"] == "survivor_selection":
                    await try_advance_to_killer_phase(session_id)

            # NEW: Handle "Terminer mon tour" button click from survivors
            elif data["type"] == "end_turn":
                if player["role"] != "survivor":
                    continue
                if game["phase"] != "survivor_selection":
                    continue
                if player.get("eliminated", False):
                    continue
                # The player must have already selected a room and have no pending event
                if player_id not in game.get("pending_actions", {}):
                    continue
                if player_id in game.get("pending_events", {}):
                    continue

                if "survivors_ended_turn" not in game:
                    game["survivors_ended_turn"] = []
                if player_id not in game["survivors_ended_turn"]:
                    game["survivors_ended_turn"].append(player_id)
                    logger.info(f"Player {player_id} ({player['name']}) ended their turn")

                    await broadcast_to_session(session_id, {
                        "type": "player_action",
                        "player_id": player_id,
                        "player_name": player["name"],
                        "message": f"⏭️ {player['name']} a terminé son tour"
                    })

                # Check if we can transition to killer phase
                await try_advance_to_killer_phase(session_id)


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

