from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Query, Request
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
import math
import time
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
    "basement": ["Les Cryptes", "Les Cachots", "La Cave", "La Salle des Ruines"],
    "ground_floor": ["Le Hall Principal", "La Salle du Banquet", "L'Armurerie", "La Cour Intérieure"],
    "upper_floor": ["La Chambre Cérémoniale", "Le Laboratoire", "La Salle des Miroirs", "Le Sanctuaire"]
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
    player_avatar: Optional[str] = None  # NEW: optionnel (sera choisi dans le lobby)
    role: Optional[str] = None           # NEW: optionnel (sera choisi dans le lobby)

class SelectRoleRequest(BaseModel):      # NEW: Lobby-first role/avatar selection
    player_id: str
    role: str          # "survivor" or "killer"
    player_avatar: str

class StartGameRequest(BaseModel):
    pass

class UpdateGameSettingsRequest(BaseModel):  # NEW
    required_relics: dict  # {"relique_spherique": bool, "relique_cubique": bool, "relique_triangulaire": bool}
    dungeon_size: int = 12  # 6, 9 ou 12 pièces (2, 3 ou 4 par étage)
    enabled_powers: Optional[List[str]] = None  # liste des pouvoirs activés (None = tous)

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

# ── MALÉDICTION : helpers communs aux spécialisations ──────────────────────
def clear_cursed_display(player: dict) -> None:
    """Remove the 'cursed' / 'cursed_display' flags from every item in a player's
    inventory. Used when a curse (normale or incertaine) is lifted."""
    for slot in (player.get("inventory") or []):
        if slot:
            slot.pop("cursed", None)
            slot.pop("cursed_display", None)

def try_lift_curse(game: dict, player_id: str, slot_index: int) -> Optional[str]:
    """Check whether the inventory slot (player_id, slot_index) was the cursed item
    and, if so, lift the corresponding curse from the game state.

    Returns the variant of the curse that was lifted:
      - "normale"    : the base Malédiction (single curse)
      - "incertaine" : Malédiction Incertaine — clears the cursed_display overlay
                       from every other item of the target's inventory
      - "masse"      : Malédiction de Masse — only this player's curse entry is removed
    Returns None if this slot wasn't cursed.
    """
    active_curse = game.get("active_curse")
    if (active_curse
            and active_curse.get("target_player_id") == player_id
            and active_curse.get("slot_index") == slot_index):
        variant = active_curse.get("variant") or "normale"
        game.pop("active_curse", None)
        target_player = game["players"].get(player_id)
        if target_player:
            clear_cursed_display(target_player)
        return variant

    active_curses = game.get("active_curses")
    if active_curses:
        for i, curse in enumerate(active_curses):
            if curse.get("target_player_id") == player_id and curse.get("slot_index") == slot_index:
                active_curses.pop(i)
                if not active_curses:
                    game.pop("active_curses", None)
                return "masse"

    return None

def generate_short_code() -> str:
    """Generate a short 4-character alphanumeric code"""
    characters = string.ascii_uppercase + string.digits
    while True:
        code = ''.join(random.choice(characters) for _ in range(4))
        # Check if code already exists
        if code not in game_sessions:
            return code

def generate_rooms_state() -> dict:
    """Génère aléatoirement l'état initial des 12 pièces du donjon (3 étages × 4 pièces).
    Utilisée à la création de partie et à chaque reset (puisque dungeon_size peut changer)."""
    all_rooms_names = []
    for floor, rooms in ROOMS_CONFIG.items():
        all_rooms_names.extend(rooms)

    # Mélanger aléatoirement les noms des pièces
    random.shuffle(all_rooms_names)

    # Répartir les pièces mélangées sur les 3 étages (4 par étage)
    # IMPORTANT : Utiliser les clés internes (basement, ground_floor, upper_floor)
    # et NON les noms d'affichage français, car le frontend et les autres
    # fonctions backend utilisent ces clés internes.
    floors = ["upper_floor", "ground_floor", "basement"]
    rooms_state = {}
    for i, room_name in enumerate(all_rooms_names):
        floor = floors[i // 4]  # 0-3 = upper_floor, 4-7 = ground_floor, 8-11 = basement
        rooms_state[room_name] = {
            "floor": floor,
            "has_key": False,
            "locked": False,
            "eliminated_players": [],
            "trapped": False,
            "highlighted": False,
            "has_quest": False,
            "quest_class": None,
            "poisoned_turns_remaining": 0,
            "has_mimic": False,
            "has_crystal": False,
            "teleportation_trap": False,
            "teleportation_exit": False,
            "teleportation_target_room": None,
            "has_merchant": False,
            "merchant_discovered": False,
            "has_cartographer": False,
            "cartographer_discovered": False,
            "has_patrol": False,
            "has_forge": False,
            "forge_discovered": False,
            "has_crystal_event": False,
            "crystal_discovered": False,
            "has_observation_stone": False,
            "has_resurrection_stele": False,
            "resurrection_stele_discovered": False,
            "has_trophy": None,
            "has_fleeing_goblin": False,
        }
    return rooms_state


def create_game_state(host_id: str, host_name: str, host_avatar: str, host_role: str) -> dict:
    """Initialize a new game state"""
    # Générer aléatoirement l'état initial des 12 pièces
    rooms_state = generate_rooms_state()

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
                "weapon_forge_attempts": 0 if host_role == "survivor" else 0,  # NEW: forge attempts on weapon
                "weapon_bonuses": [] if host_role == "survivor" else None,  # NEW: list of {stat, value, rune_type, label}
                "pending_forge_room": None,  # NEW: room name where a forge is waiting after a rune event
                "inventory": [None] * 9 if host_role == "survivor" else None,
                "powers_evolution": {
                    "mimic": {"level": 1, "variant": None},
                    "rage": {"level": 1, "variant": None},
                    "piege": {"level": 1, "variant": None},
                    "toxine": {"level": 1, "variant": None},
                    "vision": {"level": 1, "variant": None},
                    "teleportation": {"level": 1, "variant": None},
                    "goliath": {"level": 1, "variant": None},
                    "eboulement": {"level": 1, "variant": None},
                    "patrouille": {"level": 1, "variant": None},
                    "traque": {"level": 1, "variant": None}
                } if host_role == "killer" else None,
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
        "pending_events_queue": {},  # NEW: Per-player FIFO queue of events to display after the active one is closed
        "survivors_ended_turn": [],  # NEW: list of player_ids that have clicked "Terminer mon tour"
        "should_place_next_key": False,
        "conspiracy_mode": False,  # NEW: conspiracy mode flag
        "active_powers": {},  # NEW: {power_name: {used_by: [player_ids], data: {...}}}
        "pending_power_selections": {},  # NEW: {player_id: {selected_power: str, options: [str], action_data: {...}}}

        "quests": [],  # NEW: list of all quests to complete
        "active_quest": None,  # NEW: current active quest {class: "Mage", room: "Les Cryptes"}
        "completed_quests": [],  # NEW: list of completed quest classes
        "rage_second_chances": {},  # NEW: {killer_id: {"can_select": True/False, "room_selected": None}}
        "crystal_spawned": False,  # NEW: whether crystal has been spawned
        "crystal_destroyed": False,  # NEW: whether crystal has been destroyed (victory condition)
        "merchant_placed": False,  # NEW: whether merchant has been placed
        "crystal_event_placed": False,      # NEW
        "crystal_placed_relics": {           # NEW: persistent state of relics on crystal
            "relique_spherique": False,
            "relique_cubique": False,
            "relique_triangulaire": False,
        },
        "required_relics": {                 # NEW: relics enabled by the host in lobby settings
            "relique_spherique": True,
            "relique_cubique": True,
            "relique_triangulaire": True,
        },
        "dungeon_size": 12,                  # NEW: 6, 9 ou 12 pièces (paramètre lobby)
        "enabled_powers": list(POWERS.keys()),  # NEW: liste des pouvoirs disponibles (tous par défaut)
        "crystal_room": None,
        "crystal_combat": None,   # NEW: {hp, max_hp, initiative, turn_order, current_turn, participants, phase}
        "crystal_room": None,                # NEW
        "relique_triangulaire_sold": False,  # NEW: whether the relique has been sold (unique item)
        "cartographer_placed": False,  # NEW: whether cartographer has been placed
        "cartographer_hints_given": {},  # NEW: {player_id: [hint_texts]} - track hints given to each player
        "forge_placed": False,  # NEW: whether forge has been placed
        "observation_stone_placed": False,
        "observation_stone_target_room": None,  # room where the stone must be thrown
        "observation_stone_quest_completed": False,  # whether the stone quest has been completed
        "fleeing_goblin_placed": False,  # NEW: whether fleeing goblin has been placed
        "goliath_active": False,  # whether Poursuite is active
        "goliath_turns_remaining": 0,  # turns remaining for Poursuite
        "goliath_previous_turn_rooms": [],  # rooms visited by survivors in the previous turn
        "goliath_killed_this_turn": False,  # legacy flag (kept for compatibility)
        "poursuite_precision_empty_rooms": [],  # rooms revealed by Poursuite de Précision variant
        "eboulement_active": False,  # NEW: whether Eboulement is active (blocks floor changes for 1 turn)
        "eboulement_locked_floors": {},  # NEW: stores which floor each survivor is locked to during eboulement {player_id: floor}
        "eboulement_perturbation_active": False,  # NEW: whether Perturbation variant is active (double damage + -15 initiative)
        "patrouille_patrol": None,  # NEW: {room: str, floor: str, active: bool} - gobelin de patrouille
        "patrol_revealed_survivors": {},  # NEW: {player_id: room_name} - survivants revealed by patrol goblin during this turn
        "discovered_rooms": [],  # NEW: List of room names discovered by survivors (fog of war)
        "pending_specializations": {},  # NEW: Pending power specializations
        "combat_help_windows": {}, # NEW: {attacker_id: {combat_type, room, participants, mimic_hp, mimic_has_initiative, expires_at, finalized}}
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

def place_cartographer(game_state: dict) -> Optional[str]:
    """Place the cartographer in a random available room at game start (once per game)"""
    available_rooms = []

    # Get all killer positions
    killer_positions = [p["current_room"] for p in game_state["players"].values()
                       if p["role"] == "killer" and p["current_room"]]

    for room_name, room_data in game_state["rooms"].items():
        # Room is available if: not locked, no quest, no merchant, no cartographer, no forge, not a killer's position
        if (not room_data["locked"] and
            not room_data.get("has_quest", False) and
            not room_data.get("has_merchant", False) and
            not room_data.get("has_cartographer", False) and
            not room_data.get("has_forge", False) and
            room_name not in killer_positions):
            available_rooms.append(room_name)

    if available_rooms:
        selected_room = random.choice(available_rooms)
        game_state["rooms"][selected_room]["has_cartographer"] = True
        game_state["cartographer_placed"] = True
        logger.info(f"Cartographer placed in room: {selected_room}")
        return selected_room

    return None

def place_forge(game_state: dict) -> Optional[str]:
    """Place the forge in a random available room at game start (once per game)"""
    available_rooms = []

    killer_positions = [p["current_room"] for p in game_state["players"].values()
                       if p["role"] == "killer" and p["current_room"]]

    for room_name, room_data in game_state["rooms"].items():
        # Available if: not locked, no quest, no merchant, no cartographer, no forge, not a killer's position
        if (not room_data["locked"] and
            not room_data.get("has_quest", False) and
            not room_data.get("has_merchant", False) and
            not room_data.get("has_cartographer", False) and
            not room_data.get("has_forge", False) and
            room_name not in killer_positions):
            available_rooms.append(room_name)

    if available_rooms:
        selected_room = random.choice(available_rooms)
        game_state["rooms"][selected_room]["has_forge"] = True
        game_state["forge_placed"] = True
        logger.info(f"Forge placed in room: {selected_room}")
        return selected_room

    return None

def place_crystal_event(game_state: dict) -> Optional[str]:
    """Place the crystal event in a random room with no other event."""
    available_rooms = []
    killer_positions = [p["current_room"] for p in game_state["players"].values()
                       if p["role"] == "killer" and p["current_room"]]

    for room_name, room_data in game_state["rooms"].items():
        if (not room_data["locked"]
            and not room_data.get("has_quest", False)
            and not room_data.get("has_merchant", False)
            and not room_data.get("has_forge", False)
            and not room_data.get("has_cartographer", False)
            and not room_data.get("has_trophy", False)
            and not room_data.get("has_observation_stone", False)
            and not room_data.get("has_fleeing_goblin", False)
            and not room_data.get("has_crystal_event", False)
            and not room_data.get("has_crystal", False)  # old system
            and room_name not in killer_positions):
            available_rooms.append(room_name)

    if available_rooms:
        selected = random.choice(available_rooms)
        game_state["rooms"][selected]["has_crystal_event"] = True
        game_state["crystal_event_placed"] = True
        game_state["crystal_room"] = selected
        logger.info(f"Crystal event placed in room: {selected}")
        return selected
    return None

def place_observation_stone(game_state: dict) -> Optional[str]:
    """Place the observation stone in a random room with no events (quest, merchant, forge) at game start."""
    available_rooms = []

    killer_positions = [p["current_room"] for p in game_state["players"].values()
                       if p["role"] == "killer" and p["current_room"]]

    for room_name, room_data in game_state["rooms"].items():
        # Available if: not locked, no quest, no merchant, no cartographer, no forge, no observation stone, not a killer position
        if (not room_data["locked"] and
            not room_data.get("has_quest", False) and
            not room_data.get("has_merchant", False) and
            not room_data.get("has_cartographer", False) and
            not room_data.get("has_forge", False) and
            not room_data.get("has_observation_stone", False) and
            room_name not in killer_positions):
            available_rooms.append(room_name)

    if available_rooms:
        selected_room = random.choice(available_rooms)
        game_state["rooms"][selected_room]["has_observation_stone"] = True
        game_state["observation_stone_placed"] = True
        logger.info(f"Observation stone placed in room: {selected_room}")
        return selected_room

    return None

def place_trophies(game_state: dict) -> List[str]:
    """Place the 3 trophy items (Chaussons / Couronne / Culotte) in 3 distinct event-free rooms."""
    trophies = ["chaussons", "couronne", "culotte"]
    placed_rooms = []

    killer_positions = [p["current_room"] for p in game_state["players"].values()
                       if p["role"] == "killer" and p["current_room"]]

    for trophy_type in trophies:
        available_rooms = []
        for room_name, room_data in game_state["rooms"].items():
            if (not room_data["locked"] and
                not room_data.get("has_quest", False) and
                not room_data.get("has_merchant", False) and
                not room_data.get("has_cartographer", False) and
                not room_data.get("has_forge", False) and
                not room_data.get("has_observation_stone", False) and
                not room_data.get("has_trophy") and
                room_name not in killer_positions):
                available_rooms.append(room_name)

        if available_rooms:
            selected_room = random.choice(available_rooms)
            game_state["rooms"][selected_room]["has_trophy"] = trophy_type
            placed_rooms.append(selected_room)
            logger.info(f"Trophy '{trophy_type}' placed in room: {selected_room}")
        else:
            logger.warning(f"Could not place trophy '{trophy_type}' - no available rooms")

    return placed_rooms

def place_fleeing_goblin(game_state: dict) -> Optional[str]:
    """Place the fleeing goblin in a random available room at game start (once per game)"""
    available_rooms = []

    killer_positions = [p["current_room"] for p in game_state["players"].values()
                       if p["role"] == "killer" and p["current_room"]]

    for room_name, room_data in game_state["rooms"].items():
        if (not room_data["locked"] and
            not room_data.get("has_quest", False) and
            not room_data.get("has_merchant", False) and
            not room_data.get("has_cartographer", False) and
            not room_data.get("has_forge", False) and
            not room_data.get("has_observation_stone", False) and
            not room_data.get("has_trophy") and
            room_name not in killer_positions):
            available_rooms.append(room_name)

    if available_rooms:
        selected_room = random.choice(available_rooms)
        game_state["rooms"][selected_room]["has_fleeing_goblin"] = True
        game_state["fleeing_goblin_placed"] = True
        logger.info(f"Fleeing goblin placed in room: {selected_room}")
        return selected_room

    return None

# Forge: bonus values per rune type (identical to existing StatsModal preview)
FORGE_RUNE_BONUSES = {
    "rune_dommage": {"stat": "damage", "value": 2, "label": "+2 dégâts"},
    "rune_vitalite": {"stat": "vitality", "value": 8, "label": "+8 vitalité"},
    "rune_initiative": {"stat": "initiative", "value": 3, "label": "+3 initiative"},
}

# Forge: success rate per attempt index. 5+ attempts -> 30% (fixed)
FORGE_SUCCESS_RATES = [1.0, 0.8, 0.6, 0.4, 0.3]

def place_resurrection_stele(game_state: dict) -> Optional[str]:
    """Place the resurrection stele in a random available room at game start (once per game)."""
    rooms = list(game_state["rooms"].keys())
    random.shuffle(rooms)
    candidates = []
    for room_name in rooms:
        room_data = game_state["rooms"][room_name]
        if (
            not room_data.get("locked", False)
            and not room_data.get("has_quest", False)
            and not room_data.get("has_merchant", False)
            and not room_data.get("has_cartographer", False)
            and not room_data.get("has_forge", False)
            and not room_data.get("has_observation_stone", False)
            and not room_data.get("has_crystal_event", False)
            and not room_data.get("has_crystal", False)
            and not room_data.get("has_trophy")
            and not room_data.get("has_resurrection_stele", False)
        ):
            candidates.append(room_name)
    if not candidates:
        return None
    selected = random.choice(candidates)
    game_state["rooms"][selected]["has_resurrection_stele"] = True
    return selected


def get_forge_success_rate(attempts: int) -> float:
    """Return success probability for the given attempt number (attempts already done so far)."""
    idx = min(attempts, len(FORGE_SUCCESS_RATES) - 1)
    return FORGE_SUCCESS_RATES[idx]

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


async def enqueue_player_event(session_id: str, player_id: str, event_key, ws_message: Optional[dict]):
    """
    Sequentially enqueue a popup event for a player.

    - If the player has NO currently active event (`pending_events[player_id]` empty),
      sets this one as active and immediately sends `ws_message` (if any) over the
      player's websocket.
    - Otherwise, appends `{event_key, ws_message}` to `pending_events_queue[player_id]`
      and waits for `event_completed` to dequeue and send it.

    `event_key` may be either a simple string (e.g. "trap") or a dict (e.g. rune_found payload).
    `ws_message` is the websocket payload to send for the popup; pass `None` for events that
    don't need a direct WS popup (e.g. rune_found is read by the frontend from state_update).
    """
    game = game_sessions.get(session_id)
    if not game:
        return

    pending_events = game.setdefault("pending_events", {})
    pending_queue = game.setdefault("pending_events_queue", {})

    if player_id not in pending_events:
        # No active event yet -> set as active and dispatch the WS popup immediately
        pending_events[player_id] = event_key
        if ws_message is not None:
            ws = active_connections.get(session_id, {}).get(player_id)
            if ws is not None:
                try:
                    await ws.send_json(ws_message)
                except Exception:
                    pass
    else:
        # Already an active event -> queue this one for later
        pending_queue.setdefault(player_id, []).append({
            "event_key": event_key,
            "ws_message": ws_message,
        })
        logger.info(
            f"Queued popup event for player {player_id}: "
            f"{event_key if isinstance(event_key, str) else event_key.get('type', event_key)} "
            f"(queue size: {len(pending_queue[player_id])})"
        )


async def finalize_combat_help_window(session_id: str, attacker_id: str, delay: float = 10.0):
    await asyncio.sleep(delay)
    game = game_sessions.get(session_id)
    if not game:
        return
    combat_window = game.get("combat_help_windows", {}).get(attacker_id)
    if not combat_window or combat_window.get("finalized"):
        return
    combat_window["finalized"] = True
    participants = combat_window["participants"]

    # ⚠️ Format identique à un combat multi-gobelin (réutilise MultiPlayerCombat côté front)
    survivors = []
    for sid in participants:
        s = game["players"].get(sid)
        if not s:
            continue
        survivors.append({
            "id": sid,
            "name": s["name"],
            "class": s.get("character_class", "Guerrier"),
            "hp": s.get("hp", 36),
            "max_hp": s.get("max_hp", 36),
            "initiative_bonus": s.get("initiative_bonus", 0),
            "damage_bonus": s.get("damage_bonus", 0),
            "poisoned_countdown": s.get("poisoned_countdown", 0),
        })

    combat_id = f"mimic_{attacker_id}_{int(combat_window['expires_at'])}"
    combat_event = {
        "type": "mimic_combat",                # ← garde ce type pour le routage
        "combat_type": "mimic",                # ← flag pour MultiPlayerCombat
        "attacker_id": attacker_id,            # requis par MultiPlayerCombat
        "room": combat_window["room"],
        "survivors": survivors,                # ← clé identique au gobelin multi
        "participants": participants,
        "num_goblins": 1,                      # 1 seul "enemy" = le Mimic
        "goblin_hp": combat_window["mimic_hp"],
        "mimic_hp": combat_window["mimic_hp"],
        "combat_id": combat_id,
        "turn": game.get("turn", 0),
        "toxine_incapacitante_active": False,
        "eboulement_perturbation_active": game.get("eboulement_perturbation_active", False),
    }

    for sid in participants:
        await enqueue_player_event(session_id, sid, "mimic_combat", combat_event)

    del game["combat_help_windows"][attacker_id]
    await broadcast_to_session(session_id, {"type": "state_update", "game": game})
    logger.info(f"🪤 Mimic combat finalisé : {len(participants)} participant(s)")


async def dispatch_next_player_event(session_id: str, player_id: str) -> bool:
    """
    Pop the next queued event for the player (if any), set it as active and dispatch the
    associated WS popup message. Returns True if an event was dispatched, False otherwise.
    Called after `event_completed` consumed the previous active event.
    """
    game = game_sessions.get(session_id)
    if not game:
        return False

    queue = game.setdefault("pending_events_queue", {})
    if player_id not in queue or not queue[player_id]:
        # Nothing queued
        if player_id in queue:
            del queue[player_id]
        return False

    next_event = queue[player_id].pop(0)
    if not queue[player_id]:
        del queue[player_id]

    game.setdefault("pending_events", {})[player_id] = next_event["event_key"]

    ws_message = next_event.get("ws_message")
    if ws_message is not None:
        ws = active_connections.get(session_id, {}).get(player_id)
        if ws is not None:
            try:
                await ws.send_json(ws_message)
            except Exception:
                pass
    return True


# Power definitions
POWERS = {
    "vision": {
        "name": "👁️ Vision",
        "description": "Révèle la position des aventuriers qui se trouvent dans une salle contenant un évènement déjà découvert par les orcs (forge, marchand, cartographe, stèle de réanimation, cristal...).",
        "icon": "Vision.mp4",
        "requires_action": False
    },
    "secousse": {
        "name": "↩️ Secousse",
        "description": "Déplacez aléatoirement un événement déjà découvert (marchand, forge, cartographe, cristal...) vers une autre pièce de la carte",
        "icon": "secousse.mp4",
        "requires_action": True,
        "action_type": "select_event"  # select one already-discovered event to relocate
    },
    "piege": {
        "name": "🥶 Blizzard",
        "description": "Déployez un blizzard dans des pièces au choix. Les aventuriers pris dans un blizzard sont immobilisés et perdent ~20% de leurs PV. (2 pièces pour 6 salles, 3 pour 9, 4 pour 12)",
        "icon": "blizzard.mp4",
        "requires_action": True,
        "action_type": "select_rooms_blizzard"  # select N rooms based on dungeon_size
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
        "name": "⚔️ Poursuite",
        "description": "Choisir une pièce déjà visitée par vos alliés ou vous-même au tour précédent déclenche un combat.",
        "icon": "Poursuite.mp4",
        "requires_action": False
    },
    "eboulement": {
        "name": "⛰️ Eboulement",
        "description": "Bloquez les escaliers et forcez les joueurs à rester dans leur étage durant 1 tour",
        "icon": "Eboulement.mp4",
        "requires_action": False
    },
    "patrouille": {
        "name": "🔍 Espionnage",
        "description": "Révèle la présence de joueurs dans l'étage tant que le gobelin n'est pas trouvé.",
        "icon": "Espionnage.mp4",
        "requires_action": True,
        "action_type": "select_room"  # select one room
    },
    "malediction": {
        "name": "🔮 Malédiction",
        "description": "Maudissez un objet de l'inventaire d'un joueur survivant. S'il n'utilise ou ne supprime pas l'objet maudit avant la fin de son tour, tous les joueurs perdront 10 points de vie.",
        "icon": "Malediction.mp4",
        "requires_action": True,
        "action_type": "select_cursed_item"
    }
}
def get_discovered_events(game_state: dict) -> list:
    """
    Return list of events that have been discovered and are currently visible to killers
    on the map. An event is "discovered" when killers can see its icon in the room.

    Each item: {"room": <room_name>, "type": <event_type>, "name": <display_name>}
    Event types: "merchant", "cartographer", "forge", "crystal"
    """
    discovered = []
    for room_name, room_data in game_state.get("rooms", {}).items():
        if room_data.get("has_merchant", False) and room_data.get("merchant_discovered", False):
            discovered.append({"room": room_name, "type": "merchant", "name": "🧙 Marchand"})
        if room_data.get("has_resurrection_stele", False) and room_data.get("resurrection_stele_killer_visible", False):
            discovered.append({"room": room_name, "type": "resurrection_stele", "name": "🪦 Stèle de résurrection"})
        if room_data.get("has_cartographer", False) and room_data.get("cartographer_discovered", False):
            discovered.append({"room": room_name, "type": "cartographer", "name": "🗺️ Cartographe"})
        if room_data.get("has_forge", False) and room_data.get("forge_discovered", False):
            discovered.append({"room": room_name, "type": "forge", "name": "🔥 Forge"})
        # Crystal event is visible to killers as soon as it is placed (has_crystal_event)
        if room_data.get("has_crystal_event", False):
            discovered.append({"room": room_name, "type": "crystal", "name": "💎 Cristal"})
    return discovered


def relocate_event(game_state: dict, source_room: str, event_type: str) -> Optional[str]:
    """
    Move a discovered event from `source_room` to a random other valid room on the map.
    Returns the new room name, or None if no valid relocation is possible.

    Rules:
    - Destination room must NOT contain another event (merchant, cartographer, forge,
      crystal event/legacy crystal, observation stone, trophy, fleeing goblin or quest).
    - Destination room must not be locked.
    - Destination room must not be a killer's current position.
    - Destination room must be different from the source room.
    """
    if source_room not in game_state.get("rooms", {}):
        return None

    src = game_state["rooms"][source_room]

    # Map event_type -> (has_flag, discovered_flag)
    flag_map = {
        "merchant": ("has_merchant", "merchant_discovered"),
        "cartographer": ("has_cartographer", "cartographer_discovered"),
        "forge": ("has_forge", "forge_discovered"),
        "crystal": ("has_crystal_event", "crystal_discovered"),
    }
    if event_type not in flag_map:
        return None

    has_flag, discovered_flag = flag_map[event_type]
    if not src.get(has_flag, False):
        return None  # source no longer holds this event

    killer_positions = [p["current_room"] for p in game_state["players"].values()
                        if p["role"] == "killer" and p["current_room"]]

    available_rooms = []
    for room_name, room_data in game_state["rooms"].items():
        if room_name == source_room:
            continue
        if room_data.get("locked", False):
            continue
        if room_name in killer_positions:
            continue
        # Reject rooms that already contain any event
        if (room_data.get("has_quest", False)
                or room_data.get("has_merchant", False)
                or room_data.get("has_cartographer", False)
                or room_data.get("has_forge", False)
                or room_data.get("has_crystal_event", False)
                or room_data.get("has_crystal", False)
                or room_data.get("has_observation_stone", False)
                or room_data.get("has_fleeing_goblin", False)
                or room_data.get("has_trophy", None) is not None):
            continue
        available_rooms.append(room_name)

    if not available_rooms:
        return None

    destination = random.choice(available_rooms)

    # Move the event flags
    killer_visible_flag = f"{event_type}_killer_visible"
    src[has_flag] = False
    src[discovered_flag] = False
    src[killer_visible_flag] = False  # clear killer-only flag at source (au cas où Secousse a déjà été utilisée)
    game_state["rooms"][destination][has_flag] = True
    # NEW: après Secousse, l'événement DISPARAÎT pour les survivors :
    # ils devront le redécouvrir en fouillant la nouvelle pièce.
    # Les killers, eux, voient la nouvelle position via un flag dédié.
    game_state["rooms"][destination][discovered_flag] = False
    game_state["rooms"][destination][killer_visible_flag] = True

    # Keep crystal_room reference in sync if applicable
    if event_type == "crystal":
        game_state["crystal_room"] = destination

    logger.info(f"Secousse: relocated {event_type} from {source_room} to {destination}")
    return destination


def get_random_powers(exclude_powers: list = [], game_state: dict = None) -> list:
    """Get 3 random unique powers, excluant poursuite si déjà active and
    excluding secousse if no events have been discovered yet."""
    excluded = list(exclude_powers)

    # Restrict to enabled powers if configured
    enabled_powers = game_state.get("enabled_powers") if game_state else None
    if enabled_powers is None:
        enabled_powers = list(POWERS.keys())

    # Exclure poursuite si déjà active
    if game_state and game_state.get("goliath_active", False):
        excluded.append("goliath")

    # Exclude secousse and vision if no event has been discovered yet by/visible to killers
    if game_state and not get_discovered_events(game_state):
        excluded.append("secousse")
        excluded.append("vision")

    # Exclude malediction if no survivor has a cursable item
    CURSABLE_TYPES = {"rune_dommage", "rune_initiative", "rune_vitalite", "antidote", "couronne", "culotte", "chaussons"}
    if game_state:
        has_cursable = False
        for p in game_state.get("players", {}).values():
            if p.get("role") == "survivor" and not p.get("eliminated", False):
                for slot in (p.get("inventory") or []):
                    if slot and slot.get("type") in CURSABLE_TYPES:
                        has_cursable = True
                        break
            if has_cursable:
                break
        if not has_cursable:
            excluded.append("malediction")

    available = [p for p in enabled_powers if p not in excluded and p in POWERS]
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

        # Flux normal vers killer_selection.
        # Les pending_specializations éventuels seront consommés par process_turn
        # après la phase de fouille, comme pour tous les autres pouvoirs (vision, mimic…).
        game["phase"] = "killer_selection"
        # Clear pending_power_selections before broadcast so the frontend never sees
        # action_complete=True while still on killer_power_selection phase.
        game["pending_power_selections"] = {}
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
            # Révèle les aventuriers dans des salles avec évènements découverts par les killers
            vision_revealed = {}

            # Lire le variant (None = base, "vigilante", "accumulative")
            killer_player = game["players"].get(player_id)
            vision_variant = (killer_player or {}).get("powers_evolution", {}).get("vision", {}).get("variant")

            # Construire la liste des salles avec évènements connus des killers
            discovered_event_rooms = set()
            for room_name, room_data in game["rooms"].items():
                if (room_data.get("has_merchant") and (room_data.get("merchant_discovered") or room_data.get("merchant_killer_visible"))) or \
                   (room_data.get("has_cartographer") and (room_data.get("cartographer_discovered") or room_data.get("cartographer_killer_visible"))) or \
                   (room_data.get("has_forge") and (room_data.get("forge_discovered") or room_data.get("forge_killer_visible"))) or \
                   room_data.get("has_crystal_event"):
                    discovered_event_rooms.add(room_name)

            # Trouver les survivants dans ces salles (depuis pending_actions = salle choisie ce tour)
            for survivor_id, action in game.get("pending_actions", {}).items():
                survivor = game["players"].get(survivor_id)
                if not survivor or survivor["role"] != "survivor" or survivor["eliminated"]:
                    continue
                target_room = action.get("room")
                if target_room and target_room in discovered_event_rooms:
                    vision_revealed[survivor_id] = target_room

            # VIGILANTE: also reveal survivors who picked up an item this turn
            if vision_variant == "vigilante":
                items_gained_this_turn = game.get("turn_survivors_items_gained", {})
                for survivor_id, room_name in items_gained_this_turn.items():
                    survivor = game["players"].get(survivor_id)
                    if survivor and not survivor.get("eliminated") and survivor_id not in vision_revealed:
                        vision_revealed[survivor_id] = room_name

            # ACCUMULATIVE: also reveal survivors who triggered a trap, fought, or lost HP this turn
            if vision_variant == "accumulative":
                damaged_this_turn = game.get("turn_survivors_damaged", {})
                for survivor_id, room_name in damaged_this_turn.items():
                    survivor = game["players"].get(survivor_id)
                    if survivor and not survivor.get("eliminated"):
                        # Use current room (most up-to-date) if available
                        actual_room = survivor.get("current_room") or room_name
                        vision_revealed[survivor_id] = actual_room

            game["active_powers"]["vision"] = {
                "used_by": [player_id],
                "data": {"vision_revealed": vision_revealed}
            }

            # Injecter dans patrol_revealed_survivors pour l'affichage côté killers (même mécanique que Patrouille)
            if "patrol_revealed_survivors" not in game:
                game["patrol_revealed_survivors"] = {}
            game["patrol_revealed_survivors"].update(vision_revealed)

            if vision_revealed:
                names = ", ".join(
                    game["players"][sid]["name"]
                    for sid in vision_revealed
                    if sid in game["players"]
                )
                event_msg = f"👁️ Vision : {player['name']} localise des aventuriers dans des salles connues — {names} !"
            else:
                event_msg = f"👁️ Vision : {player['name']} scrute les salles connues mais aucun aventurier ne s'y trouve."

            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

            # ── Specialization trigger (level 1 only) ──
            killer_player = game["players"].get(player_id)
            power_data = game["pending_power_selections"].get(player_id, {})
            if killer_player and "powers_evolution" in killer_player:
                power_evolution_check = killer_player["powers_evolution"].get("vision", {})
                current_level = power_evolution_check.get("level", 1)
                if current_level == 1 and not power_data.get("specialization_triggered", False):
                    if player_id in game["pending_power_selections"]:
                        game["pending_power_selections"][player_id]["specialization_triggered"] = True
                    game["pending_specializations"] = game.get("pending_specializations", {})
                    game["pending_specializations"][player_id] = {
                        "power": "vision",
                        "specializations": {
                            "vigilante": {
                                "name": "👁️ Vision Vigilante",
                                "description": "Révèle également la position des aventuriers ayant obtenu un objet durant le tour (runes, reliques, potions…).",
                                "video_path": "/powers/vision vigilante.mp4"
                            },
                            "accumulative": {
                                "name": "👁️ Vision Accumulative",
                                "description": "Révèle également la position des aventuriers ayant déclenché un piège, un combat ou perdu des points de vie durant ce tour.",
                                "video_path": "/powers/vision accumulative.mp4"
                            }
                        }
                    }
                    logger.info(f"🔮 Spécialisation Vision disponible pour {killer_player['name']}")
        
        elif power_name == "secousse":
            # NEW behavior: relocate a previously discovered event chosen by the killer
            action_data = selection.get("action_data", {}) or {}
            target_room = action_data.get("event_room")
            target_type = action_data.get("event_type")

            # Pretty label for events
            type_label_map = {
                "merchant": "🧙 Marchand",
                "cartographer": "🗺️ Cartographe",
                "forge": "🔥 Forge",
                "crystal": "💎 Cristal",
            }
            event_label = type_label_map.get(target_type, "Événement")

            new_room = None
            if target_room and target_type:
                new_room = relocate_event(game, target_room, target_type)

            if new_room:
                event_msg = (
                    f"↩️ {player['name']} utilise Secousse ! "
                    f"L'événement {event_label} a été déplacé de « {target_room} » vers « {new_room} »."
                )
            else:
                event_msg = (
                    f"↩️ {player['name']} utilise Secousse mais l'événement n'a pas pu être déplacé."
                )

            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
            # Broadcast updated state to killers immediately so the new event position is visible
            if new_room:
                await broadcast_to_session(session_id, {"type": "state_update", "game": game}, role_filter="killer")
        
        elif power_name == "piege":
            # Trap selected rooms (Blizzard)
            killer_player = game["players"].get(player_id)
            power_evolution = (killer_player or {}).get("powers_evolution", {}).get("piege", {})
            variant = power_evolution.get("variant")

            action_data = selection.get("action_data", {})
            trapped_rooms = action_data.get("rooms", [])

            for room_name in trapped_rooms:
                if room_name in game["rooms"]:
                    game["rooms"][room_name]["trapped"] = True
                    # Store which killer (and variant) set this trap for precision alert
                    game["rooms"][room_name]["blizzard_killer_id"] = player_id
                    game["rooms"][room_name]["blizzard_variant"] = variant

            game["active_powers"][power_name]["data"]["trapped_rooms"] = trapped_rooms

            event_msg = f"🥶 {player['name']} utilise Blizzard !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

            # Trigger specialization choice at level 1
            if killer_player and "powers_evolution" in killer_player:
                power_data = killer_player["powers_evolution"].get("piege", {})
                current_level = power_data.get("level", 1)
                if current_level == 1 and not power_data.get("specialization_triggered", False):
                    power_data["specialization_triggered"] = True
                    game["pending_specializations"] = game.get("pending_specializations", {})
                    game["pending_specializations"][player_id] = {
                        "power": "piege",
                        "specializations": {
                            "masse": {
                                "name": "Blizzard de masse",
                                "description": "Sélectionnez 1 pièce supplémentaire pour chaque tour écoulé (jusqu'au double de la valeur de base).",
                                "video_path": "/powers/Blizzard de masse.mp4"
                            },
                            "precision": {
                                "name": "Blizzard de précision",
                                "description": "Vous êtes alerté dès qu'un aventurier tombe dans votre blizzard.",
                                "video_path": "/powers/Blizzard de précision.mp4"
                            }
                        }
                    }
                    logger.info(f"🥶 Spécialisation Blizzard disponible pour {killer_player['name']}")
        
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

            # Trigger specialization choice at level 1 (first use)
            killer_player = game["players"].get(player_id)
            power_data = game["pending_power_selections"].get(player_id, {})
            if killer_player and "powers_evolution" in killer_player:
                power_evolution_check = killer_player["powers_evolution"].get("toxine", {})
                current_level = power_evolution_check.get("level", 1)
                if current_level == 1 and not power_data.get("specialization_triggered", False):
                    power_data["specialization_triggered"] = True
                    game["pending_specializations"] = game.get("pending_specializations", {})
                    game["pending_specializations"][player_id] = {
                        "power": "toxine",
                        "specializations": {
                            "suffocante": {
                                "name": "Toxine suffocante",
                                "description": "Vous entendez désormais tousser bruyamment dans l'étage du joueur contaminé.",
                                "video_path": "/powers/Toxine suffocante.mp4"
                            },
                            "incapacitante": {
                                "name": "Toxine incapacitante",
                                "description": "Un joueur atteint de la toxine reçoit un malus de 50 % de dégâts.",
                                "video_path": "/powers/Toxine incapacitante.mp4"
                            }
                        }
                    }
                    logger.info(f"😷 Spécialisation Toxine disponible pour {killer_player['name']}")
        
        elif power_name == "traque":
            killer_player = game["players"].get(player_id)
            power_evolution = (killer_player or {}).get("powers_evolution", {}).get("traque", {})
            variant = power_evolution.get("variant")

            action_data = selection.get("action_data", {})

            if variant == "masse":
                # ── Traque de masse : révèle tous les aventuriers, étage par étage ──
                # Build a mapping floor → list of player names
                floor_to_players = {}
                for pid, p in game["players"].items():
                    if p.get("role") == "survivor" and not p.get("eliminated", False):
                        pending = game.get("pending_actions", {}).get(pid)
                        room_name = (pending or {}).get("room") or p.get("current_room")
                        if room_name and room_name in game["rooms"]:
                            floor_key = game["rooms"][room_name]["floor"]
                            floor_to_players.setdefault(floor_key, []).append(p["name"])

                floor_order = ["upper_floor", "ground_floor", "basement"]
                if floor_to_players:
                    parts = []
                    for fl in floor_order:
                        if fl in floor_to_players:
                            names = " et ".join(floor_to_players[fl])
                            parts.append(f"{names} {'se trouve' if len(floor_to_players[fl]) == 1 else 'se trouvent'} {floor_names.get(fl, fl)}")
                    sound_event_msg = "👥 " + ", ".join(parts) + "."
                else:
                    sound_event_msg = "🤫 Aucun aventurier détecté dans le donjon."

                game["events"].append({"message": sound_event_msg, "type": "sound_clue", "for_role": "killer"})
                await broadcast_to_session(session_id, {
                    "type": "traque_result",
                    "message": sound_event_msg,
                    "video_path": "/powers/Traque de masse.mp4"
                }, role_filter="killer")

            elif variant == "precision":
                # ── Traque de précision : révèle les salles précises + avatars ──
                selected_floor = action_data.get("floor")
                if selected_floor:
                    floor_name_fr = floor_names.get(selected_floor, selected_floor)
                    detected = []
                    for pid, p in game["players"].items():
                        if p.get("role") == "survivor" and not p.get("eliminated", False):
                            pending = game.get("pending_actions", {}).get(pid)
                            room_name = (pending or {}).get("room") or p.get("current_room")
                            if room_name and room_name in game["rooms"]:
                                if game["rooms"][room_name]["floor"] == selected_floor:
                                    detected.append({
                                        "name": p["name"],
                                        "room": room_name,
                                        "avatar": p.get("avatar", "")
                                    })

                    if detected:
                        parts = [f"{d['name']} dans {d['room']}" for d in detected]
                        sound_event_msg = f"🔍 {floor_name_fr} — " + ", ".join(parts) + "."
                    else:
                        sound_event_msg = f"🤫 Aucun aventurier détecté {floor_name_fr}."

                    game["events"].append({"message": sound_event_msg, "type": "sound_clue", "for_role": "killer"})
                    await broadcast_to_session(session_id, {
                        "type": "traque_result",
                        "message": sound_event_msg,
                        "video_path": "/powers/Traque de précision.mp4",
                        "avatars": [d["avatar"] for d in detected] if detected else []
                    }, role_filter="killer")

            else:
                # ── Traque de base (niveau 1) : révèle présence par étage ──
                selected_floor = action_data.get("floor")
                if selected_floor:
                    floor_hints = get_survivor_floor_hints(game)
                    floor_name_fr = floor_names.get(selected_floor, selected_floor)
                    if selected_floor in floor_hints:
                        sound_event_msg = f"👂 Vous entendez du bruit {floor_name_fr}... Des aventuriers sont présents !"
                    else:
                        sound_event_msg = f"🤫 Aucun bruit {floor_name_fr}... Aucun aventurier détecté."
                    game["events"].append({"message": sound_event_msg, "type": "sound_clue", "for_role": "killer"})
                    await broadcast_to_session(session_id, {
                        "type": "traque_result",
                        "message": sound_event_msg,
                        "video_path": "/powers/Traque.mp4"
                    }, role_filter="killer")

            event_msg = f"🔊 {player['name']} utilise Traque !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

            # Mark action complete
            if player_id in game["pending_power_selections"]:
                game["pending_power_selections"][player_id]["action_complete"] = True

            # Trigger specialization if level 1
            power_data = game["pending_power_selections"].get(player_id, {})
            if killer_player and "powers_evolution" in killer_player:
                power_evolution_check = killer_player["powers_evolution"].get("traque", {})
                current_level = power_evolution_check.get("level", 1)
                if current_level == 1 and not power_data.get("specialization_triggered", False):
                    power_data["specialization_triggered"] = True
                    game["pending_specializations"] = game.get("pending_specializations", {})
                    game["pending_specializations"][player_id] = {
                        "power": "traque",
                        "specializations": {
                            "precision": {
                                "name": "Traque de précision",
                                "description": "Révèle les salles précises des aventuriers sur l'étage sélectionné, ainsi que leurs avatars.",
                                "video_path": "/powers/Traque de précision.mp4"
                            },
                            "masse": {
                                "name": "Traque de masse",
                                "description": "Révèle la position de tous les aventuriers, étage par étage, sans sélectionner d'étage.",
                                "video_path": "/powers/Traque de masse.mp4"
                            }
                        }
                    }
                    logger.info(f"🔮 Spécialisation Traque disponible pour {killer_player['name']}")
        
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
            
            # Check for specialization variant
            killer_player = game["players"].get(player_id)
            power_evolution = (killer_player or {}).get("powers_evolution", {}).get("mimic", {})
            variant = power_evolution.get("variant")
            
            # Apply variant effects
            mimic_hp_multiplier = 2 if variant == "robuste" else 1
            mimic_duration_extra = 0
            
            if variant == "invasive":
                # Expand to 5 mimics if fewer selected
                if len(mimic_rooms) < 5:
                    available_rooms = [r for r in game["rooms"].keys()
                                       if not game["rooms"][r].get("has_mimic")
                                       and r not in mimic_rooms]
                    additional = min(5 - len(mimic_rooms), len(available_rooms))
                    mimic_rooms = list(mimic_rooms) + available_rooms[:additional]
                mimic_duration_extra = 1
                logger.info(f"🔮 Variant Invasive: {len(mimic_rooms)} mimics, durée +1 tour")
            elif variant == "robuste":
                logger.info(f"🔮 Variant Robuste: Mimics ont 2× HP et initiative")
            
            for room_name in mimic_rooms:
                if room_name in game["rooms"]:
                    game["rooms"][room_name]["has_mimic"] = True
                    game["rooms"][room_name]["mimic_hp_multiplier"] = mimic_hp_multiplier
                    game["rooms"][room_name]["mimic_has_initiative"] = (variant == "robuste")
                    game["rooms"][room_name]["mimic_duration_extra"] = mimic_duration_extra
            
            game["active_powers"][power_name]["data"]["mimic_rooms"] = mimic_rooms
            
            variant_text = ""
            if variant == "robuste":
                variant_text = " (Robuste - 2× HP)"
            elif variant == "invasive":
                variant_text = f" (Invasive - {len(mimic_rooms)} mimics, +1 tour)"
            
            event_msg = f"💰 {player['name']} utilise Mimic{variant_text} !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
            
            # Mark power as used
            power_data = game["pending_power_selections"].get(player_id, {})
            power_data["action_complete"] = True

            # NEW: Check if power can be specialized (level 1 only, and not already triggered)
            if killer_player and "powers_evolution" in killer_player:
                power_evolution_check = killer_player["powers_evolution"].get("mimic", {})
                current_level = power_evolution_check.get("level", 1)

                # Only trigger specialization if level 1 and not already triggered this turn
                if current_level == 1 and not power_data.get("specialization_triggered", False):
                    # Mark as triggered to avoid re-triggering
                    power_data["specialization_triggered"] = True

                    # Trigger specialization phase AFTER resolution
                    game["pending_specializations"] = game.get("pending_specializations", {})
                    game["pending_specializations"][player_id] = {
                        "power": "mimic",
                        "specializations": {
                            "robuste": {
                                "name": "Mimic Robuste",
                                "description": "Les mimics ont 2× plus de points de vie et ont l'initiative en combat",
                                "video_path": "/powers/Mimic Robuste.mp4"
                            },
                            "invasive": {
                                "name": "Mimic Invasive",
                                "description": "Place 5 mimics qui restent un tour supplémentaire",
                                "video_path": "/powers/Mimic Invasive.mp4"
                            }
                        }
                    }

                    logger.info(f"🔮 Spécialisation Mimic disponible pour {killer_player['name']}")
        
        elif power_name == "teleportation":
            # Set teleportation trap (entrance) and exit portal in selected rooms
            action_data = selection.get("action_data", {})
            trap_room = action_data.get("trap_room")
            exit_room = action_data.get("exit_room")
            # Variant "masse" supports multiple trap rooms
            trap_rooms = action_data.get("trap_rooms", [])

            # Check for specialization variant
            killer_player = game["players"].get(player_id)
            power_evolution = (killer_player or {}).get("powers_evolution", {}).get("teleportation", {})
            variant = power_evolution.get("variant")

            if variant == "masse" and trap_rooms and exit_room and exit_room in game["rooms"]:
                # Mass variant: up to 3 entrance traps → same exit
                for tr in trap_rooms:
                    if tr and tr in game["rooms"]:
                        game["rooms"][tr]["teleportation_trap"] = True
                        game["rooms"][tr]["teleportation_target_room"] = exit_room
                        # Mark duration flag for durable stacking (durable + masse would still work)
                        game["rooms"][tr]["teleportation_duration_extra"] = 0
                game["rooms"][exit_room]["teleportation_exit"] = True
                game["active_powers"][power_name]["data"]["trap_rooms"] = trap_rooms
                game["active_powers"][power_name]["data"]["trap_room"] = trap_rooms[0] if trap_rooms else None
                game["active_powers"][power_name]["data"]["exit_room"] = exit_room
            elif trap_room and trap_room in game["rooms"] and exit_room and exit_room in game["rooms"]:
                # Standard variant (or "durable")
                game["rooms"][trap_room]["teleportation_trap"] = True
                game["rooms"][trap_room]["teleportation_target_room"] = exit_room
                # Durable variant: trap stays 1 extra turn
                if variant == "durable":
                    game["rooms"][trap_room]["teleportation_duration_extra"] = 1
                else:
                    game["rooms"][trap_room]["teleportation_duration_extra"] = 0
                game["rooms"][exit_room]["teleportation_exit"] = True
                game["active_powers"][power_name]["data"]["trap_room"] = trap_room
                game["active_powers"][power_name]["data"]["exit_room"] = exit_room

            variant_text = ""
            if variant == "durable":
                variant_text = " (Durable - +1 tour)"
            elif variant == "masse":
                count = len(trap_rooms) if trap_rooms else 1
                variant_text = f" (Masse - {count} pièges → 1 sortie)"

            event_msg = f"🌀 {player['name']} utilise Piège de Téléportation{variant_text} !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

            # Mark power as used (identical to Mimic block)
            power_data = game["pending_power_selections"].get(player_id, {})
            power_data["action_complete"] = True

            # NEW: Check if power can be specialized (level 1 only, not already triggered)
            if killer_player and "powers_evolution" in killer_player:
                power_evolution_check = killer_player["powers_evolution"].get("teleportation", {})
                current_level = power_evolution_check.get("level", 1)

                if current_level == 1 and not power_data.get("specialization_triggered", False):
                    power_data["specialization_triggered"] = True

                    game["pending_specializations"] = game.get("pending_specializations", {})
                    game["pending_specializations"][player_id] = {
                        "power": "teleportation",
                        "specializations": {
                            "durable": {
                                "name": "Téléportation durable",
                                "description": "Le piège de téléportation reste un tour supplémentaire.",
                                "video_path": "/powers/Teleportation durable.mp4"
                            },
                            "masse": {
                                "name": "Téléportation de masse",
                                "description": "Vous placez désormais 3 pièges ➡️🌀 pour téléporter vers une seule pièce.",
                                "video_path": "/powers/Teleportation de masse.mp4"
                            }
                        }
                    }

                    logger.info(f"🔮 Spécialisation Téléportation disponible pour {killer_player['name']}")
        
        elif power_name == "goliath":
            # Activer la Poursuite pour 3 tours
            poursuite_duration = 3
            game["goliath_active"] = True
            game["goliath_turns_remaining"] = poursuite_duration
            # Peupler immédiatement avec les pièces choisies CE tour par les survivants,
            # afin que le check soit effectif dès le prochain tour du killer (même tour d'activation).
            current_turn_rooms = []
            for pid, action in game.get("pending_actions", {}).items():
                if pid in game["players"] and game["players"][pid]["role"] == "survivor":
                    room_selected = action.get("room")
                    if room_selected and room_selected not in current_turn_rooms:
                        current_turn_rooms.append(room_selected)
            game["goliath_previous_turn_rooms"] = current_turn_rooms
            
            # Événement pour les killers
            event_msg = f"⚔️ {player['name']} utilise La Poursuite !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")
            
            # Événement pour tous (apparition)
            poursuite_spawn_msg = "⚔️ La Poursuite est lancée pour 3 tours !"
            game["events"].append({"message": poursuite_spawn_msg, "type": "poursuite_spawned"})
            await broadcast_to_session(session_id, {"type": "event", "message": poursuite_spawn_msg})
            
            # Popup vidéo pour tous les survivants
            await broadcast_to_session(session_id, {
                "type": "poursuite_spawned",
                "message": "Durant 3 tours, choisir une pièce déjà visitée par vos alliés ou vous-même au tour précédent déclenche un combat.",
                "video_path": "/event/Poursuite.mp4",
                "duration": poursuite_duration
            }, role_filter="survivor")

            # Spécialisation disponible au niveau 1 (premier usage)
            if player and "powers_evolution" in player:
                poursuite_evo = player["powers_evolution"].get("goliath", {})
                current_level = poursuite_evo.get("level", 1)
                if current_level == 1 and not selection.get("specialization_triggered", False):
                    if player_id in game["pending_power_selections"]:
                        game["pending_power_selections"][player_id]["specialization_triggered"] = True
                    game["pending_specializations"] = game.get("pending_specializations", {})
                    game["pending_specializations"][player_id] = {
                        "power": "goliath",
                        "specializations": {
                            "endurante": {
                                "name": "⚔️ Poursuite Endurante",
                                "description": "La Poursuite dure désormais 2 tours supplémentaires.",
                                "video_path": "/powers/PoursuiteEndurance.mp4"
                            },
                            "precision": {
                                "name": "⚔️ Poursuite de Précision",
                                "description": "En plus de l'effet Poursuite, 1 salle vide parmi chaque étage est désormais indiquée.",
                                "video_path": "/powers/PoursuitePrécision.mp4"
                            }
                        }
                    }
                    logger.info(f"⚔️ Spécialisation Poursuite disponible pour {player['name']}")

                elif current_level == 2 and poursuite_evo.get("variant") == "precision":
                    # Réutilisation avec variant précision : recalculer les salles vides
                    survivor_rooms = set()
                    for p in game["players"].values():
                        if p.get("role") == "survivor" and not p.get("eliminated") and p.get("current_room"):
                            survivor_rooms.add(p["current_room"])
                    for pid, action in game.get("pending_actions", {}).items():
                        if pid in game["players"] and game["players"][pid].get("role") == "survivor":
                            room_selected = action.get("room")
                            if room_selected:
                                survivor_rooms.add(room_selected)

                    floors_order = ["upper_floor", "ground_floor", "basement"]
                    empty_rooms_by_floor = {}
                    for floor_key in floors_order:
                        candidates = [
                            room_name for room_name, room_data in game["rooms"].items()
                            if room_data.get("floor") == floor_key
                            and not room_data.get("locked")
                            and room_name not in survivor_rooms
                        ]
                        if candidates:
                            empty_rooms_by_floor[floor_key] = random.choice(candidates)

                    revealed = list(empty_rooms_by_floor.values())
                    game["poursuite_precision_empty_rooms"] = revealed

                    floor_labels = {"upper_floor": "Étage", "ground_floor": "Rez-de-chaussée", "basement": "Sous-sol"}
                    revealed_names = ", ".join(
                        f"{empty_rooms_by_floor[f]} ({floor_labels.get(f, f)})"
                        for f in floors_order if f in empty_rooms_by_floor
                    )
                    precision_msg = f"⚔️ Poursuite de Précision ! Salles sans aventuriers : {revealed_names}."
                    game["events"].append({"message": precision_msg, "type": "poursuite_status", "for_role": "killer"})
                    await broadcast_to_session(session_id, {"type": "event", "message": precision_msg}, role_filter="killer")
                    logger.info(f"⚔️ Poursuite Précision (réutilisation) : salles vides → {revealed}")
        
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

            # ── Variant: Séisme — inform killer of adventurers per floor ──
            killer_player = game["players"].get(player_id)
            eboulement_variant = (killer_player or {}).get("powers_evolution", {}).get("eboulement", {}).get("variant")

            if eboulement_variant == "seisme":
                floor_names = {
                    "basement": "🕳️ Sous-sol",
                    "ground_floor": "🏰 Rez-de-chaussée",
                    "upper_floor": "🕯️ Étage"
                }
                # Build floor -> list of survivor names mapping (from pending_actions or current_room)
                floor_to_survivors = {}
                for sid, sp in game["players"].items():
                    if sp.get("role") == "survivor" and not sp.get("eliminated", False):
                        # Prefer the room they are moving to this turn
                        pending_action = game.get("pending_actions", {}).get(sid, {})
                        room = pending_action.get("room") or sp.get("current_room")
                        if room and room in game["rooms"]:
                            floor_key = game["rooms"][room]["floor"]
                            floor_to_survivors.setdefault(floor_key, []).append(sp["name"])
                # Build message
                occupied_floors = [f for f in ["upper_floor", "ground_floor", "basement"] if floor_to_survivors.get(f)]
                if occupied_floors:
                    floor_parts = [floor_names.get(f, f) for f in occupied_floors]
                    if len(floor_parts) == 1:
                        seisme_msg = f"⛰️ Vous entendez des aventuriers s'extirper des débris dans {floor_parts[0]}."
                    elif len(floor_parts) == 2:
                        seisme_msg = f"⛰️ Vous entendez des aventuriers s'extirper des débris dans {floor_parts[0]} et {floor_parts[1]}."
                    else:
                        seisme_msg = f"⛰️ Vous entendez des aventuriers s'extirper des débris dans {floor_parts[0]}, {floor_parts[1]} et {floor_parts[2]}."
                else:
                    seisme_msg = "⛰️ Silence total... Aucun aventurier détecté dans les décombres."
                game["events"].append({"message": seisme_msg, "type": "seisme_detection", "for_role": "killer"})
                await broadcast_to_session(session_id, {"type": "event", "message": seisme_msg}, role_filter="killer")
                logger.info(f"⛰️ Séisme : étages avec aventuriers → {occupied_floors}")

            # ── Variant: Perturbation — apply initiative malus and double damage to survivors ──
            if eboulement_variant == "perturbation":
                for sid, sp in game["players"].items():
                    if sp.get("role") == "survivor" and not sp.get("eliminated", False):
                        sp["initiative_bonus"] = sp.get("initiative_bonus", 0) - 15
                        sp["eboulement_perturbation_active"] = True
                game["eboulement_perturbation_active"] = True
                logger.info("⛰️ Perturbation : malus initiative -15 et dégâts ×2 appliqués aux survivants")

            # Événement pour les killers
            event_msg = f"⛰️ {player['name']} utilise Eboulement !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

            # Log event for everyone
            if eboulement_variant == "perturbation":
                eboulement_msg = "⛰️ Un éboulement bloque les escaliers pour 1 tour ! Les aventuriers sont perturbés !"
            else:
                eboulement_msg = "⛰️ Un éboulement bloque les escaliers pour 1 tour !"
            game["events"].append({"message": eboulement_msg, "type": "eboulement_activated"})
            await broadcast_to_session(session_id, {"type": "event", "message": eboulement_msg})

            # Popup vidéo pour tous les survivants
            if eboulement_variant == "perturbation":
                await broadcast_to_session(session_id, {
                    "type": "eboulement_activated",
                    "message": "Un éboulement bloque les escaliers ! Vous êtes perturbé : -15 en initiative et dégâts reçus doublés ce tour-ci !",
                    "video_path": "/powers/Perturbation.mp4"
                }, role_filter="survivor")
            elif eboulement_variant == "seisme":
                await broadcast_to_session(session_id, {
                    "type": "eboulement_activated",
                    "message": "Un éboulement secoue le donjon ! Vous ne pouvez pas changer d'étage ce tour-ci.",
                    "video_path": "/powers/Séisme.mp4"
                }, role_filter="survivor")
            else:
                await broadcast_to_session(session_id, {
                    "type": "eboulement_activated",
                    "message": "Un éboulement bloque les escaliers ! Vous ne pouvez pas changer d'étage ce tour-ci.",
                    "video_path": "/powers/Eboulement.mp4"
                }, role_filter="survivor")

            # ── Trigger specialization choice at level 1 ──
            if killer_player and "powers_evolution" in killer_player:
                power_data = killer_player["powers_evolution"].get("eboulement", {})
                current_level = power_data.get("level", 1)
                if current_level == 1 and not power_data.get("specialization_triggered", False):
                    power_data["specialization_triggered"] = True
                    game["pending_specializations"] = game.get("pending_specializations", {})
                    game["pending_specializations"][player_id] = {
                        "power": "eboulement",
                        "specializations": {
                            "seisme": {
                                "name": "⛰️ Séisme",
                                "description": "L'éboulement informe désormais de la présence d'aventuriers dans chaque étage. Vous entendez les survivants s'extirper des décombres.",
                                "video_path": "/powers/Séisme.mp4"
                            },
                            "perturbation": {
                                "name": "⛰️ Perturbation",
                                "description": "Durant l'éboulement, tous les aventuriers subissent -15 en initiative et reçoivent 2× plus de dégâts.",
                                "video_path": "/powers/Perturbation.mp4"
                            }
                        }
                    }
                    logger.info(f"⛰️ Spécialisation Éboulement disponible pour {killer_player['name']}")
        
        elif power_name == "patrouille":
            killer_player = game["players"].get(player_id)
            power_evolution = (killer_player or {}).get("powers_evolution", {}).get("patrouille", {})
            variant = power_evolution.get("variant")  # None | "patrouille" | "vadrouille"

            patrol = game.get("patrouille_patrol")
            gobelin_actif = patrol and patrol.get("active", False)

            if variant is None:
                # ── BASE: Espionnage ──
                # Place gobelin in selected room (new position)
                action_data = selection.get("action_data", {})
                patrol_room = action_data.get("room")

                if patrol_room and patrol_room in game["rooms"]:
                    # Clear previous patrol room flag if any
                    if patrol and patrol.get("room") and patrol["room"] in game["rooms"]:
                        game["rooms"][patrol["room"]]["has_patrol"] = False
                    patrol_floor = game["rooms"][patrol_room]["floor"]
                    game["patrouille_patrol"] = {
                        "room": patrol_room,
                        "floor": patrol_floor,
                        "active": True,
                        "variant": None  # base: presence only
                    }
                    game["rooms"][patrol_room]["has_patrol"] = True

                game["active_powers"][power_name]["data"]["patrol_room"] = patrol_room if patrol_room else None

                event_msg = f"🔍 {player['name']} utilise Espionnage !"
                game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
                await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

                # Propose specialization only if level 1, gobelin NOW active (evaluated after placement), not triggered yet
                gobelin_now_active = (
                    game.get("patrouille_patrol") is not None
                    and game["patrouille_patrol"].get("active", False)
                )
                power_data = game["pending_power_selections"].get(player_id, {})
                if (killer_player and
                        power_evolution.get("level", 1) == 1 and
                        gobelin_now_active and
                        not power_data.get("specialization_triggered", False)):
                    power_data["specialization_triggered"] = True
                    game["pending_specializations"] = game.get("pending_specializations", {})
                    game["pending_specializations"][player_id] = {
                        "power": "patrouille",
                        "specializations": {
                            "patrouille": {
                                "name": "Patrouille",
                                "description": "Révèle la position des joueurs dans son étage tant qu'il n'est pas trouvé.",
                                "video_path": "/powers/Patrouille.mp4"
                            },
                            "vadrouille": {
                                "name": "Vadrouille",
                                "description": "Révèle la présence de joueurs sur chaque étage tant qu'il n'est pas trouvé.",
                                "video_path": "/powers/Vadrouille.mp4"
                            }
                        }
                    }
                    logger.info(f"🔮 Spécialisation Espionnage disponible pour {killer_player['name']} (gobelin actif)")

            else:
                # ── SPECIALISÉ: Patrouille ou Vadrouille ──
                # No new placement — apply variant effect to the existing gobelin
                if gobelin_actif:
                    game["patrouille_patrol"]["variant"] = variant
                    variant_label = "Patrouille" if variant == "patrouille" else "Vadrouille"
                    event_msg = f"🔍 {player['name']} utilise {variant_label} !"
                else:
                    # Gobelin was found — fallback: place a new one (Espionnage behaviour)
                    action_data = selection.get("action_data", {})
                    patrol_room = action_data.get("room")
                    if patrol_room and patrol_room in game["rooms"]:
                        patrol_floor = game["rooms"][patrol_room]["floor"]
                        game["patrouille_patrol"] = {
                            "room": patrol_room,
                            "floor": patrol_floor,
                            "active": True,
                            "variant": variant
                        }
                        game["rooms"][patrol_room]["has_patrol"] = True
                    variant_label = "Patrouille" if variant == "patrouille" else "Vadrouille"
                    event_msg = f"🔍 {player['name']} utilise {variant_label} (nouveau gobelin) !"

                game["active_powers"][power_name]["data"]["patrol_room"] = game["patrouille_patrol"].get("room") if game.get("patrouille_patrol") else None

                game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
                await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

        elif power_name == "malediction":
            # La sélection de la cible est gérée via curse_item / curse_item_masse dans le WebSocket.
            # apply_powers ne fait qu'enregistrer l'event ; le payload power_action_required
            # a déjà été envoyé dans select_power avec la liste cursable_survivors à jour.
            event_msg = f"🔮 {player['name']} invoque la Malédiction !"
            game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

            # ── Specialization trigger (level 1 only) ──
            if "powers_evolution" in player:
                power_evolution_check = player["powers_evolution"].get("malediction", {})
                current_level = power_evolution_check.get("level", 1)
                if current_level == 1 and not selection.get("specialization_triggered", False):
                    selection["specialization_triggered"] = True
                    game["pending_specializations"] = game.get("pending_specializations", {})
                    game["pending_specializations"][player_id] = {
                        "power": "malediction",
                        "specializations": {
                            "incertaine": {
                                "name": "🔮 Malédiction Incertaine",
                                "description": "Tous les objets maudissables de l'inventaire ciblé semblent désormais maudits : les aventuriers ne savent plus lequel est réellement maudit.",
                                "video_path": "/powers/MalédictionIncertaine.mp4"
                            },
                            "masse": {
                                "name": "🔮 Malédiction de Masse",
                                "description": "Maudissez simultanément un objet dans l'inventaire de chaque aventurier.",
                                "video_path": "/powers/MalédictionDeMasse.mp4"
                            }
                        }
                    }
                    logger.info(f"🔮 Spécialisation Malédiction disponible pour {player['name']}")


def filter_game_state(game_state: dict, player_role: str, player_id: Optional[str] = None) -> dict:
    """
    Filter game state based on player role for visibility rules:
    - Survivors see: other survivors' positions + eliminated players
    - Killers see: other killers' positions + eliminated players
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
                # Check if this survivor carries the observation stone
                carries_stone = has_item(player_data, "pierre_quete")

                if carries_stone:
                    # Reveal the room the survivor is moving to (pending_action) if available,
                    # otherwise fall back to their current_room
                    pending_action = game_state.get("pending_actions", {}).get(pid)
                    if pending_action and pending_action.get("room"):
                        player_copy["current_room"] = pending_action["room"]
                    # else: current_room already set — keep it as-is
                else:
                    player_copy["current_room"] = None

                player_copy["gold"] = 0  # Hide gold from killers
                player_copy["inventory"] = None  # Hide inventory from killers
                player_copy["has_observation_stone"] = carries_stone  # Signal to frontend why position is visible
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


async def broadcast_to_role(session_id: str, role: str, message: dict):
    """Convenience wrapper: broadcast to players of a given role."""
    await broadcast_to_session(session_id, message, role_filter=role)


async def broadcast_curse_lifted(session_id: str, game: dict, variant: Optional[str]):
    """Notify survivors when a curse has been lifted.

    For "incertaine", the entire team's curse is lifted at once (the cursed_display
    overlay disappears from every other item), so we show a popup informing everyone.
    For "normale" and "masse" the existing behaviour (silent lift) is preserved.
    """
    if variant == "incertaine":
        msg = "Vous levez la malédiction pour toute l'équipe !"
        game["events"].append({"message": f"🔮 {msg}", "type": "malediction_lifted"})
        await broadcast_to_session(session_id, {
            "type": "malediction_lifted",
            "message": msg
        }, role_filter="survivor")


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
    pending_events_queue = game.get("pending_events_queue", {})

    all_selected = len(survivors_selected) == len(alive_survivors)
    all_ended = len(survivors_ended_turn) == len(alive_survivors)
    no_pending = len(pending_events) == 0 and all(
        len(q) == 0 for q in pending_events_queue.values()
    )

    if not (all_selected and all_ended and no_pending):
        return False

    logger.info("All survivors ended their turn - transitioning to killer phase")

    # MALÉDICTION: Les survivants viennent de terminer leur tour.
    # Si l'item maudit est encore dans l'inventaire → pénalité 10 PV pour tous.
    # Ce check doit se faire ICI (fin du tour survivants), PAS dans apply_powers
    # qui s'exécute dès la phase killer_power_selection (trop tôt).
    active_curse = game.get("active_curse")
    if active_curse:
        target_pid = active_curse.get("target_player_id")
        slot_idx = active_curse.get("slot_index")
        target_player = game["players"].get(target_pid)
        curse_still_active = False

        if target_player and not target_player.get("eliminated", False):
            inv = target_player.get("inventory") or []
            if slot_idx is not None and 0 <= slot_idx < len(inv):
                slot = inv[slot_idx]
                if slot and slot.get("cursed"):
                    curse_still_active = True

        if curse_still_active:
            # Appliquer 10 PV de pénalité à tous les survivants en vie
            alive_survivors_list = [
                p for p in game["players"].values()
                if p["role"] == "survivor" and not p.get("eliminated", False)
            ]
            for sp in alive_survivors_list:
                sp["hp"] = max(0, (sp.get("hp") or 0) - 10)
                if sp["hp"] <= 0 and not sp.get("eliminated", False):
                    sp["eliminated"] = True
                # Track for Vision Accumulative
                sp_id = next((pid for pid, p in game["players"].items() if p is sp), None)
                if sp_id:
                    if "turn_survivors_damaged" not in game:
                        game["turn_survivors_damaged"] = {}
                    game["turn_survivors_damaged"][sp_id] = sp.get("current_room")

            penalty_msg = "L'objet maudit est encore dans l'inventaire, vous perdez tous 10 points de vie : débarrassez vous en !"
            game["events"].append({"message": f"🔮 {penalty_msg}", "type": "malediction_penalty"})

            await broadcast_to_session(session_id, {
                "type": "malediction_penalty",
                "message": penalty_msg,
                "video_path": "/powers/Malediction.mp4"
            }, role_filter="survivor")

            await broadcast_to_session(session_id, {"type": "state_update", "game": game})
            logger.info("Malédiction penalty applied: 10 HP removed from all survivors")
            # Renvoyer aussi le popup d'avertissement pour le prochain tour
            warning_msg = "L'un de vous a son inventaire maudit ! Utilisez ou débarrassez vous de l'objet maudit avant la fin de votre tour pour lever la malédiction , sous peine de perdre 10 points de vie vous et vos coéquipiers !"
            await broadcast_to_session(session_id, {
                "type": "malediction_warning",
                "message": warning_msg,
                "video_path": "/powers/Malediction.mp4"
            }, role_filter="survivor")
        else:
            # Item supprimé/utilisé pendant le tour — malédiction levée, pas de pénalité
            logger.info("Malédiction: cursed item was removed, no penalty")
            # On efface la malédiction seulement si l'item a été retiré
            game.pop("active_curse", None)
        # Si l'item est ENCORE là (curse_still_active), on NE PAS effacer active_curse :
        # la malédiction persiste et sera réévaluée au tour suivant.

    # MALÉDICTION DE MASSE : chaque malédiction encore active inflige 10 PV
    # uniquement à l'aventurier concerné (les autres ne sont pas affectés).
    active_curses = game.get("active_curses")
    if active_curses:
        remaining_curses = []
        penalized_names = []
        for curse in active_curses:
            target_pid = curse.get("target_player_id")
            slot_idx = curse.get("slot_index")
            target_player = game["players"].get(target_pid)
            curse_still_active = False

            if target_player and not target_player.get("eliminated", False):
                inv = target_player.get("inventory") or []
                if slot_idx is not None and 0 <= slot_idx < len(inv):
                    slot = inv[slot_idx]
                    if slot and slot.get("cursed"):
                        curse_still_active = True

            if curse_still_active:
                target_player["hp"] = max(0, (target_player.get("hp") or 0) - 10)
                if target_player["hp"] <= 0 and not target_player.get("eliminated", False):
                    target_player["eliminated"] = True
                if "turn_survivors_damaged" not in game:
                    game["turn_survivors_damaged"] = {}
                game["turn_survivors_damaged"][target_pid] = target_player.get("current_room")
                penalized_names.append(target_player["name"])
                remaining_curses.append(curse)
            else:
                # Objet maudit utilisé/détruit/vendu pendant le tour — malédiction levée
                # pour cet aventurier uniquement, pas de pénalité pour lui.
                logger.info(f"Malédiction de Masse: cursed item lifted for player {target_pid}, no penalty")

        if remaining_curses:
            game["active_curses"] = remaining_curses
            names_str = ", ".join(penalized_names)
            penalty_msg = f"Des objets maudits sont encore dans vos inventaires : {names_str} perd(ent) 10 points de vie !"
            game["events"].append({"message": f"🔮 {penalty_msg}", "type": "malediction_penalty"})

            await broadcast_to_session(session_id, {
                "type": "malediction_penalty",
                "message": penalty_msg,
                "video_path": "/powers/MalédictionDeMasse.mp4"
            }, role_filter="survivor")

            await broadcast_to_session(session_id, {"type": "state_update", "game": game})
            logger.info(f"Malédiction de Masse penalty applied to: {names_str}")

            warning_msg = "Certains d'entre vous ont leur inventaire maudit ! Utilisez ou débarrassez vous de votre objet maudit avant la fin de votre tour, sous peine de perdre 10 points de vie !"
            await broadcast_to_session(session_id, {
                "type": "malediction_warning",
                "message": warning_msg,
                "video_path": "/powers/MalédictionDeMasse.mp4"
            }, role_filter="survivor")
        else:
            game.pop("active_curses", None)


    # Broadcast latest state before phase change
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })
    await asyncio.sleep(2)

    # Clear traps, teleportation, and untriggered mimics from previous survivor turn.
    # Mimics not triggered (survivor didn't enter their room) disappear here,
    # UNLESS mimic_duration_extra > 0 (Invasive variant: stays 1 extra turn).
    mimics_cleared = 0
    for room_data in game["rooms"].values():
        room_data["trapped"] = False
        room_data.pop("trap_triggered", None)
        # Teleportation: handle "durable" variant (stays 1 extra turn)
        if room_data.get("teleportation_trap", False):
            extra = room_data.get("teleportation_duration_extra", 0)
            if extra > 0:
                room_data["teleportation_duration_extra"] = extra - 1
                logger.info(f"Téléportation Durable: durée restante {extra - 1} tour(s), conservé")
            else:
                room_data["teleportation_trap"] = False
                room_data["teleportation_exit"] = False
                room_data["teleportation_target_room"] = None
                room_data.pop("teleportation_duration_extra", None)
        else:
            room_data["teleportation_exit"] = False
            room_data["teleportation_target_room"] = None
            room_data.pop("teleportation_duration_extra", None)
        if room_data.get("has_mimic", False):
            extra = room_data.get("mimic_duration_extra", 0)
            if extra > 0:
                # Décrémenter le compteur — le mimic reste ce tour
                room_data["mimic_duration_extra"] = extra - 1
                logger.info(f"Mimic Invasive: durée restante {extra - 1} tour(s), conservé")
            else:
                room_data["has_mimic"] = False
                room_data.pop("mimic_hp_multiplier", None)
                room_data.pop("mimic_has_initiative", None)
                room_data.pop("mimic_duration_extra", None)
                mimics_cleared += 1
    if mimics_cleared > 0:
        logger.info(f"Cleared {mimics_cleared} untriggered mimic(s) after survivor turn")

    # POURSUITE : mémoriser les pièces visitées ce tour
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

        # PERTURBATION: remove initiative malus and damage flag from survivors
        if game.get("eboulement_perturbation_active", False):
            game["eboulement_perturbation_active"] = False
            for sp in game["players"].values():
                if sp.get("role") == "survivor" and not sp.get("eliminated", False):
                    if sp.get("eboulement_perturbation_active", False):
                        sp["initiative_bonus"] = sp.get("initiative_bonus", 0) + 15
                        sp["eboulement_perturbation_active"] = False
            logger.info("⛰️ Perturbation terminée : malus initiative +15 (annulation) et dégâts ×2 retirés")

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

    # OBSERVATION STONE ALERT: if any alive survivor carries the stone, alert each killer individually (non-blocking)
    survivors_with_stone = [
        p for p in game["players"].values()
        if p["role"] == "survivor" and not p.get("eliminated", False) and has_item(p, "pierre_quete")
    ]
    if survivors_with_stone:
        logger.info(f"Observation stone alert: {len(survivors_with_stone)} survivor(s) carrying the stone - alerting killers")
        for killer in alive_killers:
            killer_ws = active_connections.get(session_id, {}).get(killer["id"])
            if killer_ws is not None:
                try:
                    await killer_ws.send_json({
                        "type": "observation_stone_alert",
                        "message": "La pierre d'observation a révélé la position d'un aventurier !",
                        "video_path": "/alertes/Pierre_Detection.mp4"
                    })
                except Exception:
                    pass
        # Alert the survivor(s) carrying the stone that their position has been revealed
        for survivor in survivors_with_stone:
            survivor_ws = active_connections.get(session_id, {}).get(survivor["id"])
            if survivor_ws is not None:
                try:
                    await survivor_ws.send_json({
                        "type": "observation_stone_alert",
                        "message": "La pierre d'observation a révélé votre position !",
                        "video_path": "/alertes/Pierre_Detection.mp4"
                    })
                except Exception:
                    pass

    # POURSUITE DE PRÉCISION : recalculer les salles vides à chaque début de phase killer
    # Les survivants ont pu changer de salle depuis le dernier calcul — on recheck maintenant
    # que leurs pending_actions (choix de ce tour) sont connus.
    if game.get("goliath_active", False):
        precision_active = any(
            p.get("powers_evolution", {}).get("goliath", {}).get("variant") == "precision"
            for p in game["players"].values()
            if p.get("role") == "killer" and not p.get("eliminated", False)
        )
        if precision_active:
            survivor_rooms = set()
            for p in game["players"].values():
                if p.get("role") == "survivor" and not p.get("eliminated") and p.get("current_room"):
                    survivor_rooms.add(p["current_room"])
            for pid, action in game.get("pending_actions", {}).items():
                if pid in game["players"] and game["players"][pid].get("role") == "survivor":
                    room_selected = action.get("room")
                    if room_selected:
                        survivor_rooms.add(room_selected)

            floors_order = ["upper_floor", "ground_floor", "basement"]
            empty_rooms_by_floor = {}
            for floor_key in floors_order:
                candidates = [
                    room_name for room_name, room_data in game["rooms"].items()
                    if room_data.get("floor") == floor_key
                    and not room_data.get("locked")
                    and room_name not in survivor_rooms
                ]
                if candidates:
                    empty_rooms_by_floor[floor_key] = random.choice(candidates)

            revealed = list(empty_rooms_by_floor.values())
            game["poursuite_precision_empty_rooms"] = revealed

            floor_labels = {"upper_floor": "Étage", "ground_floor": "Rez-de-chaussée", "basement": "Sous-sol"}
            revealed_names = ", ".join(
                f"{empty_rooms_by_floor[f]} ({floor_labels.get(f, f)})"
                for f in floors_order if f in empty_rooms_by_floor
            )
            precision_msg = f"⚔️ Poursuite de Précision ! Salles sans aventuriers ce tour : {revealed_names}."
            game["events"].append({"message": precision_msg, "type": "poursuite_status", "for_role": "killer"})
            await broadcast_to_session(session_id, {"type": "event", "message": precision_msg}, role_filter="killer")
            logger.info(f"⚔️ Poursuite Précision (recalcul début phase killer) : salles vides → {revealed}")

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

    # Survivors interact with rooms
    # NOTE: Quest handling is now done immediately when survivor selects room (not here)
    for player_id, action in survivors_actions.items():
        player = game["players"][player_id]
        room = game["rooms"][action["room"]]


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
                                "avatar": surv_player.get("avatar", ""),
                                "poisoned_countdown": surv_player.get("poisoned_countdown", 0),  # NEW: pour toxine incapacitante
                            })

                if survivors_in_room:
                    # Créer un événement de combat multi-joueurs
                    # Pour l'instant : N survivants vs 1 gobelin (hardcodé)
                    num_goblins = 1  # TODO: rendre ce paramètre variable plus tard
                    
                    # Determine if toxine incapacitante is active (damage malus for poisoned survivors)
                    _tox_incap = False
                    for _kp in game["players"].values():
                        if _kp.get("role") == "killer":
                            if (_kp.get("powers_evolution") or {}).get("toxine", {}).get("variant") == "incapacitante":
                                _tox_incap = True
                                break

                    combat_event = {
                        "type": "multiplayer_combat",
                        "attacker_id": killer_id,
                        "attacker_class": killer.get("character_class", "Orc"),
                        "attacker_name": killer.get("name", "Orc"),
                        "survivors": survivors_in_room,  # Liste des survivants
                        "num_goblins": num_goblins,
                        "goblin_hp": 6,  # HP par gobelin
                        "turn": game["turn"],  # NOUVEAU : numéro du tour pour seed unique
                        "combat_id": f"{killer_id}_{killer_room}_{game['turn']}",  # NOUVEAU : ID unique du combat
                        "toxine_incapacitante_active": _tox_incap  # NEW: malus dégâts sur survivants empoisonnés
                    }

                    # Ajouter l'event au killer ET à tous les survivants
                    game["pending_events"][killer_id] = combat_event
                    for survivor in survivors_in_room:
                        game["pending_events"][survivor["id"]] = combat_event

                    survivor_names = ", ".join([s["name"] for s in survivors_in_room])
                    logger.info(f"⚔️ Combat multi-joueurs déclenché : {survivor_names} VS {num_goblins} Gobelin(s) dans {killer_room}")
                    
                    found_survivor = True
                    # IMPORTANT: Sortir de la boucle après avoir créé le combat
                    break# Check if this killer has rage power and found a survivor
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
    
    # Secousse power: legacy key relocation removed.
    # The new Secousse behavior is handled at power selection time (apply_powers):
    # the killer chooses an already-discovered event which is then moved to a random room.

    # Check victory conditions
    alive_survivors = [p for p in game["players"].values() if p["role"] == "survivor" and not p["eliminated"]]

    # Check if all quests AND stone quest completed, but crystal not spawned yet
    stone_quest_done = game.get("observation_stone_quest_completed", False)
    if (len(game["completed_quests"]) >= len(game["quests"]) and
            stone_quest_done and
            len(alive_survivors) > 0 and not game["crystal_spawned"]):
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
                # Apply 3 HP damage per tick (new behaviour)
                if player.get("hp") is not None:
                    _poison_dmg = 3
                    # PERTURBATION: double damage if active on this survivor
                    if player.get("eboulement_perturbation_active", False):
                        _poison_dmg = 6
                    player["hp"] = max(0, player["hp"] - _poison_dmg)
                # Track poison tick for Vision Accumulative
                if "turn_survivors_damaged" not in game:
                    game["turn_survivors_damaged"] = {}
                game["turn_survivors_damaged"][player_id] = player.get("current_room")
                
                # Check if player suffocates
                if player["poisoned_countdown"] == 0:
                    players_to_eliminate.append(player_id)
                else:
                    # Determine active toxine variant for message
                    _toxine_var = None
                    for _k in game["players"].values():
                        if _k.get("role") == "killer":
                            _toxine_var = (_k.get("powers_evolution") or {}).get("toxine", {}).get("variant")
                            if _toxine_var:
                                break
                    if _toxine_var == "suffocante":
                        _pmsg = f"😷 Vous êtes empoisonné ! Il vous reste {player['poisoned_countdown']} tour(s) avant de suffoquer. Vous perdez 3 PV à chaque tour. Votre étouffement révèle également l'étage où vous vous trouvez."
                    elif _toxine_var == "incapacitante":
                        _pmsg = f"😷 Vous êtes empoisonné ! Il vous reste {player['poisoned_countdown']} tour(s) avant de suffoquer. Vous perdez 3 PV à chaque tour. Vos dégâts sont réduits de moitié tant que vous ne trouvez pas d'antidote."
                    else:
                        _pmsg = f"😷 Vous êtes empoisonné ! Il vous reste {player['poisoned_countdown']} tour(s) avant de suffoquer. Vous perdez 3 PV à chaque tour."
                    # Send notification to poisoned survivor about remaining turns
                    if player_id in active_connections.get(session_id, {}):
                        try:
                            await active_connections[session_id][player_id].send_json({
                                "type": "poison_countdown",
                                "countdown": player["poisoned_countdown"],
                                "message": _pmsg
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
    
    # NOTE: Mimics are NOT cleared here — they persist until survivor_selection next turn.
    # Killers place mimics during killer_power_selection (this turn), then process_turn runs.
    # Survivors will encounter them at the START of the next turn (survivor_selection).
    # Untriggered mimics are cleared in try_advance_to_killer_phase after survivor actions.

    # NEW: Trigger pending specializations before starting new turn
    if "pending_specializations" in game and len(game["pending_specializations"]) > 0:
        for spec_killer_id, specialization_data in game["pending_specializations"].items():
            game["pending_events"][spec_killer_id] = {
                "type": "power_specialization",
                **specialization_data
            }

        # Clear pending specializations
        game["pending_specializations"] = {}

        # Passer en phase "killer_specialization" pour que le frontend affiche
        # la modale sans bloquer sur "Traitement en cours..."
        game["phase"] = "killer_specialization"

        # Broadcast state to trigger modals
        await broadcast_to_session(session_id, {
            "type": "state_update",
            "game": game_sessions[session_id]
        })

        logger.info("🔮 Spécialisations envoyées, attente de sélection...")

        # Don't start new turn yet, wait for specialization
        return

    # Next turn - Start with survivors selection
    game["turn"] += 1
    game["phase"] = "survivor_selection"
    game["pending_actions"] = {}
    game["turn_survivors_damaged"] = {}   # Reset for Vision Accumulative tracking
    game["turn_survivors_items_gained"] = {}  # Reset for Vision Vigilante tracking
    # NE PAS vider pending_events ici : il contient les combat_events qui viennent
    # juste d'être créés et qui doivent être livrés au frontend pour déclencher les
    # modales de combat killer ↔ survivants.
    game["survivors_ended_turn"] = []  # Reset end-turn flag for new turn
    # Clear active powers
    game["active_powers"] = {}
    game["pending_power_selections"] = {}
    # NOTE: active_curse is NOT cleared here — it is checked and cleared in try_advance_to_killer_phase
    # at the start of the next killer power selection phase.
    
    # GOLIATH: Reset kill flag for new turn
    game["goliath_killed_this_turn"] = False
    
    # PATROUILLE: Reset revealed survivors - reveal is only valid for the turn when detected
    game["patrol_revealed_survivors"] = {}
    
    # GOLIATH: Decrement turns remaining and check for expiration
    if game.get("goliath_active", False):
        game["goliath_turns_remaining"] -= 1
        
        if game["goliath_turns_remaining"] <= 0:
            # La Poursuite prend fin
            game["goliath_active"] = False
            game["goliath_turns_remaining"] = 0
            game["goliath_previous_turn_rooms"] = []
            game["poursuite_precision_empty_rooms"] = []
            
            poursuite_end_msg = "⚔️ La Poursuite prend fin."
            game["events"].append({"message": poursuite_end_msg, "type": "poursuite_disparue"})
            await broadcast_to_session(session_id, {"type": "event", "message": poursuite_end_msg})
        else:
            # Poursuite encore active, notifier les tours restants
            turns_left = game["goliath_turns_remaining"]
            poursuite_status_msg = f"⚔️ La Poursuite est active pour {turns_left} tour(s)."
            game["events"].append({"message": poursuite_status_msg, "type": "poursuite_status"})
            await broadcast_to_session(session_id, {"type": "event", "message": poursuite_status_msg})
    
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
    
    # Check if all quests AND stone quest completed, but crystal not spawned yet
    stone_quest_done = game.get("observation_stone_quest_completed", False)
    if (len(game["completed_quests"]) >= len(game["quests"]) and
            stone_quest_done and
            len(alive_survivors) > 0 and not game["crystal_spawned"]):
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
                # Apply 3 HP damage per tick (new behaviour)
                if player.get("hp") is not None:
                    _poison_dmg = 3
                    # PERTURBATION: double damage if active on this survivor
                    if player.get("eboulement_perturbation_active", False):
                        _poison_dmg = 6
                    player["hp"] = max(0, player["hp"] - _poison_dmg)
                # Track poison tick for Vision Accumulative
                if "turn_survivors_damaged" not in game:
                    game["turn_survivors_damaged"] = {}
                game["turn_survivors_damaged"][player_id] = player.get("current_room")
                
                # Check if player suffocates
                if player["poisoned_countdown"] == 0:
                    players_to_eliminate.append(player_id)
                else:
                    # Determine active toxine variant for message
                    _toxine_var = None
                    for _k in game["players"].values():
                        if _k.get("role") == "killer":
                            _toxine_var = (_k.get("powers_evolution") or {}).get("toxine", {}).get("variant")
                            if _toxine_var:
                                break
                    if _toxine_var == "suffocante":
                        _pmsg = f"😷 Vous êtes empoisonné ! Il vous reste {player['poisoned_countdown']} tour(s) avant de suffoquer. Vous perdez 3 PV à chaque tour. Votre étouffement révèle également l'étage où vous vous trouvez."
                    elif _toxine_var == "incapacitante":
                        _pmsg = f"😷 Vous êtes empoisonné ! Il vous reste {player['poisoned_countdown']} tour(s) avant de suffoquer. Vous perdez 3 PV à chaque tour. Vos dégâts sont réduits de moitié tant que vous ne trouvez pas d'antidote."
                    else:
                        _pmsg = f"😷 Vous êtes empoisonné ! Il vous reste {player['poisoned_countdown']} tour(s) avant de suffoquer. Vous perdez 3 PV à chaque tour."
                    # Send notification to poisoned survivor about remaining turns
                    if player_id in active_connections.get(session_id, {}):
                        try:
                            await active_connections[session_id][player_id].send_json({
                                "type": "poison_countdown",
                                "countdown": player["poisoned_countdown"],
                                "message": _pmsg
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
    game["pending_events_queue"] = {}  # NEW: reset queued events as well
    game["survivors_ended_turn"] = []  # Reset end-turn flag for new turn
    game["turn_survivors_damaged"] = {}   # Reset for Vision Accumulative tracking
    game["turn_survivors_items_gained"] = {}  # Reset for Vision Vigilante tracking
    # Clear active powers
    game["active_powers"] = {}
    game["pending_power_selections"] = {}
    # NOTE: active_curse is NOT cleared here — it is checked and cleared in try_advance_to_killer_phase
    # at the start of the next killer power selection phase.
    
    # GOLIATH: Reset kill flag for new turn
    game["goliath_killed_this_turn"] = False
    
    # PATROUILLE: Reset revealed survivors - reveal is only valid for the turn when detected
    game["patrol_revealed_survivors"] = {}
    
    # GOLIATH: Decrement turns remaining and check for expiration
    if game.get("goliath_active", False):
        game["goliath_turns_remaining"] -= 1
        
        if game["goliath_turns_remaining"] <= 0:
            # La Poursuite prend fin
            game["goliath_active"] = False
            game["goliath_turns_remaining"] = 0
            game["goliath_previous_turn_rooms"] = []
            game["poursuite_precision_empty_rooms"] = []
            
            poursuite_end_msg = "⚔️ La Poursuite prend fin."
            game["events"].append({"message": poursuite_end_msg, "type": "poursuite_disparue"})
            await broadcast_to_session(session_id, {"type": "event", "message": poursuite_end_msg})
        else:
            # Poursuite encore active, notifier les tours restants
            turns_left = game["goliath_turns_remaining"]
            poursuite_status_msg = f"⚔️ La Poursuite est active pour {turns_left} tour(s)."
            game["events"].append({"message": poursuite_status_msg, "type": "poursuite_status"})
            await broadcast_to_session(session_id, {"type": "event", "message": poursuite_status_msg})
    
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

    # NEW: Lobby-first — role and avatar are optional at join time
    character_class = get_avatar_class(request.player_avatar) if request.player_avatar else None

    game["players"][player_id] = {
        "id": player_id,
        "name": request.player_name,
        "avatar": request.player_avatar,          # peut être None (choisi dans le lobby)
        "character_class": character_class,        # peut être None
        "is_host": False,
        "eliminated": False,
        "current_room": None,
        "role": request.role,                      # peut être None (choisi dans le lobby)
        "immobilized_next_turn": False,
        "poisoned_countdown": 0,
        "gold": 0,
        "hp": 36 if request.role == "survivor" else None,
        "max_hp": 36 if request.role == "survivor" else None,
        "initiative_bonus": 0,
        "damage_bonus": 0,
        "inventory": [None] * 9 if request.role == "survivor" else None,
        "powers_evolution": {
            "mimic": {"level": 1, "variant": None},
            "rage": {"level": 1, "variant": None},
            "piege": {"level": 1, "variant": None},
            "toxine": {"level": 1, "variant": None},
            "vision": {"level": 1, "variant": None},
            "teleportation": {"level": 1, "variant": None},
            "goliath": {"level": 1, "variant": None},
            "eboulement": {"level": 1, "variant": None},
            "patrouille": {"level": 1, "variant": None},
            "traque": {"level": 1, "variant": None}
        } if request.role == "killer" else None,
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

@api_router.post("/game/{session_id}/update_settings")
async def update_game_settings(session_id: str, request: UpdateGameSettingsRequest):
    """NEW: l'hôte modifie les paramètres de la partie (reliques requises) dans la salle d'attente."""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    game = game_sessions[session_id]
    
    if game["game_started"]:
        raise HTTPException(status_code=400, detail="Game already started")
    
    # Valider les clés attendues
    VALID_KEYS = ("relique_spherique", "relique_cubique", "relique_triangulaire")
    new_settings = {}
    for key in VALID_KEYS:
        if key in request.required_relics:
            new_settings[key] = bool(request.required_relics[key])
        else:
            new_settings[key] = game.get("required_relics", {}).get(key, True)
    
    # Au moins une relique doit rester requise
    if not any(new_settings.values()):
        raise HTTPException(status_code=400, detail="Au moins une relique doit être requise")
    
    game["required_relics"] = new_settings

    # Valider et mettre à jour dungeon_size
    new_dungeon_size = request.dungeon_size
    if new_dungeon_size not in (6, 9, 12):
        raise HTTPException(status_code=400, detail="dungeon_size doit être 6, 9 ou 12")
    game["dungeon_size"] = new_dungeon_size

    # Valider et mettre à jour enabled_powers
    if request.enabled_powers is not None:
        valid_power_keys = set(POWERS.keys())
        new_enabled = [p for p in request.enabled_powers if p in valid_power_keys]
        if len(new_enabled) == 0:
            raise HTTPException(status_code=400, detail="Au moins un pouvoir doit être activé")
        game["enabled_powers"] = new_enabled
    else:
        game["enabled_powers"] = list(POWERS.keys())

    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })

    return {"success": True, "required_relics": new_settings, "dungeon_size": new_dungeon_size, "enabled_powers": game["enabled_powers"]}

@api_router.post("/game/{session_id}/select_role")
async def select_role(session_id: str, request: SelectRoleRequest):
    """NEW: Lobby-first — permet à un joueur de choisir son rôle/avatar après avoir rejoint."""
    session_id_upper = session_id.upper()
    matching_session = next((sid for sid in game_sessions if sid.upper() == session_id_upper), None)

    if not matching_session:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[matching_session]

    if game["game_started"]:
        raise HTTPException(status_code=400, detail="Game already started")

    if request.player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")

    if request.role not in ("survivor", "killer"):
        raise HTTPException(status_code=400, detail="Invalid role")

    player = game["players"][request.player_id]
    player["role"] = request.role
    player["avatar"] = request.player_avatar
    player["character_class"] = get_avatar_class(request.player_avatar)

    # Reset stats according to the (possibly new) role
    if request.role == "survivor":
        player["hp"] = 36
        player["max_hp"] = 36
        player["inventory"] = [None] * 9
    else:
        player["hp"] = None
        player["max_hp"] = None
        player["inventory"] = None
        # Initialize powers_evolution for killers
        if not player.get("powers_evolution"):
            player["powers_evolution"] = {
                "mimic": {"level": 1, "variant": None},
                "rage": {"level": 1, "variant": None},
                "piege": {"level": 1, "variant": None},
                "toxine": {"level": 1, "variant": None},
                "vision": {"level": 1, "variant": None},
                "teleportation": {"level": 1, "variant": None},
                "goliath": {"level": 1, "variant": None},
                "eboulement": {"level": 1, "variant": None},
                "patrouille": {"level": 1, "variant": None},
                "traque": {"level": 1, "variant": None}
            }

    await broadcast_to_session(matching_session, {
        "type": "state_update",
        "game": game
    })

    return {"success": True}

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

    # NEW: Lobby-first validation — tous les joueurs doivent avoir choisi un rôle
    # (sauf en mode complot où les rôles sont assignés aléatoirement au démarrage)
    if not game.get("conspiracy_mode", False):
        players_without_role = [p["name"] for p in game["players"].values() if not p.get("role")]
        if players_without_role:
            raise HTTPException(
                status_code=400,
                detail=f"Les joueurs suivants n'ont pas encore choisi leur camp : {', '.join(players_without_role)}"
            )

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
                game["players"][player_id]["weapon_forge_attempts"] = 0  # NEW: reset forge attempts
                game["players"][player_id]["weapon_bonuses"] = []  # NEW: reset weapon bonuses
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
                game["players"][player_id]["weapon_forge_attempts"] = 0  # NEW
                game["players"][player_id]["weapon_bonuses"] = None  # NEW
                game["players"][player_id]["pending_forge_room"] = None  # NEW
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
    game["keys_needed"] = 0  # NEW: no more keys / quests
    game["keys_collected"] = 0
    game["game_started"] = True
    game["phase"] = "survivor_selection"  # Start with survivors
    game["turn"] = 1
    game["survivors_ended_turn"] = []  # Reset end-turn flag for new turn

    # GOLIATH: Initialize kill flag for the game
    game["goliath_killed_this_turn"] = False

    # Réduire le donjon selon dungeon_size (12 → 9 → 6 pièces)
    dungeon_size = game.get("dungeon_size", 12)
    if dungeon_size < 12:
        rooms_per_floor = dungeon_size // 3  # 9→3 par étage, 6→2 par étage
        floor_counts: dict = {}
        rooms_to_keep: dict = {}
        for room_name, room_data in game["rooms"].items():
            floor = room_data["floor"]
            floor_counts.setdefault(floor, 0)
            if floor_counts[floor] < rooms_per_floor:
                rooms_to_keep[room_name] = room_data
                floor_counts[floor] += 1
        game["rooms"] = rooms_to_keep
        logger.info(
            f"Donjon réduit à {dungeon_size} pièces "
            f"({rooms_per_floor} par étage) : {list(rooms_to_keep.keys())}"
        )

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

    # Place the merchant at game start (once per game)
    merchant_room = place_merchant(game)
    if merchant_room:
        logger.info(f"Merchant placed in: {merchant_room}")
    else:
        logger.warning("Could not place merchant - no available rooms")

    # Place the cartographer at game start (once per game)
    cartographer_room = place_cartographer(game)
    if cartographer_room:
        logger.info(f"Cartographer placed in: {cartographer_room}")
    else:
        logger.warning("Could not place cartographer - no available rooms")

    # Place the forge at game start (once per game)
    forge_room = place_forge(game)
    if forge_room:
        logger.info(f"Forge placed in: {forge_room}")

    crystal_event_room = place_crystal_event(game)
    if crystal_event_room:
        logger.info(f"Crystal event placed in: {crystal_event_room}")
    else:
        logger.warning("Could not place forge - no available rooms")

    # NEW: lire les paramètres de l'hôte pour savoir quelles reliques sont requises
    required_relics = game.get("required_relics", {
        "relique_spherique": True,
        "relique_cubique": True,
        "relique_triangulaire": True,
    })

    # Place the observation stone at game start (once per game)
    # NEW: uniquement si la Relique Cubique est requise
    if required_relics.get("relique_cubique", True):
        stone_room = place_observation_stone(game)
        if stone_room:
            logger.info(f"Observation stone placed in: {stone_room}")
            target_candidates = [r for r in game["rooms"].keys() if r != stone_room]
            if target_candidates:
                game["observation_stone_target_room"] = random.choice(target_candidates)
                logger.info(f"Observation stone target room: {game['observation_stone_target_room']}")
        else:
            logger.warning("Could not place observation stone - no available rooms")
    else:
        logger.info("Observation stone NOT placed (Relique Cubique disabled by host)")

    # Place the resurrection stele at game start (once per game)
    stele_room = place_resurrection_stele(game)
    if stele_room:
        logger.info(f"Resurrection stele placed in: {stele_room}")
    else:
        logger.warning("Could not place resurrection stele - no available rooms")

    # Place the 3 trophy items at game start (once per game)
    placed_trophies = place_trophies(game)
    logger.info(f"Trophies placed in {len(placed_trophies)} rooms: {placed_trophies}")

    # Place the fleeing goblin at game start (once per game)
    # NEW: uniquement si la Relique Sphérique est requise
    if required_relics.get("relique_spherique", True):
        goblin_room = place_fleeing_goblin(game)
        if goblin_room:
            logger.info(f"Fleeing goblin placed in: {goblin_room}")
        else:
            logger.warning("Could not place fleeing goblin - no available rooms")
    else:
        logger.info("Fleeing goblin NOT placed (Relique Sphérique disabled by host)")

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
        player["weapon_forge_attempts"] = 0  # NEW: reset forge attempts
        player["weapon_bonuses"] = [] if player.get("role") == "survivor" else None  # NEW: reset weapon bonuses
        player["pending_forge_room"] = None  # NEW: reset pending forge
        player["inventory"] = [None] * 9 if player.get("role") == "survivor" else None
        
        # FIXED: Ensure is_host is preserved
        player["is_host"] = is_host
        
        logger.info(f"Reset player {player['name']} (id={player_id}), is_host={is_host}, hp={player.get('hp')}")
    
    # Régénérer les 12 pièces (dungeon_size peut avoir changé entre parties)
    game["rooms"] = generate_rooms_state()

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
    game["crystal_spawned"] = False
    game["crystal_destroyed"] = False
    game["merchant_placed"] = False
    game["forge_placed"] = False
    game["crystal_event_placed"] = False
    game["crystal_room"] = None
    game["crystal_placed_relics"] = {
        "relique_spherique": False,
        "relique_cubique": False,
        "relique_triangulaire": False,
    }
    # NOTE : ne PAS réinitialiser required_relics ni dungeon_size ici
    # (paramètres choisis par l'hôte dans le lobby — persistent entre les parties).
    game["observation_stone_placed"] = False
    game["fleeing_goblin_placed"] = False
    game["goliath_active"] = False
    game["goliath_turns_remaining"] = 0
    game["goliath_previous_turn_rooms"] = []
    game["goliath_killed_this_turn"] = False
    game["poursuite_precision_empty_rooms"] = []
    game["eboulement_active"] = False
    game["eboulement_locked_floors"] = {}
    game["eboulement_perturbation_active"] = False
    game["patrouille_patrol"] = None
    game["patrol_revealed_survivors"] = {}
    game["discovered_rooms"] = []  # NOUVEAU : reset des pièces découvertes
    
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
    game["players"][player_id]["weapon_forge_attempts"] = 0  # NEW
    game["players"][player_id]["weapon_bonuses"] = [] if request.role == "survivor" else None  # NEW
    game["players"][player_id]["pending_forge_room"] = None  # NEW
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
        "antidote": {
            "price": 300,
            "item_type": "antidote",
            "name": "Antidote"
        },
        "relique_triangulaire": {
            "price": 1000,
            "item_type": "relique_triangulaire",
            "name": "Relique Triangulaire"
        }
    }
    
    if item_name not in items:
        raise HTTPException(status_code=400, detail="Invalid item name")
    
    item = items[item_name]

    # Relique Triangulaire is a unique item: refuse if already sold to any player
    if item_name == "relique_triangulaire" and game.get("relique_triangulaire_sold", False):
        raise HTTPException(status_code=400, detail="La Relique Triangulaire a déjà été vendue !")
    
    # NEW: bloquer l'achat si la relique n'est pas requise dans cette partie
    if item_name == "relique_triangulaire" and not game.get("required_relics", {}).get("relique_triangulaire", True):
        raise HTTPException(status_code=400, detail="La Relique Triangulaire n'est pas requise dans cette partie")
    
    # Check if player already has this item (antidote is stackable — skip duplicate check)
    if item_name != "antidote" and has_item(player, item["item_type"]):
        raise HTTPException(status_code=400, detail=f"Vous possédez déjà {item['name']}")
    
    # Check if player has enough gold
    if player.get("gold", 0) < item["price"]:
        raise HTTPException(status_code=400, detail="Pas assez d'or")
    
    # Check if inventory is full
    if is_inventory_full(player):
        raise HTTPException(status_code=400, detail="Inventaire plein")
    
    # Deduct gold
    player["gold"] -= item["price"]
    
    # Add item to inventory — antidote is never auto-consumed on purchase
    add_item(player, item["item_type"])
    logger.info(f"Player {player_id} bought {item_name}")
    # Mark relique as sold globally
    if item_name == "relique_triangulaire":
        game["relique_triangulaire_sold"] = True
        logger.info(f"Relique Triangulaire marked as sold (bought by {player_id})")
    
    # Broadcast state update
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })
    
    return {"status": "success", "message": f"{item['name']} acheté !"}

# ========== SELL PRICES (Vente au marchand) ==========
# Items de quête NON vendables (ne doivent pas figurer dans la liste de vente)
NON_SELLABLE_ITEMS = {"pierre_quete", "relique_triangulaire", "relique_cubique", "relique_spherique"}

# Prix de vente fixes (override le calcul par défaut)
SELL_PRICES = {
    # Runes : 100 pièces
    "rune_dommage": 100,
    "rune_initiative": 100,
    "rune_vitalite": 100,
    # Trophées : 500 pièces
    "chaussons": 500,
    "couronne": 500,
    "culotte": 500,
    # Items du shop : moitié du prix d'achat
    "antidote": 150,   # antidote achetée à 300
    "relique_triangulaire": 500,  # relique triangulaire achetée à 1000
}

def get_sell_price(item_type: str) -> int:
    """Returns the sell value for an item_type. Default to 50 if not listed."""
    return SELL_PRICES.get(item_type, 50)

@api_router.post("/shop/sell_item")
async def sell_item(session_id: str = Query(...), player_id: str = Query(...), slot_index: int = Query(...)):
    """Sell an item from the player's inventory to the merchant"""
    logger.info(f"Sell item request: session={session_id}, player={player_id}, slot={slot_index}")

    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]

    if player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")

    player = game["players"][player_id]

    if player["role"] != "survivor":
        raise HTTPException(status_code=400, detail="Only survivors can sell items")

    inventory = player.get("inventory") or []

    if slot_index < 0 or slot_index >= len(inventory):
        raise HTTPException(status_code=400, detail="Invalid slot index")

    item = inventory[slot_index]
    if item is None:
        raise HTTPException(status_code=400, detail="Slot is empty")

    item_type = item.get("type")

    # Items de quête non vendables
    if item_type in NON_SELLABLE_ITEMS:
        raise HTTPException(status_code=400, detail="Cet objet ne peut pas être vendu")

    sell_price = get_sell_price(item_type)

    # Retirer l'item et créditer l'or
    inventory[slot_index] = None
    player["gold"] = player.get("gold", 0) + sell_price

    logger.info(f"Player {player_id} sold {item_type} for {sell_price} gold (new balance: {player['gold']})")

    # MALÉDICTION: If the sold item was cursed, lift the curse
    lifted_variant_sell = try_lift_curse(game, player_id, slot_index)
    await broadcast_curse_lifted(session_id, game, lifted_variant_sell)

    # Broadcast state update
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })

    return {"status": "success", "message": f"Vendu pour {sell_price} pièces !", "gold_gained": sell_price, "new_balance": player["gold"]}


# ── MODIFICATION 9 : Cartographer hint generation ──────────────────────────────

def get_adjacent_rooms(room_name: str, all_rooms: dict) -> List[str]:
    """Get the list of rooms adjacent to the given room (left and right in the same floor)"""
    # Get the floor and position of the target room
    target_floor = all_rooms[room_name]["floor"]

    # Get all rooms on the same floor
    rooms_on_floor = [(name, room) for name, room in all_rooms.items() if room["floor"] == target_floor]

    # Sort by room name to get consistent ordering (left to right)
    rooms_on_floor.sort(key=lambda x: x[0])

    # Find the index of the target room
    target_index = next((i for i, (name, _) in enumerate(rooms_on_floor) if name == room_name), None)

    if target_index is None:
        return []

    adjacent = []
    # Add left neighbor if exists
    if target_index > 0:
        adjacent.append(rooms_on_floor[target_index - 1][0])
    # Add right neighbor if exists
    if target_index < len(rooms_on_floor) - 1:
        adjacent.append(rooms_on_floor[target_index + 1][0])

    return adjacent


def generate_cartographer_hint(game_state: dict, target_type: str) -> dict:
    """
    Generate a hint for finding the merchant or forge.
    Returns a dict with hint_level (1, 2, or 3) and hint_text.

    Hint levels:
    - Level 1 (least precise): "You won't find it in [floor]" (eliminates 4 rooms)
    - Level 2 (precise): "You'll find it in [floor]" (narrows to 4 rooms)
    - Level 3 (most precise): "Look in the room next to [adjacent_room]"
    """
    # Find the target room
    target_room = None
    if target_type == "merchant":
        target_room = next(
            (room_name for room_name, room_data in game_state["rooms"].items()
             if room_data.get("has_merchant", False)),
            None
        )
    elif target_type == "forge":
        target_room = next(
            (room_name for room_name, room_data in game_state["rooms"].items()
             if room_data.get("has_forge", False)),
            None
        )

    if not target_room:
        return {
            "hint_level": 0,
            "hint_text": "Je ne sais pas où cela se trouve..."
        }

    target_floor = game_state["rooms"][target_room]["floor"]

    # Floor names in French
    floor_names = {
        "basement": "le Sous-sol",
        "ground_floor": "le Rez-de-chaussée",
        "upper_floor": "l'Étage"
    }

    # Randomly choose hint level (1, 2, or 3)
    hint_level = random.randint(1, 3)

    if hint_level == 1:
        # Level 1: Eliminate a floor (not the target floor)
        other_floors = [f for f in ["basement", "ground_floor", "upper_floor"] if f != target_floor]
        eliminated_floor = random.choice(other_floors)
        hint_text = f"Tout ce que je sais, c'est que vous ne trouverez rien de cela dans {floor_names[eliminated_floor]}."

    elif hint_level == 2:
        # Level 2: Indicate the floor
        hint_text = f"Il me semble que vous trouverez cela dans {floor_names[target_floor]}."

    else:  # hint_level == 3
        # Level 3: Indicate an adjacent room
        adjacent_rooms = get_adjacent_rooms(target_room, game_state["rooms"])
        if adjacent_rooms:
            adjacent_room = random.choice(adjacent_rooms)
            hint_text = f"Regardez dans la pièce à côté de {adjacent_room}."
        else:
            # Fallback to level 2 if no adjacent rooms
            hint_text = f"Il me semble que vous trouverez cela dans {floor_names[target_floor]}."

    return {
        "hint_level": hint_level,
        "hint_text": hint_text
    }


# ── MODIFICATION 10 : Cartographer pay-for-hint API route ─────────────────────

@api_router.post("/cartographer/pay_for_hint")
async def cartographer_pay_for_hint(
    session_id: str = Query(...),
    player_id: str = Query(...),
    hint_topic: str = Query(...)  # "merchant" or "forge"
):
    """
    Player pays 300 gold to the cartographer for a hint about merchant or forge location
    """
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]

    if player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")

    player = game["players"][player_id]

    # Check if player has enough gold
    if player.get("gold", 0) < 300:
        raise HTTPException(status_code=400, detail="Pas assez d'or ! (300 pièces requises)")

    # Deduct gold
    player["gold"] -= 300
    logger.info(f"Player {player['name']} paid 300 gold to cartographer for {hint_topic} hint")

    # Generate hint
    hint = generate_cartographer_hint(game, hint_topic)

    # Store hint in game state (for tracking)
    if "cartographer_hints_given" not in game:
        game["cartographer_hints_given"] = {}
    if player_id not in game["cartographer_hints_given"]:
        game["cartographer_hints_given"][player_id] = []

    game["cartographer_hints_given"][player_id].append({
        "topic": hint_topic,
        "hint_text": hint["hint_text"],
        "hint_level": hint["hint_level"]
    })

    # Broadcast updated game state
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })

    return {
        "status": "success",
        "hint_text": hint["hint_text"],
        "hint_level": hint["hint_level"],
        "remaining_gold": player["gold"]
    }


# Inventory system endpoints
class PickupRuneRequest(BaseModel):
    player_id: str
    rune_type: str

class DismissRuneRequest(BaseModel):
    player_id: str

class UseItemRequest(BaseModel):
    player_id: str
    slot_index: int

class DeleteItemRequest(BaseModel):
    player_id: str
    slot_index: int

async def _trigger_pending_forge(session_id: str, player_id: str):
    """If a forge was queued while another event was active, open it now."""
    game = game_sessions.get(session_id)
    if not game:
        return
    player = game["players"].get(player_id)
    if not player or player.get("role") != "survivor":
        return
    room_name = player.get("pending_forge_room")
    if not room_name:
        return
    if player_id in game.get("pending_events", {}):
        return  # still has an event pending
    player["pending_forge_room"] = None
    game["pending_events"][player_id] = "forge"
    ws = active_connections.get(session_id, {}).get(player_id)
    if ws:
        try:
            await ws.send_json({
                "type": "forge_encounter",
                "message": "🔥 Vous avez trouvé la Forge ! Voulez-vous utiliser vos runes ?",
                "video_path": "/event/Forge.mp4"
            })
        except Exception:
            pass

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

    # Dépiler le prochain événement en attente (forge, marchand, etc.)
    # Le dispatch doit avoir lieu AVANT le broadcast pour que le state_update
    # envoyé au frontend contienne déjà le nouvel événement actif (s'il y en a un).
    await dispatch_next_player_event(session_id, request.player_id)
    # Compat legacy : ouvrir une forge qui aurait été mise en attente via l'ancien système
    await _trigger_pending_forge(session_id, request.player_id)

    # Broadcast state update (après dispatch pour que pending_events soit à jour)
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

    # Dépiler le prochain événement en attente (forge, marchand, etc.)
    # Le dispatch doit avoir lieu AVANT le broadcast pour que le state_update
    # envoyé au frontend contienne déjà le nouvel événement actif (s'il y en a un).
    await dispatch_next_player_event(session_id, request.player_id)
    # Compat legacy : ouvrir une forge qui aurait été mise en attente via l'ancien système
    await _trigger_pending_forge(session_id, request.player_id)

    # Broadcast state update (après dispatch pour que pending_events soit à jour)
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })

    logger.info(f"Player {request.player_id} dismissed rune")

    return {"status": "success", "message": "Rune ignorée"}

# ========== OBSERVATION STONE ENDPOINTS ==========
class PickupPierreQueteRequest(BaseModel):
    player_id: str

class DismissPierreQueteRequest(BaseModel):
    player_id: str

@api_router.post("/game/{session_id}/pickup_pierre_quete")
async def pickup_pierre_quete(session_id: str, request: PickupPierreQueteRequest):
    """Add observation stone to player's inventory"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]

    if request.player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")

    player = game["players"][request.player_id]

    if player["role"] != "survivor":
        raise HTTPException(status_code=400, detail="Only survivors can pickup items")

    # Check there's a pending pierre_quete event
    if request.player_id not in game["pending_events"]:
        raise HTTPException(status_code=400, detail="No stone to pickup")

    event = game["pending_events"][request.player_id]
    if not isinstance(event, dict) or event.get("type") != "pierre_quete_found":
        raise HTTPException(status_code=400, detail="No stone to pickup")

    if is_inventory_full(player):
        raise HTTPException(status_code=400, detail="Inventaire plein")

    # Remove the stone from the room
    room_name = event.get("room")
    if room_name and room_name in game["rooms"]:
        game["rooms"][room_name]["has_observation_stone"] = False

    # Add stone to inventory
    if not add_item(player, "pierre_quete"):
        raise HTTPException(status_code=400, detail="Impossible d'ajouter la pierre")

    # Remove pending event and dispatch next
    del game["pending_events"][request.player_id]
    await dispatch_next_player_event(session_id, request.player_id)

    await broadcast_to_session(session_id, {"type": "state_update", "game": game})

    logger.info(f"Player {request.player_id} picked up the observation stone")
    return {"status": "success", "message": "Pierre d'observation ramassée !"}


@api_router.post("/game/{session_id}/dismiss_pierre_quete")
async def dismiss_pierre_quete(session_id: str, request: DismissPierreQueteRequest):
    """Ignore the observation stone"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]

    if request.player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")

    if request.player_id in game["pending_events"]:
        del game["pending_events"][request.player_id]

    await dispatch_next_player_event(session_id, request.player_id)
    await broadcast_to_session(session_id, {"type": "state_update", "game": game})

    logger.info(f"Player {request.player_id} ignored the observation stone")
    return {"status": "success", "message": "Pierre ignorée"}

# ========== TROPHY ENDPOINTS (Chaussons / Couronne / Culotte) ==========
class PickupTrophyRequest(BaseModel):
    player_id: str

class DismissTrophyRequest(BaseModel):
    player_id: str

@api_router.post("/game/{session_id}/pickup_trophy")
async def pickup_trophy(session_id: str, request: PickupTrophyRequest):
    """Add a trophy item (chaussons/couronne/culotte) to player's inventory"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]

    if request.player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")

    player = game["players"][request.player_id]

    if player["role"] != "survivor":
        raise HTTPException(status_code=400, detail="Only survivors can pickup items")

    if request.player_id not in game["pending_events"]:
        raise HTTPException(status_code=400, detail="No trophy to pickup")

    event = game["pending_events"][request.player_id]
    if not isinstance(event, dict) or event.get("type") != "trophy_found":
        raise HTTPException(status_code=400, detail="No trophy to pickup")

    if is_inventory_full(player):
        raise HTTPException(status_code=400, detail="Inventaire plein")

    trophy_type = event.get("trophy_type")
    if trophy_type not in ("chaussons", "couronne", "culotte"):
        raise HTTPException(status_code=400, detail="Invalid trophy type")

    # Remove the trophy from the room
    room_name = event.get("room")
    if room_name and room_name in game["rooms"]:
        game["rooms"][room_name]["has_trophy"] = None

    # Add trophy to inventory
    if not add_item(player, trophy_type):
        raise HTTPException(status_code=400, detail="Impossible d'ajouter le trophée")

    # Remove pending event and dispatch next
    del game["pending_events"][request.player_id]
    await dispatch_next_player_event(session_id, request.player_id)

    await broadcast_to_session(session_id, {"type": "state_update", "game": game})

    logger.info(f"Player {request.player_id} picked up trophy '{trophy_type}'")
    return {"status": "success", "message": "Trophée ramassé !"}


@api_router.post("/game/{session_id}/dismiss_trophy")
async def dismiss_trophy(session_id: str, request: DismissTrophyRequest):
    """Ignore a trophy item"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]

    if request.player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")

    if request.player_id in game["pending_events"]:
        del game["pending_events"][request.player_id]

    await dispatch_next_player_event(session_id, request.player_id)
    await broadcast_to_session(session_id, {"type": "state_update", "game": game})

    logger.info(f"Player {request.player_id} ignored a trophy")
    return {"status": "success", "message": "Trophée ignoré"}

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
        
        # MALÉDICTION: Lift the curse if this was the cursed item
        lifted_variant_medikit = try_lift_curse(game, request.player_id, request.slot_index)
        await broadcast_curse_lifted(session_id, game, lifted_variant_medikit)
    
    # Handle antidote usage
    elif item_type == "antidote":
        if player.get("poisoned_countdown", 0) <= 0:
            # Player is not poisoned — do NOT consume the item
            return {"status": "not_poisoned", "message": "Vous n'êtes pas empoisonné."}
        
        # Cure all toxine variants: reset countdown and clear any specialization state
        player["poisoned_countdown"] = 0
        # Clear toxine suffocante / incapacitante flags stored on the player (if any)
        player.pop("toxine_suffocante_active", None)
        player.pop("toxine_incapacitante_active", None)
        player.pop("poison_type", None)
        player.pop("toxine_variant", None)

        inventory[request.slot_index] = None
        
        # MALÉDICTION: Lift the curse if this was the cursed item
        lifted_variant_antidote = try_lift_curse(game, request.player_id, request.slot_index)
        await broadcast_curse_lifted(session_id, game, lifted_variant_antidote)
        
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

@api_router.post("/game/{session_id}/use_resurrection_stele")
async def use_resurrection_stele(session_id: str, request: Request):
    """Revive an eliminated survivor via the resurrection stele."""
    data = await request.json()
    player_id = data.get("player_id")
    target_id = data.get("target_id")

    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]
    if player_id not in game["players"] or target_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")

    reviver = game["players"][player_id]
    target = game["players"][target_id]

    if reviver["role"] != "survivor" or reviver.get("eliminated", False):
        raise HTTPException(status_code=400, detail="Reviver must be an alive survivor")

    if target["role"] != "survivor" or not target.get("eliminated", False):
        raise HTTPException(status_code=400, detail="Target must be an eliminated survivor")

    # Find the stele room: check pending_actions first (selected this turn),
    # then fall back to current_room (position from previous turn).
    pending_action = game.get("pending_actions", {}).get(player_id, {})
    stele_room = pending_action.get("room") or reviver.get("current_room")
    if not stele_room or not game["rooms"].get(stele_room, {}).get("has_resurrection_stele", False):
        raise HTTPException(status_code=400, detail="No resurrection stele in current room")

    # Calculate sacrifice: quarter of reviver's current HP (minimum 1)
    sacrifice_hp = max(1, reviver["hp"] // 4)
    revived_hp = sacrifice_hp  # Target receives the sacrificed HP

    # Apply to reviver
    reviver["hp"] = max(1, reviver["hp"] - sacrifice_hp)  # Reviver keeps at least 1 HP

    # Revive target: keep only quest items (relics, pierre_quete), no gold
    QUEST_ITEM_TYPES = {"relique_spherique", "relique_cubique", "relique_triangulaire", "pierre_quete"}
    old_inventory = target.get("inventory") or [None] * 9
    new_inventory = [None] * 9
    slot = 0
    for item in old_inventory:
        if item and item.get("type") in QUEST_ITEM_TYPES and slot < 9:
            new_inventory[slot] = item
            slot += 1

    target["eliminated"] = False
    target["hp"] = revived_hp
    target["gold"] = 0
    target["inventory"] = new_inventory
    target["current_room"] = stele_room  # Revived in the stele room
    target["immobilized_next_turn"] = False
    target["poisoned_countdown"] = 0

    # Lock the revived player's turn this round:
    # 1) Add a pending_action so all_selected stays satisfied
    game.setdefault("pending_actions", {})[target_id] = {
        "action": "select_room",
        "room": stele_room
    }
    # 2) Add to survivors_ended_turn so all_ended stays satisfied
    if target_id not in game.get("survivors_ended_turn", []):
        game.setdefault("survivors_ended_turn", []).append(target_id)

    reviver_name = reviver["name"]
    target_name = target["name"]

    event_msg = f"🪦 {reviver_name} a sacrifié {sacrifice_hp} PV pour réanimer {target_name} !"
    game["events"].append({"message": event_msg, "type": "resurrection"})

    logger.info(f"Resurrection: {reviver_name} revived {target_name} — sacrifice: {sacrifice_hp} HP, target HP: {revived_hp}")

    # Notify the revived player
    revived_ws = active_connections.get(session_id, {}).get(target_id)
    if revived_ws:
        try:
            await revived_ws.send_json({
                "type": "you_were_revived",
                "message": f"{reviver_name} vous a réanimé en sacrifiant le quart de ses points de vie !",
                "video_path": "/event/Revive.mp4",
                "hp": revived_hp,
                "room": stele_room,
            })
        except Exception:
            pass

    # Broadcast state update to all
    await broadcast_to_session(session_id, {"type": "state_update", "game": game})

    # Check if all survivors have ended their turn (revived player counts as ended)
    if game["phase"] == "survivor_selection":
        await try_advance_to_killer_phase(session_id)

    return {"status": "success", "sacrifice_hp": sacrifice_hp, "revived_hp": revived_hp}


@api_router.post("/game/{session_id}/delete_item")
async def delete_item(session_id: str, request: DeleteItemRequest):
    """Delete an item from the player's inventory slot"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]

    if request.player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")

    player = game["players"][request.player_id]

    if player["role"] != "survivor":
        raise HTTPException(status_code=400, detail="Only survivors can manage inventory")

    inventory = player.get("inventory") or []

    if request.slot_index < 0 or request.slot_index >= len(inventory):
        raise HTTPException(status_code=400, detail="Invalid slot index")

    item = inventory[request.slot_index]

    if item is None:
        raise HTTPException(status_code=400, detail="Slot is empty")

    item_type = item.get("type")
    item_name = {
        "rune_dommage": "Rune de Dommage",
        "rune_initiative": "Rune d'Initiative",
        "rune_vitalite": "Rune de Vitalité",
        "medikit": "Médikit",
        "antidote": "Antidote",
        "pierre_quete": "Pierre d'observation",
        "chaussons": "Chaussons du Roi Orc",
        "couronne": "Couronne de rechange du Roi Orc",
        "culotte": "Culotte du Roi Orc",
    }.get(item_type, item_type)

    # Remove the item
    inventory[request.slot_index] = None

    logger.info(f"Player {request.player_id} deleted item {item_type} from slot {request.slot_index}")

    # MALÉDICTION: If the deleted item was cursed, lift the curse
    lifted_variant_delete = try_lift_curse(game, request.player_id, request.slot_index)
    if lifted_variant_delete:
        logger.info(f"Curse lifted ({lifted_variant_delete}): player {request.player_id} deleted the cursed item")
        await broadcast_curse_lifted(session_id, game, lifted_variant_delete)

    # Broadcast state update
    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })

    return {"status": "success", "message": f"{item_name} supprimé(e) de l'inventaire"}

# ========== FORGE ENDPOINTS ==========
class ForgeUseRuneRequest(BaseModel):
    player_id: str
    slot_index: int
    cursor_hit: Optional[bool] = None  # True = cursor was in green zone when player clicked

class ForgeCloseRequest(BaseModel):
    player_id: str

@api_router.post("/game/{session_id}/forge_use_rune")
async def forge_use_rune(session_id: str, request: ForgeUseRuneRequest):
    """Use a rune at the forge: consume the rune, roll for success, apply or wipe bonuses."""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]

    if request.player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")

    player = game["players"][request.player_id]

    if player["role"] != "survivor":
        raise HTTPException(status_code=400, detail="Only survivors can use the forge")

    if game.get("pending_events", {}).get(request.player_id) != "forge":
        raise HTTPException(status_code=400, detail="No active forge event")

    inventory = player.get("inventory") or []
    if request.slot_index < 0 or request.slot_index >= len(inventory):
        raise HTTPException(status_code=400, detail="Invalid slot index")

    item = inventory[request.slot_index]
    if item is None:
        raise HTTPException(status_code=400, detail="Slot is empty")

    rune_type = item.get("type")
    if rune_type not in FORGE_RUNE_BONUSES:
        raise HTTPException(status_code=400, detail="Item is not a rune")

    bonus_def = FORGE_RUNE_BONUSES[rune_type]

    # Consume the rune regardless of outcome
    inventory[request.slot_index] = None

    # MALÉDICTION: Lift the curse if this was the cursed item
    lifted_variant_forge = try_lift_curse(game, request.player_id, request.slot_index)
    await broadcast_curse_lifted(session_id, game, lifted_variant_forge)

    # Determine success via mini-game result from client, fallback to random
    attempts_done = player.get("weapon_forge_attempts", 0)
    success_rate = get_forge_success_rate(attempts_done)
    if request.cursor_hit is not None:
        success = request.cursor_hit
    else:
        success = random.random() < success_rate

    # Always increment attempts counter (a rune was consumed)
    player["weapon_forge_attempts"] = attempts_done + 1

    if success:
        if not isinstance(player.get("weapon_bonuses"), list):
            player["weapon_bonuses"] = []
        player["weapon_bonuses"].append({
            "stat": bonus_def["stat"],
            "value": bonus_def["value"],
            "rune_type": rune_type,
            "label": bonus_def["label"],
        })

        if bonus_def["stat"] == "damage":
            player["damage_bonus"] = player.get("damage_bonus", 0) + bonus_def["value"]
        elif bonus_def["stat"] == "initiative":
            player["initiative_bonus"] = player.get("initiative_bonus", 0) + bonus_def["value"]
        elif bonus_def["stat"] == "vitality":
            player["max_hp"] = (player.get("max_hp") or 36) + bonus_def["value"]
            player["hp"] = (player.get("hp") or 0) + bonus_def["value"]

        logger.info(
            f"🔨 Forge SUCCESS for {player['name']} with {rune_type} "
            f"(attempt {attempts_done + 1}, rate {int(success_rate*100)}%)"
        )
    else:
        # Failure: wipe ALL accumulated weapon bonuses
        previous = list(player.get("weapon_bonuses") or [])
        player["weapon_bonuses"] = []
        player["damage_bonus"] = 0
        player["initiative_bonus"] = 0
        base_hp = 36
        player["max_hp"] = base_hp
        if (player.get("hp") or 0) > base_hp:
            player["hp"] = base_hp
        # Reset attempts so next forge starts at 100%
        player["weapon_forge_attempts"] = 0
        logger.info(
            f"💥 Forge FAILED for {player['name']} with {rune_type} "
            f"(attempt {attempts_done + 1}, rate {int(success_rate*100)}%) - wiped {len(previous)} bonuses"
        )

    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })

    return {
        "status": "success",
        "result": "success" if success else "failure",
        "rune_type": rune_type,
        "rune_label": bonus_def["label"],
        "attempt_number": attempts_done + 1,
        "success_rate": success_rate,
        "weapon_bonuses": player.get("weapon_bonuses") or [],
        "next_success_rate": get_forge_success_rate(player["weapon_forge_attempts"]),
        "damage_bonus": player.get("damage_bonus", 0),
        "initiative_bonus": player.get("initiative_bonus", 0),
        "max_hp": player.get("max_hp"),
        "hp": player.get("hp"),
    }

@api_router.post("/game/{session_id}/forge_close")
async def forge_close(session_id: str, request: ForgeCloseRequest):
    """Close the forge interaction (treats it like an event_completed)."""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]

    if request.player_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Player not found")

    if game.get("pending_events", {}).get(request.player_id) == "forge":
        del game["pending_events"][request.player_id]
        logger.info(f"Player {request.player_id} closed the forge")

    if game["phase"] == "survivor_selection":
        await try_advance_to_killer_phase(session_id)

    await broadcast_to_session(session_id, {
        "type": "state_update",
        "game": game
    })

    return {"status": "success"}

class CrystalActionRequest(BaseModel):
    player_id: str
    relic_type: Optional[str] = None  # required for "place_relic"

@api_router.post("/game/{session_id}/crystal_place_relic")
async def crystal_place_relic(session_id: str, request: CrystalActionRequest):
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    game = game_sessions[session_id]
    player = game["players"].get(request.player_id)
    if not player or player.get("role") != "survivor":
        raise HTTPException(status_code=400, detail="Invalid player")

    placed = game.setdefault("crystal_placed_relics", {})
    VALID = ("relique_spherique", "relique_cubique", "relique_triangulaire")

    # Auto-deposit ALL relics in inventory that haven't been placed yet
    deposited = []
    inventory = player.get("inventory") or []
    for i, item in enumerate(inventory):
        if item and item.get("type") in VALID and not placed.get(item["type"], False):
            placed[item["type"]] = True
            inventory[i] = None
            deposited.append(item["type"])

    all_placed = all(placed.get(r, False) for r in VALID)
    msg = (
        f"{len(deposited)} relique(s) ont été placées au pied du cristal."
        if deposited else "Aucune relique à déposer."
    )

    await broadcast_to_session(session_id, {"type": "state_update", "game": game})
    return {
        "status": "success",
        "message": msg,
        "deposited": deposited,
        "placed_relics": placed,
        "all_placed": all_placed,
    }

CRYSTAL_MAX_HP = 30
CRYSTAL_DAMAGE = 9
SURVIVOR_BASE_DAMAGE = 5

@api_router.post("/game/{session_id}/crystal_attack")
async def crystal_attack(session_id: str, request: CrystalActionRequest):
    """
    Trigger the start of the Crystal combat.
    Same flow as the goblin / mimic combat : we broadcast a `crystal_combat`
    event to all participating survivors (every alive survivor present in the
    crystal_room). All clients simulate the combat locally; only the first
    survivor (the "simulator") will POST the result to /resolve_crystal_combat.
    """
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    game = game_sessions[session_id]
    player = game["players"].get(request.player_id)
    if not player or player.get("role") != "survivor":
        raise HTTPException(status_code=400, detail="Survivors only")

    placed = game.get("crystal_placed_relics", {})
    required = game.get("required_relics", {
        "relique_spherique": True,
        "relique_cubique": True,
        "relique_triangulaire": True,
    })
    # NEW: ne vérifier que les reliques activées par l'hôte
    missing = [r for r, is_required in required.items() if is_required and not placed.get(r, False)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Reliques manquantes : {', '.join(missing)}")

    crystal_room = game.get("crystal_room")
    pending = game.get("pending_actions", {}).get(request.player_id) or {}
    selected_room = pending.get("room")
    discovered = game["rooms"].get(crystal_room, {}).get("crystal_discovered", False)

    in_crystal_room = (
        player.get("current_room") == crystal_room
        or selected_room == crystal_room
        or discovered
    )
    if not in_crystal_room:
        raise HTTPException(status_code=400, detail="Pas dans la salle du cristal")

    # Prevent restarting a combat already in progress
    if game.get("crystal_combat") and game["crystal_combat"].get("phase") == "active":
        return {"status": "already_started", "combat": game["crystal_combat"]}

    # Gather every alive survivor present in the crystal room
    participants = []
    for p in game["players"].values():
        if (
            p["role"] == "survivor"
            and not p.get("eliminated")
            and (
                p.get("current_room") == crystal_room
                or (game.get("pending_actions", {}).get(p["id"], {}) or {}).get("room") == crystal_room
                or discovered
            )
        ):
            participants.append({
                "id": p["id"],
                "name": p["name"],
                "class": p.get("character_class", "Survivor"),
                "hp": p.get("hp", 36),
                "max_hp": p.get("max_hp", 36),
                "initiative_bonus": p.get("initiative_bonus", 0),
                "damage_bonus": p.get("damage_bonus", 0),
            })

    if not participants:
        raise HTTPException(status_code=400, detail="Aucun survivant dans la salle")

    combat_event = {
        "type": "crystal_combat",
        "survivors": participants,
        "crystal_hp": CRYSTAL_MAX_HP,
        "crystal_damage": CRYSTAL_DAMAGE,
        "turn": game["turn"],
        "combat_id": f"crystal_{crystal_room}_{game['turn']}_{int(time.time()*1000)}",
    }

    game["crystal_combat"] = {
        "phase": "active",
        "participants": [s["id"] for s in participants],
        "combat_id": combat_event["combat_id"],
    }

    # Push the event to every participant via pending_events (same as goblin combat)
    for s in participants:
        game["pending_events"][s["id"]] = combat_event

    await broadcast_to_session(session_id, {"type": "state_update", "game": game})
    await broadcast_to_session(session_id, combat_event)

    logger.info(f"⚔️ Combat Cristal déclenché : {[s['name'] for s in participants]} VS Cristal")
    return {"status": "success", "combat_event": combat_event}

@api_router.post("/game/{session_id}/crystal_close")
async def crystal_close(session_id: str, request: CrystalActionRequest):
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    game = game_sessions[session_id]
    if game.get("pending_events", {}).get(request.player_id) == "crystal":
        del game["pending_events"][request.player_id]
    if game["phase"] == "survivor_selection":
        await try_advance_to_killer_phase(session_id)
    await broadcast_to_session(session_id, {"type": "state_update", "game": game})
    return {"status": "success"}

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
        actual_damage = request.damage_dealt
        # PERTURBATION: double damage if active on this survivor
        if defender.get("eboulement_perturbation_active", False):
            actual_damage = actual_damage * 2
            logger.info(f"⛰️ Perturbation active : dégâts doublés ({request.damage_dealt} → {actual_damage}) pour {defender['name']}")
        defender["hp"] = max(0, defender["hp"] - actual_damage)
        logger.info(f"❤️ PV de {defender['name']} mis à jour: {defender['hp']} (dégâts subis: {actual_damage})")
        # Track for Vision Accumulative
        if "turn_survivors_damaged" not in game:
            game["turn_survivors_damaged"] = {}
        game["turn_survivors_damaged"][defender_id] = defender.get("current_room")
   
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
                actual_damage = damage_dealt
                # PERTURBATION: double damage if active on this survivor
                if survivor.get("eboulement_perturbation_active", False):
                    actual_damage = actual_damage * 2
                    logger.info(f"⛰️ Perturbation active : dégâts doublés ({damage_dealt} → {actual_damage}) pour {survivor['name']}")
                survivor["hp"] = max(0, survivor["hp"] - actual_damage)
                logger.info(f"❤️ PV de {survivor['name']} mis à jour: {survivor['hp']} (dégâts: {actual_damage})")
                # Track for Vision Accumulative
                if "turn_survivors_damaged" not in game:
                    game["turn_survivors_damaged"] = {}
                game["turn_survivors_damaged"][survivor_id] = survivor.get("current_room")
            
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


# === CRYSTAL COMBAT RESOLUTION ===========================================
class ResolveCrystalCombatRequest(BaseModel):
    survivors_results: List[dict]  # [{"id": str, "damage_dealt": int, "eliminated": bool}]
    crystal_defeated: bool
    combat_log: List[str] = []


@api_router.post("/game/{session_id}/resolve_crystal_combat")
async def resolve_crystal_combat(session_id: str, request: ResolveCrystalCombatRequest):
    """
    Resolve a combat between the survivors and the Crystal.
    Mirrors resolve_multiplayer_combat but with a single AOE crystal entity.
    """
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]
    logger.info(
        f"💎 Résolution combat Cristal: survivors={len(request.survivors_results)} "
        f"crystal_defeated={request.crystal_defeated}"
    )

    eliminated_survivors = []
    for survivor_result in request.survivors_results:
        survivor_id = survivor_result["id"]
        damage_dealt = survivor_result.get("damage_dealt", 0)
        is_eliminated = survivor_result.get("eliminated", False)

        if survivor_id in game["players"]:
            survivor = game["players"][survivor_id]
            if survivor.get("hp") is not None and damage_dealt > 0:
                actual_damage = damage_dealt
                # PERTURBATION: double damage if active on this survivor
                if survivor.get("eboulement_perturbation_active", False):
                    actual_damage = actual_damage * 2
                survivor["hp"] = max(0, survivor["hp"] - actual_damage)

            if is_eliminated or (survivor.get("hp") is not None and survivor["hp"] <= 0):
                survivor["eliminated"] = True
                survivor["hp"] = 0
                survivor["gold"] = 0
                survivor_room = survivor.get("current_room")
                if survivor_room and survivor_room in game["rooms"]:
                    if survivor_id not in game["rooms"][survivor_room]["eliminated_players"]:
                        game["rooms"][survivor_room]["eliminated_players"].append(survivor_id)

                eliminated_survivors.append(survivor["name"])
                event_msg = f"💀 {survivor['name']} a été pulvérisé(e) par le Cristal !"
                game["events"].append({"message": event_msg, "type": "combat_elimination"})

    for name in eliminated_survivors:
        await broadcast_to_session(session_id, {"type": "event", "message": f"💀 {name} a été éliminé(e) !"})

    combat_state = game.get("crystal_combat") or {}
    for pid in combat_state.get("participants", []):
        if pid in game.get("pending_events", {}):
            del game["pending_events"][pid]

    if request.crystal_defeated:
        game["crystal_destroyed"] = True
        game["phase"] = "game_over"
        game["winner"] = "survivors"
        combat_state["phase"] = "victory"
        game["crystal_combat"] = combat_state

        await broadcast_to_session(session_id, {"type": "state_update", "game": game})
        await broadcast_to_role(session_id, "survivor", {
            "type": "game_over", "winner": "survivors",
            "message": "🎉 VICTOIRE ! Le Cristal a été détruit !"
        })
        await broadcast_to_role(session_id, "killer", {
            "type": "game_over", "winner": "survivors",
            "message": "💎 Les aventuriers ont détruit le Cristal..."
        })
        return {"status": "success"}

    alive_survivors = [p for p in game["players"].values()
                       if p["role"] == "survivor" and not p["eliminated"]]

    combat_state["phase"] = "defeat" if not alive_survivors else "ended"
    game["crystal_combat"] = combat_state

    if len(alive_survivors) == 0:
        game["phase"] = "game_over"
        game["winner"] = "killers"
        await broadcast_to_role(session_id, "survivor", {
            "type": "game_over", "winner": "killers",
            "message": "💀 DÉFAITE ! Le Cristal vous a tous éliminés..."
        })
        await broadcast_to_role(session_id, "killer", {
            "type": "game_over", "winner": "killers",
            "message": "🎉 VICTOIRE ! Le Cristal a anéanti les aventuriers !"
        })

    await broadcast_to_session(session_id, {"type": "state_update", "game": game})
    return {"status": "success"}


# Modèle pour la résolution de combat contre le Mimic
class ResolveMimicCombatRequest(BaseModel):
    # Ancien format (rétro-compat)
    survivor_id: Optional[str] = None
    damage_dealt_to_survivor: Optional[int] = 0
    gold_stolen: Optional[int] = 0
    mimic_defeated: Optional[bool] = False
    combat_log: List[str] = []
    # Nouveau format multi
    survivors_results: Optional[List[dict]] = None  # [{id, damage_dealt, gold_stolen, eliminated}]

@api_router.post("/game/{session_id}/resolve_mimic_combat")
async def resolve_mimic_combat(session_id: str, request: ResolveMimicCombatRequest):
    """Resolve a combat between a survivor and a Mimic"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    game = game_sessions[session_id]
    survivor_id = request.survivor_id
    
    if survivor_id is not None and survivor_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Survivor not found")
    
    survivor = game["players"][survivor_id] if survivor_id else None
    
    logger.info(f"⚔️ Résolution combat Mimic: survivor={request.survivor_id}, damage={request.damage_dealt_to_survivor}, gold_stolen={request.gold_stolen}, defeated={request.mimic_defeated}")
    
    # Multi-participants ?
    if request.survivors_results:
        participants = []
        for r in request.survivors_results:
            sid = r.get("id")
            if not sid or sid not in game["players"]:
                continue
            participants.append(sid)
            survivor = game["players"][sid]
            dmg = int(r.get("damage_dealt", 0) or 0)
            gold_lost = int(r.get("gold_stolen", 0) or 0)
            survivor["hp"] = max(0, (survivor.get("hp", 36) or 36) - dmg)
            survivor["gold"] = max(0, (survivor.get("gold", 0) or 0) - gold_lost)
            if r.get("eliminated") or survivor["hp"] <= 0:
                survivor["eliminated"] = True
                room = survivor.get("current_room")
                if room and room in game["rooms"]:
                    if sid not in game["rooms"][room]["eliminated_players"]:
                        game["rooms"][room]["eliminated_players"].append(sid)

        # 🔑 Nettoyer pending_events pour tous les participants
        # et dispatcher le prochain event en file si nécessaire
        for sid in participants:
            if sid in game.get("pending_events", {}):
                del game["pending_events"][sid]
            await dispatch_next_player_event(session_id, sid)

        await broadcast_to_session(session_id, {"type": "state_update", "game": game})

        # ⚡ Vérifier si on peut passer à la phase killer (au cas où tous les survivants
        # auraient terminé leur tour, ce qui inclut ceux en combat join)
        await try_advance_to_killer_phase(session_id)

        return {"success": True}
    # Sinon : conserver l'ancienne logique 1v1 ci-dessous (rétro-compat)

    survivor_id = request.survivor_id
    if survivor.get("hp") is not None and request.damage_dealt_to_survivor > 0:
        actual_damage = request.damage_dealt_to_survivor
        # PERTURBATION: double damage if active on this survivor
        if survivor.get("eboulement_perturbation_active", False):
            actual_damage = actual_damage * 2
            logger.info(f"⛰️ Perturbation active : dégâts doublés ({request.damage_dealt_to_survivor} → {actual_damage}) pour {survivor['name']}")
        survivor["hp"] = max(0, survivor["hp"] - actual_damage)
        logger.info(f"❤️ PV de {survivor['name']} mis à jour: {survivor['hp']} (dégâts: {actual_damage})")
        # Track for Vision Accumulative
        if "turn_survivors_damaged" not in game:
            game["turn_survivors_damaged"] = {}
        game["turn_survivors_damaged"][survivor_id] = survivor.get("current_room")
    
    # Apply gold loss
    if request.gold_stolen > 0:
        survivor["gold"] = max(0, survivor.get("gold", 0) - request.gold_stolen)
        logger.info(f"💰 Or de {survivor['name']} mis à jour: {survivor['gold']} (volé: {request.gold_stolen})")
    
    # Check if survivor died
    if survivor.get("hp") is not None and survivor["hp"] <= 0:
        survivor["eliminated"] = True
        survivor["hp"] = 0
        survivor["gold"] = 0
        survivor_room = survivor.get("current_room")
        if survivor_room and survivor_room in game["rooms"]:
            game["rooms"][survivor_room]["eliminated_players"].append(survivor_id)
        
        event_msg = f"💀 {survivor['name']} a été vaincu par le Mimic !"
        game["events"].append({"message": event_msg, "type": "combat_elimination"})
        await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
    
    # Combat result message
    if request.mimic_defeated:
        event_msg = f"⚔️ {survivor['name']} a vaincu le Mimic ! (Or volé: {request.gold_stolen}💰)"
    else:
        event_msg = f"💀 Le Mimic a vaincu {survivor['name']} ! (Or volé: {request.gold_stolen}💰)"
    
    game["events"].append({"message": event_msg, "type": "mimic_combat_result"})
    await broadcast_to_session(session_id, {"type": "event", "message": event_msg})
    
    # Clear pending event
    if survivor_id in game.get("pending_events", {}):
        del game["pending_events"][survivor_id]

    # NOTE: We intentionally do NOT call dispatch_next_player_event here.
    # The frontend MimicCombat.onClose calls notifyEventCompleted() which sends
    # an "event_completed" WS message, triggering dispatch_next_player_event
    # server-side. This prevents queued popups (e.g. pierre_quete_found) from
    # appearing while the combat modal is still open on the client.

    # Check if all survivors are done so we can advance to killer phase
    await try_advance_to_killer_phase(session_id)

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
        
        survivor_msg = "💀 DÉFAITE ! Tous les survivants ont été éliminés..."
        killer_msg = "🎉 VICTOIRE ! Tous les aventuriers ont été exterminés !"
        
        await broadcast_to_session(session_id, {
            "type": "game_over",
            "winner": "killers",
            "message": survivor_msg
        }, role_filter="survivor")
        
        await broadcast_to_session(session_id, {
            "type": "game_over",
            "winner": "killers",
            "message": killer_msg
        }, role_filter="killer")
    
    return {"status": "success"}

# ========== FLEEING GOBLIN COMBAT ==========
class ResolveFleeingGoblinCombatRequest(BaseModel):
    survivor_id: str
    result: str  # "survivor_win" or "goblin_fled"

@api_router.post("/game/{session_id}/resolve_fleeing_goblin_combat")
async def resolve_fleeing_goblin_combat(session_id: str, request: ResolveFleeingGoblinCombatRequest):
    """Resolve a fleeing goblin combat: either survivor wins (gets relic) or goblin flees (moves to new room)"""
    if session_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    game = game_sessions[session_id]
    survivor_id = request.survivor_id

    if survivor_id not in game["players"]:
        raise HTTPException(status_code=404, detail="Survivor not found")

    survivor = game["players"][survivor_id]
    logger.info(f"🐾 Gobelin Fuyard — résolution : survivant={survivor['name']}, résultat={request.result}")

    if request.result == "survivor_win":
        # Add Relique Sphérique to survivor inventory
        added = add_item(survivor, "relique_spherique")
        if added:
            logger.info(f"🎁 Relique Sphérique accordée à {survivor['name']}")
        else:
            logger.warning(f"⚠️ Impossible d'ajouter la Relique Sphérique à {survivor['name']} — inventaire plein")

        event_msg = f"⚔️ {survivor['name']} a attrapé le Gobelin Fuyard et obtenu la Relique Sphérique !"
        game["events"].append({"message": event_msg, "type": "fleeing_goblin_caught"})
        await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

        ws = active_connections.get(session_id, {}).get(survivor_id)
        if ws:
            try:
                await ws.send_json({
                    "type": "item_found",
                    "item_type": "relique_spherique",
                    "message": "Vous avez obtenu la Relique Sphérique !"
                })
            except Exception:
                pass

    elif request.result == "goblin_fled":
        # Relocate goblin to another available room
        available_rooms = []
        for room_name, room_data in game["rooms"].items():
            if (not room_data["locked"] and
                not room_data.get("has_fleeing_goblin", False) and
                not room_data.get("has_merchant", False) and
                not room_data.get("has_cartographer", False) and
                not room_data.get("has_forge", False) and
                not room_data.get("has_quest", False)):
                available_rooms.append(room_name)

        if available_rooms:
            new_room = random.choice(available_rooms)
            game["rooms"][new_room]["has_fleeing_goblin"] = True
            logger.info(f"🐾 Gobelin Fuyard replacé dans : {new_room}")
        else:
            logger.warning("🐾 Gobelin Fuyard — aucune salle disponible pour le replacement")

        event_msg = f"💨 Le Gobelin Fuyard s'est échappé !"
        game["events"].append({"message": event_msg, "type": "goblin_fled"})
        await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

        ws = active_connections.get(session_id, {}).get(survivor_id)
        if ws:
            try:
                await ws.send_json({
                    "type": "combat_result",
                    "message": "Le Gobelin Fuyard a pris la fuite !"
                })
            except Exception:
                pass

    # Clear pending event
    if survivor_id in game.get("pending_events", {}):
        del game["pending_events"][survivor_id]

    await dispatch_next_player_event(session_id, survivor_id)

    if game["phase"] == "survivor_selection":
        await try_advance_to_killer_phase(session_id)

    await broadcast_to_session(session_id, {"type": "state_update", "game": game})

    return {"status": "success", "result": request.result}

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

                    # PATROUILLE CHECK: Reveal survivors based on gobelin variant
                    if player["role"] == "survivor" and game.get("patrouille_patrol") and game["patrouille_patrol"].get("active"):
                        patrol_data = game["patrouille_patrol"]
                        patrol_variant = patrol_data.get("variant")  # None=espionnage, "patrouille", "vadrouille"
                        selected_floor = game["rooms"][room_name]["floor"]
                        patrol_floor = patrol_data["floor"]

                        # Determine if this survivor is in detection range
                        same_floor = selected_floor == patrol_floor
                        in_range = same_floor or patrol_variant == "vadrouille"

                        if in_range:
                            if "patrol_revealed_survivors" not in game:
                                game["patrol_revealed_survivors"] = {}

                            # "patrouille" variant: reveal exact position (original mechanic)
                            # "vadrouille" or base: reveal only presence (no room in state)
                            if patrol_variant == "patrouille":
                                game["patrol_revealed_survivors"][player_id] = room_name
                            else:
                                # Presence only — store floor so killers know the floor but not exact room
                                game["patrol_revealed_survivors"][player_id] = f"__floor__{selected_floor}"

                            # If survivor found the exact patrol room, deactivate gobelin
                            if room_name == patrol_data["room"]:
                                game["patrouille_patrol"]["active"] = False
                                if patrol_data["room"] in game["rooms"]:
                                    game["rooms"][patrol_data["room"]]["has_patrol"] = False

                                # Gobelin détruit → rétrograder la spécialisation de tous les killers
                                # Le pouvoir redevient Espionnage niveau 1, ils pourront re-spécialiser
                                for _pid, _p in game["players"].items():
                                    if _p.get("role") == "killer":
                                        _pevo = _p.get("powers_evolution", {}).get("patrouille", {})
                                        if _pevo.get("variant") in ("patrouille", "vadrouille"):
                                            _p["powers_evolution"]["patrouille"] = {
                                                "level": 1,
                                                "variant": None,
                                                "variant_name": None,
                                                "variant_description": None,
                                                "variant_video_path": None
                                            }
                                            logger.info(f"🔍 Spécialisation patrouille réinitialisée pour {_p['name']} (gobelin trouvé)")

                                await enqueue_player_event(session_id, player_id, "patrol_found", {
                                    "type": "patrol_found",
                                    "message": "Vous avez trouvé le gobelin espion ! Il se trouvait dans cette pièce.",
                                    "video_path": "/powers/Espionnage.mp4"
                                })
                                logger.info(f"🔍 {player['name']} a trouvé le gobelin espion dans {room_name}")
                            else:
                                if patrol_variant == "patrouille":
                                    msg = "Un gobelin de Patrouille a révélé votre position ! Il se trouve dans une pièce de l'étage."
                                    vid = "/powers/Patrouille.mp4"
                                elif patrol_variant == "vadrouille":
                                    msg = "Un gobelin Vadrouille a signalé votre présence dans l'étage !"
                                    vid = "/powers/Vadrouille.mp4"
                                else:
                                    msg = "Un gobelin Espion a détecté votre présence dans l'étage !"
                                    vid = "/powers/Espionnage.mp4"

                                await enqueue_player_event(session_id, player_id, "patrol_detected", {
                                    "type": "patrol_detected",
                                    "message": msg,
                                    "video_path": vid
                                })
                                logger.info(f"🔍 {player['name']} a été détecté par le gobelin (variant={patrol_variant})")

                            # Notify killers
                            if patrol_variant == "patrouille":
                                # Exact room revealed
                                await broadcast_to_session(session_id, {
                                    "type": "patrol_reveal",
                                    "player_id": player_id,
                                    "player_name": player["name"],
                                    "room": room_name,
                                    "floor": selected_floor
                                }, role_filter="killer")
                            else:
                                # Presence only — reveal floor but not room
                                await broadcast_to_session(session_id, {
                                    "type": "patrol_presence",
                                    "player_id": player_id,
                                    "player_name": player["name"],
                                    "floor": selected_floor,
                                    "variant": patrol_variant or "espionnage"
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
                            # Track for Vision Accumulative
                            if "turn_survivors_damaged" not in game:
                                game["turn_survivors_damaged"] = {}
                            game["turn_survivors_damaged"][player_id] = target_room  # destination after teleport
                            player_class = player.get("character_class", "Mage")
                            video_path = f"/death/{player_class}_teleportation.mp4"

                            await enqueue_player_event(session_id, player_id, "teleportation", {
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
                        game.get("goliath_active", False)):
                        previous_turn_rooms = game.get("goliath_previous_turn_rooms", [])
                        if room_name in previous_turn_rooms:
                            # Déclencher un combat goblin contre cet aventurier (comme quand le killer fouille une pièce occupée)
                            _tox_incap = False
                            for _kp in game["players"].values():
                                if _kp.get("role") == "killer":
                                    if (_kp.get("powers_evolution") or {}).get("toxine", {}).get("variant") == "incapacitante":
                                        _tox_incap = True
                                        break

                            # Trouver le killer (pour attacker_id/attacker_class)
                            killer_player = next((p for p in game["players"].values() if p.get("role") == "killer"), None)
                            killer_id_for_combat = killer_player["id"] if killer_player else "poursuite"
                            killer_class_for_combat = killer_player.get("character_class", "Orc") if killer_player else "Orc"
                            killer_name_for_combat = killer_player.get("name", "Poursuite") if killer_player else "Poursuite"

                            combat_event = {
                                "type": "multiplayer_combat",
                                "attacker_id": killer_id_for_combat,
                                "attacker_class": killer_class_for_combat,
                                "attacker_name": killer_name_for_combat,
                                "survivors": [{
                                    "id": player_id,
                                    "name": player["name"],
                                    "class": player.get("character_class", "Survivor"),
                                    "hp": player.get("hp", 36),
                                    "max_hp": player.get("max_hp", 36),
                                    "initiative_bonus": player.get("initiative_bonus", 0),
                                    "damage_bonus": player.get("damage_bonus", 0),
                                    "avatar": player.get("avatar", ""),
                                    "poisoned_countdown": player.get("poisoned_countdown", 0),
                                }],
                                "num_goblins": 1,
                                "goblin_hp": 6,
                                "turn": game["turn"],
                                "combat_id": f"poursuite_{player_id}_{room_name}_{game['turn']}",
                                "toxine_incapacitante_active": _tox_incap
                            }

                            game["pending_events"][player_id] = combat_event

                            event_msg = f"⚔️ La Poursuite déclenche un combat pour {player['name']} dans {room_name} !"
                            game["events"].append({"message": event_msg, "type": "poursuite_combat"})
                            await broadcast_to_session(session_id, {"type": "event", "message": event_msg})

                            logger.info(f"⚔️ Poursuite : combat déclenché pour {player['name']} dans {room_name}")
                    
                    # NOUVEAU : Découvrir la pièce pour les survivants (fog of war)
                    newly_discovered = False
                    if player["role"] == "survivor" and room_name not in game.get("discovered_rooms", []):
                        if "discovered_rooms" not in game:
                            game["discovered_rooms"] = []
                        game["discovered_rooms"].append(room_name)
                        newly_discovered = True
                        
                        # Notifier TOUS les survivants de la découverte
                        discovery_msg = f"✨ {player['name']} a découvert : {room_name} !"
                        await broadcast_to_session(session_id, {
                            "type": "room_discovered",
                            "room_name": room_name,
                            "discoverer": player['name'],
                            "message": discovery_msg
                        }, role_filter="survivor")
                    
                    # Check if survivor enters trapped room
                    if player["role"] == "survivor" and game["rooms"][room_name].get("trapped", False):
                        player["immobilized_next_turn"] = True
                        game["rooms"][room_name]["trap_triggered"] = True
                        # Track for Vision Accumulative
                        if "turn_survivors_damaged" not in game:
                            game["turn_survivors_damaged"] = {}
                        game["turn_survivors_damaged"][player_id] = room_name

                        # Infliger ~20% des PV max au survivant
                        max_hp = player.get("max_hp") or 36
                        blizzard_dmg = max(1, round(max_hp * 0.20))
                        # PERTURBATION: double damage if active on this survivor
                        if player.get("eboulement_perturbation_active", False):
                            blizzard_dmg = blizzard_dmg * 2
                        player["hp"] = max(0, (player.get("hp") or 0) - blizzard_dmg)

                        player_class = player.get("character_class", "Mage").lower()
                        video_path = f"/death/Blizzard_{player_class}.mp4"

                        await enqueue_player_event(session_id, player_id, "trap", {
                            "type": "trapped_notification",
                            "message": f"🥶 C'est un blizzard ! Vous perdez {blizzard_dmg} PV et êtes immobilisé ce tour-ci.",
                            "video_path": video_path
                        })

                        # Spécialisation Précision : alerter le killer concerné
                        blizzard_killer_id = game["rooms"][room_name].get("blizzard_killer_id")
                        blizzard_variant = game["rooms"][room_name].get("blizzard_variant")
                        if blizzard_variant == "precision" and blizzard_killer_id:
                            killer_ws = active_connections.get(session_id, {}).get(blizzard_killer_id)
                            if killer_ws:
                                try:
                                    await killer_ws.send_json({
                                        "type": "blizzard_precision_alert",
                                        "message": f"🥶 {player['name']} est pris dans votre blizzard !",
                                        "player_name": player["name"],
                                        "room": room_name
                                    })
                                except Exception:
                                    pass
                    
                    # Check if survivor enters poisoned room
                    if player["role"] == "survivor" and game["rooms"][room_name].get("poisoned_turns_remaining", 0) > 0:
                        if player.get("poisoned_countdown", 0) == 0:
                            player["poisoned_countdown"] = 10
                            # Track for Vision Accumulative
                            if "turn_survivors_damaged" not in game:
                                game["turn_survivors_damaged"] = {}
                            game["turn_survivors_damaged"][player_id] = room_name

                            player_class = player.get("character_class", "Assassin")
                            video_path = f"/death/{player_class}_toxine.mp4"

                            await enqueue_player_event(session_id, player_id, "poison", {
                                "type": "poisoned_notification",
                                "message": "😷 Vous avez été empoisonné par un gaz toxique ! Il vous reste 10 tours avant de suffoquer. Vous perdez 3 PV à chaque tour.",
                                "countdown": 10,
                                "video_path": video_path
                            })

                    # TOXINE SUFFOCANTE: Notify killers of poisoned survivor's floor
                    # Checked AFTER poisoned_countdown may have just been set to 10
                    if player["role"] == "survivor" and player.get("poisoned_countdown", 0) > 0:
                        _suff_variant = None
                        for _sk in game["players"].values():
                            if _sk.get("role") == "killer":
                                _v = (_sk.get("powers_evolution") or {}).get("toxine", {}).get("variant")
                                logger.info(f"[SUFFOCANTE] killer={_sk.get('name')} powers_evolution={_sk.get('powers_evolution')} toxine_variant={_v!r}")
                                if _v:
                                    _suff_variant = _v
                                    break
                        logger.info(f"[SUFFOCANTE] survivor={player.get('name')} countdown={player.get('poisoned_countdown')} variant={_suff_variant!r} room={room_name}")
                        if _suff_variant == "suffocante":
                            _suff_floor = game["rooms"][room_name].get("floor", "")
                            _suff_floor_names = {
                                "basement": "🕳️ Sous-sol",
                                "ground_floor": "🏰 Rez-de-chaussée",
                                "upper_floor": "🕯️ Étage"
                            }
                            _suff_floor_label = _suff_floor_names.get(_suff_floor, _suff_floor)
                            await broadcast_to_session(session_id, {
                                "type": "toxic_cough_popup",
                                "title": "😷 Toxine suffocante",
                                "message": f"Vous entendez tousser bruyamment dans {_suff_floor_label}.",
                                "video_path": "/powers/Toxine suffocante.mp4",
                                "floor": _suff_floor
                            }, role_filter="killer")

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
                                    # NEW: fouille miraculeuse triggered (no video, no key, no quest popup)
                                    room["has_quest"] = False
                                    room["quest_class"] = None
                                    # Flag the rest of the search to be "lucky": doubled gold + 2 guaranteed items
                                    player["lucky_search_active"] = True
                                    player["lucky_search_class"] = quest_class

                                    event_msg = f"✨ {player['name']} effectue une Fouille Miraculeuse dans {room_name} !"
                                    game["events"].append({"message": event_msg, "type": "lucky_search", "for_role": "survivor"})
                                    await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="survivor")

                                    # Show "Vous faites une fouille miraculeuse" popup (replaces gold popup)
                                    try:
                                        required_class_image = f"/requis/{quest_class}-requis.png"
                                        await enqueue_player_event(session_id, player_id, "lucky_search", {
                                            "type": "lucky_search_popup",
                                            "message": "Vous faites une fouille miraculeuse !",
                                            "required_class": quest_class,
                                            "required_class_image": required_class_image
                                        })
                                    except:
                                        pass

                                    # Re-place the lucky search for this class in a new room so it stays continuous
                                    place_quest(game, quest_class)
                            else:
                                try:
                                    required_class_image = f"/requis/{quest_class}-requis.png"
                                    await enqueue_player_event(session_id, player_id, "wrong_class", {
                                        "type": "wrong_class_popup",
                                        "message": f"Une fouille miraculeuse se déclenchera pour le joueur étant la classe {quest_class}.",
                                        "required_class": quest_class,
                                        "required_class_image": required_class_image
                                    })
                                except:
                                    pass
                                
                                event_msg = f"🔍 {player['name']} fouille {room_name} — une fouille miraculeuse y attend la classe {quest_class}."
                                game["events"].append({"message": event_msg, "type": "search_wrong_class", "for_role": "survivor"})
                                await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="survivor")
                        else:
                            event_msg = f"🔍 {player['name']} fouille {room_name} mais ne trouve rien de particulier."
                            game["events"].append({"message": event_msg, "type": "search_no_quest", "for_role": "survivor"})
                            await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="survivor")
                        
                        # Check if survivor carrying the stone enters the target room (non-blocking)
                        if has_item(player, "pierre_quete"):
                            target_room = game.get("observation_stone_target_room")
                            if target_room and room_name == target_room and not game.get("observation_stone_quest_completed", False):
                                if not game["rooms"][room_name].get("trap_triggered", False):
                                    remove_item(player, "pierre_quete")
                                    game["observation_stone_quest_completed"] = True
                                    stone_msg = f"🪨 {player['name']} a jeté la Pierre d'observation dans {target_room} ! Quête accomplie !"
                                    game["events"].append({"message": stone_msg, "type": "stone_quest_completed", "for_role": "survivor"})
                                    await broadcast_to_session(session_id, {"type": "event", "message": stone_msg}, role_filter="survivor")
                                    await broadcast_to_session(session_id, {"type": "event", "message": f"🪨 La Pierre d'observation a été jetée dans {target_room} !"}, role_filter="killer")
                                    # Give the player the Relique Cubique as quest reward
                                    add_item(player, "relique_cubique")
                                    logger.info(f"Relique Cubique given to {player['name']} as stone quest reward")
                                    # Non-blocking direct WS push (no enqueue — does not block the turn)
                                    ws = active_connections.get(session_id, {}).get(player_id)
                                    if ws:
                                        try:
                                            await ws.send_json({"type": "stone_quest_completed_popup", "message": f"Vous avez jeté la Pierre dans {target_room} ! Quête accomplie !"})
                                        except Exception:
                                            pass
                                    logger.info(f"Stone quest completed by {player['name']} in {target_room}")

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
                    
                    # NEW: Mimic encounter → ouvre une fenêtre d'aide de 10 secondes au lieu d'un combat 1v1 immédiat
                    mimic_triggered = False
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_mimic", False):
                        game["rooms"][room_name]["has_mimic"] = False
                        mimic_triggered = True

                        expires_at = time.time() + 10.0
                        game.setdefault("combat_help_windows", {})[player_id] = {
                            "combat_type": "mimic",
                            "room": room_name,
                            "participants": [player_id],
                            "mimic_hp": 6,
                            "mimic_has_initiative": False,
                            "expires_at": expires_at,
                            "finalized": False,
                        }

                        # Calculer la liste des B éligibles
                        # Salle du Mimic et son étage
                        mimic_room = room_name
                        mimic_floor = game["rooms"][mimic_room]["floor"]

                        eligible_B = []
                        for pid, p in game["players"].items():
                            if pid == player_id:
                                continue
                            if p.get("role") != "survivor":
                                continue
                            if p.get("eliminated", False):
                                continue
                            if pid in game.get("pending_actions", {}):
                                continue

                            # ❄️ BLIZZARD : si le survivant est immobilisé → exclu
                            if p.get("immobilized_next_turn", False):
                                continue

                            # ⛰️ ÉBOULEMENT (base + variantes perturbation/séisme) :
                            # si actif et que le joueur est verrouillé sur un étage
                            # différent de celui du Mimic → exclu
                            if game.get("eboulement_active", False):
                                locked_floor = game.get("eboulement_locked_floors", {}).get(pid)
                                if locked_floor and locked_floor != mimic_floor:
                                    continue

                            eligible_B.append(pid)

                        # ⚡ Si aucun B éligible → lancer le combat directement (pas de fenêtre)
                        if not eligible_B:
                            logger.info(f"🪤 Mimic solo : pas d'allié éligible, combat immédiat pour {player['name']}")
                            asyncio.create_task(finalize_combat_help_window(session_id, player_id, 0.0))
                        else:
                            # Notifier A : il doit attendre
                            ws_a = active_connections.get(session_id, {}).get(player_id)
                            if ws_a:
                                try:
                                    await ws_a.send_json({
                                        "type": "combat_help_waiting",
                                        "combat_type": "mimic",
                                        "room": room_name,
                                        "expires_at": expires_at,
                                        "message": "💰 Un Mimic vous attaque ! Vos alliés peuvent vous rejoindre...",
                                    })
                                except Exception:
                                    pass

                            # Notifier les B éligibles
                            for pid in eligible_B:
                                ws_b = active_connections.get(session_id, {}).get(pid)
                                if ws_b:
                                    try:
                                        await ws_b.send_json({
                                            "type": "combat_help_available",
                                            "combat_type": "mimic",
                                            "attacker_id": player_id,
                                            "attacker_name": player["name"],
                                            "room": room_name,
                                            "expires_at": expires_at,
                                            "mimic_hp": 6,
                                        })
                                    except Exception:
                                        pass

                            asyncio.create_task(finalize_combat_help_window(session_id, player_id, 10.0))
                            logger.info(f"🪤 Fenêtre d'aide Mimic ouverte par {player['name']} dans {room_name} ({len(eligible_B)} allié(s) éligible(s))")

                    # GOLD SYSTEM (skipped if mimic triggered — gold resolved in resolve_mimic_combat)
                    if player["role"] == "survivor" and not game["rooms"][room_name].get("trap_triggered", False) and not mimic_triggered:
                        is_lucky = player.pop("lucky_search_active", False)
                        gold_amount, gold_image = generate_gold_reward()
                        if is_lucky:
                            gold_amount *= 2  # NEW: doubled for lucky search
                        player["gold"] += gold_amount

                        # NEW: always show the gold popup — even after a lucky search.
                        # Since events are queued, this popup will appear AFTER the
                        # lucky_search_popup is closed, and runes will follow.
                        gold_message = (
                            f"✨ Fouille miraculeuse ! Vous trouvez {gold_amount} pièces d'or (x2) !"
                            if is_lucky
                            else f"Vous fouillez la pièce et trouvez {gold_amount} pièces d'or !"
                        )
                        try:
                            await enqueue_player_event(session_id, player_id, "gold_found", {
                                "type": "gold_found",
                                "message": gold_message,
                                "gold_amount": gold_amount,
                                "total_gold": player["gold"],
                                "gold_image": gold_image,
                                "lucky": is_lucky,  # optional flag for frontend styling
                            })
                        except:
                            pass

                        if is_lucky:
                            # Also log in event feed for narrative
                            game["events"].append({
                                "message": f"💰 {player['name']} obtient {gold_amount} pièces d'or (x2) grâce à la fouille miraculeuse !",
                                "type": "lucky_gold",
                                "for_role": "survivor"
                            })

                        # ITEM DROP SYSTEM — lucky search guarantees 2 items, otherwise normal probability
                        if is_lucky:
                            POSSIBLE_LUCKY_ITEMS = ["rune_vitalite", "rune_initiative", "rune_dommage"]
                            for _ in range(2):
                                rune_type = random.choice(POSSIBLE_LUCKY_ITEMS)
                                await enqueue_player_event(
                                    session_id,
                                    player_id,
                                    {
                                        "type": "rune_found",
                                        "rune_type": rune_type,
                                        "inventory_full": is_inventory_full(player)
                                    },
                                    None
                                )
                                logger.info(f"Player {player_id} found rune (lucky): {rune_type}")
                            # Track for Vision Vigilante (survivor picked up items)
                            if "turn_survivors_items_gained" not in game:
                                game["turn_survivors_items_gained"] = {}
                            game["turn_survivors_items_gained"][player_id] = room_name
                        else:
                            # RUNE DROP SYSTEM (after gold)
                            roll = random.random()
                            rune_type = None
                            if roll < 0.15:
                                rune_type = "rune_vitalite"
                            elif roll < 0.30:
                                rune_type = "rune_initiative"
                            elif roll < 0.45:
                                rune_type = "rune_dommage"

                            if rune_type:
                                # rune_found has no direct WS popup (frontend reads it from
                                # state_update -> pending_events), so pass ws_message=None.
                                await enqueue_player_event(
                                    session_id,
                                    player_id,
                                    {
                                        "type": "rune_found",
                                        "rune_type": rune_type,
                                        "inventory_full": is_inventory_full(player)
                                    },
                                    None
                                )
                                logger.info(f"Player {player_id} found rune: {rune_type}")
                                # Track for Vision Vigilante (survivor picked up an item)
                                if "turn_survivors_items_gained" not in game:
                                    game["turn_survivors_items_gained"] = {}
                                game["turn_survivors_items_gained"][player_id] = room_name

                    # Check for merchant
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_merchant", False):
                        is_trapped = game["rooms"][room_name].get("trap_triggered", False)

                        if not is_trapped:
                            game["rooms"][room_name]["merchant_discovered"] = True
                            game["rooms"][room_name]["merchant_killer_visible"] = False  # NEW: clear killer-only flag

                            await enqueue_player_event(session_id, player_id, "merchant", {
                                "type": "merchant_encounter",
                                "message": "🧙 Vous rencontrez le marchand !",
                                "video_path": "/event/marchand.mp4"
                            })

                    # NEW: Check for cartographer
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_cartographer", False):
                        is_trapped = game["rooms"][room_name].get("trap_triggered", False)

                        if not is_trapped:
                            game["rooms"][room_name]["cartographer_discovered"] = True
                            game["rooms"][room_name]["cartographer_killer_visible"] = False  # NEW: clear killer-only flag

                            await enqueue_player_event(session_id, player_id, "cartographer", {
                                "type": "cartographer_encounter",
                                "message": "🗺️ Vous rencontrez le cartographe !",
                                "video_path": "/event/cartographe.mp4"
                            })

                    # NEW: Check for forge
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_forge", False):
                        is_trapped = game["rooms"][room_name].get("trap_triggered", False)
                        if not is_trapped:
                            game["rooms"][room_name]["forge_discovered"] = True

                            # Just enqueue - the helper will dispatch immediately if no
                            # other event is active, or put the forge at the end of the
                            # queue otherwise (replaces legacy pending_forge_room logic).
                            await enqueue_player_event(session_id, player_id, "forge", {
                                "type": "forge_encounter",
                                "message": "🔥 Vous avez trouvé la Forge ! Voulez-vous utiliser vos runes ?",
                                "video_path": "/event/Forge.mp4"
                            })

                    # NEW: Check for crystal event
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_crystal_event", False):
                        is_trapped = game["rooms"][room_name].get("trap_triggered", False)
                        if not is_trapped:
                            # 1) ALWAYS mark room as discovered for all survivors,
                            #    even if other events (gold, rune, ...) are queued first.
                            game["rooms"][room_name]["crystal_discovered"] = True

                            # 2) Always enqueue the crystal popup. enqueue_player_event
                            #    naturally queues it AFTER pending events (gold_found, rune_found)
                            #    so the player will see gold/rune popups first, then crystal.
                            # NEW: message dynamique selon les reliques requises par l'hôte
                            required_relics = game.get("required_relics", {
                                "relique_spherique": True,
                                "relique_cubique": True,
                                "relique_triangulaire": True,
                            })
                            required_list = [r for r, req in required_relics.items() if req]
                            required_count = len(required_list)
                            if required_count == 3:
                                crystal_msg = "Vous avez trouvé le cristal. Réunissez les 3 reliques pour le rendre vulnérable et gagner la partie."
                            elif required_count == 1:
                                relic_name = required_list[0].replace("relique_", "")
                                crystal_msg = f"Vous avez trouvé le cristal. Réunissez la relique {relic_name} pour le rendre vulnérable et gagner la partie."
                            else:
                                crystal_msg = f"Vous avez trouvé le cristal. Réunissez les {required_count} reliques pour le rendre vulnérable et gagner la partie."
                            
                            await enqueue_player_event(session_id, player_id, "crystal", {
                                "type": "crystal_encounter",
                                "message": crystal_msg,
                                "video_path": "/event/cristal.mp4",
                                "placed_relics": game.get("crystal_placed_relics", {}),
                            })

                            # 3) Push state immediately so the avatar appears on the map
                            #    for ALL survivors right now (otherwise it only updates
                            #    at the end of the turn).
                            await broadcast_to_session(session_id, {
                                "type": "state_update",
                                "game": game
                            }, role_filter="survivor")

                    # NEW: Check for observation stone
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_observation_stone", False):
                        is_trapped = game["rooms"][room_name].get("trap_triggered", False)
                        if not is_trapped:
                            await enqueue_player_event(session_id, player_id, {
                                "type": "pierre_quete_found",
                                "room": room_name,
                                "inventory_full": is_inventory_full(player)
                            }, None)
                            logger.info(f"Player {player_id} ({player['name']}) found the observation stone in {room_name}")

                    # NEW: Check for fleeing goblin
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_fleeing_goblin", False):
                        is_trapped = game["rooms"][room_name].get("trap_triggered", False)
                        if not is_trapped:
                            # Remove goblin from room
                            game["rooms"][room_name]["has_fleeing_goblin"] = False
                            # Calculate survivor initiative
                            survivor_initiative = random.randint(1, 20) + player.get("initiative_bonus", 0)
                            goblin_initiative = 10
                            await enqueue_player_event(session_id, player_id, "fleeing_goblin_combat", {
                                "type": "fleeing_goblin_combat",
                                "goblin": {
                                    "id": "fleeing_goblin",
                                    "name": "Gobelin Fuyard",
                                    "hp": 1,
                                    "maxHp": 1,
                                    "initiative": goblin_initiative
                                },
                                "survivor": {
                                    "id": player_id,
                                    "name": player["name"],
                                    "survivorClass": player.get("character_class", "Guerrier"),
                                    "hp": player.get("hp", 36),
                                    "maxHp": player.get("max_hp", 36),
                                    "initiative": survivor_initiative
                                }
                            })
                            logger.info(f"🐾 Gobelin Fuyard rencontré par {player['name']} dans {room_name} — initiative survivant: {survivor_initiative}, initiative gobelin: {goblin_initiative} → {'survivant attaque' if survivor_initiative >= goblin_initiative else 'gobelin fuit'}")

                    # NEW: Check for trophy item (Chaussons / Couronne / Culotte)
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_trophy"):
                        is_trapped = game["rooms"][room_name].get("trap_triggered", False)
                        if not is_trapped:
                            trophy_type = game["rooms"][room_name]["has_trophy"]
                            await enqueue_player_event(session_id, player_id, {
                                "type": "trophy_found",
                                "room": room_name,
                                "trophy_type": trophy_type,
                                "inventory_full": is_inventory_full(player)
                            }, None)
                            logger.info(f"Player {player_id} ({player['name']}) found trophy '{trophy_type}' in {room_name}")

                    # Check for resurrection stele
                    if player["role"] == "survivor" and game["rooms"][room_name].get("has_resurrection_stele", False):
                        is_trapped = game["rooms"][room_name].get("trap_triggered", False)
                        if not is_trapped:
                            eliminated_survivors = [
                                {"id": pid, "name": p["name"]}
                                for pid, p in game["players"].items()
                                if p["role"] == "survivor" and p.get("eliminated", False)
                            ]
                            game["rooms"][room_name]["resurrection_stele_discovered"] = True
                            # NOTE: do NOT set resurrection_stele_killer_visible here — killers
                            # must discover the stele themselves by searching the room.
                            await enqueue_player_event(session_id, player_id, "resurrection_stele", {
                                "type": "resurrection_stele_encounter",
                                "message": "Vous avez découvert la stèle de résurrection ! Vous pouvez ramener à la vie un coéquipier, en sacrifiant le quart de vos pdv.",
                                "video_path": "/event/Revive.mp4",
                                "eliminated_survivors": eliminated_survivors,
                                "stele_room": room_name,
                            })
                            logger.info(f"Player {player_id} ({player['name']}) discovered resurrection stele in {room_name}")

                    # Killer discovers events in the room they select (visible to killers only)
                    if player["role"] == "killer":
                        room_data = game["rooms"][room_name]
                        killer_event_discovered = False
                        if room_data.get("has_merchant") and not room_data.get("merchant_discovered") and not room_data.get("merchant_killer_visible"):
                            room_data["merchant_killer_visible"] = True
                            killer_event_discovered = True
                            logger.info(f"Killer {player['name']} discovered merchant in {room_name} (killer-only)")
                        if room_data.get("has_cartographer") and not room_data.get("cartographer_discovered") and not room_data.get("cartographer_killer_visible"):
                            room_data["cartographer_killer_visible"] = True
                            killer_event_discovered = True
                            logger.info(f"Killer {player['name']} discovered cartographer in {room_name} (killer-only)")
                        if room_data.get("has_forge") and not room_data.get("forge_discovered") and not room_data.get("forge_killer_visible"):
                            room_data["forge_killer_visible"] = True
                            killer_event_discovered = True
                            logger.info(f"Killer {player['name']} discovered forge in {room_name} (killer-only)")
                        if room_data.get("has_resurrection_stele") and not room_data.get("resurrection_stele_discovered") and not room_data.get("resurrection_stele_killer_visible"):
                            room_data["resurrection_stele_killer_visible"] = True
                            killer_event_discovered = True
                            logger.info(f"Killer {player['name']} discovered resurrection stele in {room_name} (killer-only)")
                        if killer_event_discovered:
                            # Broadcast updated state to killers so they see the new event icon
                            await broadcast_to_session(session_id, {
                                "type": "state_update",
                                "game": game_sessions[session_id]
                            }, role_filter="killer")

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

                # Special case: patrouille spécialisée avec gobelin encore actif →
                # pas de nouvelle pièce, le gobelin existant applique le pouvoir directement
                if power_name == "patrouille":
                    _pevo = (player or {}).get("powers_evolution", {}).get("patrouille", {})
                    _variant = _pevo.get("variant")
                    _patrol_active = (
                        game.get("patrouille_patrol") is not None
                        and game["patrouille_patrol"].get("active", False)
                    )
                    if _variant in ("patrouille", "vadrouille") and _patrol_active:
                        game["pending_power_selections"][player_id]["action_complete"] = True
                        await broadcast_to_session(session_id, {
                            "type": "player_action",
                            "player_id": player_id,
                            "player_name": player["name"],
                            "message": f"✅ {player['name']} a choisi son pouvoir"
                        })
                        await check_power_selection_complete(session_id)
                        continue

                # Special case: traque de masse (niveau 2, variante "masse") →
                # pas de sélection d'étage, le pouvoir s'active directement comme un pouvoir sans action
                if power_name == "traque":
                    _pevo = (player or {}).get("powers_evolution", {}).get("traque", {})
                    if _pevo.get("level") == 2 and _pevo.get("variant") == "masse":
                        game["pending_power_selections"][player_id]["action_complete"] = True
                        await broadcast_to_session(session_id, {
                            "type": "player_action",
                            "player_id": player_id,
                            "player_name": player["name"],
                            "message": f"✅ {player['name']} a choisi son pouvoir"
                        })
                        await check_power_selection_complete(session_id)
                        continue

                if power_def["requires_action"]:
                    game["pending_power_selections"][player_id]["action_complete"] = False

                    payload = {
                        "type": "power_action_required",
                        "power": power_name,
                        "action_type": power_def["action_type"],
                        "rooms_count": power_def.get("rooms_count", 1)
                    }

                    # NEW: For Secousse, send the list of currently discovered events
                    if power_name == "secousse":
                        payload["events"] = get_discovered_events(game)

                    # NEW: For Malediction, send the list of survivors with cursable items
                    if power_name == "malediction":
                        CURSABLE_TYPES = {"rune_dommage", "rune_initiative", "rune_vitalite", "antidote", "couronne", "culotte", "chaussons"}
                        cursable_survivors = []
                        for pid, p in game["players"].items():
                            if p.get("role") == "survivor" and not p.get("eliminated", False):
                                items = []
                                for idx, slot in enumerate(p.get("inventory") or []):
                                    if slot and slot.get("type") in CURSABLE_TYPES:
                                        items.append({"slot_index": idx, "type": slot["type"]})
                                if items:
                                    cursable_survivors.append({
                                        "player_id": pid,
                                        "player_name": p["name"],
                                        "items": items
                                    })
                        payload["cursable_survivors"] = cursable_survivors

                        # NEW: tell the frontend which level-2 specialization is active
                        # ("incertaine" or "masse"), or None for the base power.
                        killer_evolution = (player or {}).get("powers_evolution", {}).get("malediction", {})
                        payload["malediction_variant"] = (
                            killer_evolution.get("variant") if killer_evolution.get("level") == 2 else None
                        )

                    await websocket.send_json(payload)
                else:
                    game["pending_power_selections"][player_id]["action_complete"] = True
                    await broadcast_to_session(session_id, {
                        "type": "player_action",
                        "player_id": player_id,
                        "player_name": game["players"][player_id]["name"],
                        "message": f"✅ {game['players'][player_id]['name']} a choisi son pouvoir"
                    })
                    
                    await check_power_selection_complete(session_id)
            
            elif data["type"] == "select_power_specialization":
                # Handle power specialization selection
                power_name = data.get("power")
                variant = data.get("variant")
                
                if not power_name or not variant:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Spécialisation invalide"
                    })
                    continue
                
                if player["role"] != "killer":
                    continue
                
                # Update power evolution
                if "powers_evolution" not in player:
                    player["powers_evolution"] = {}
                
                if power_name not in player["powers_evolution"]:
                    player["powers_evolution"][power_name] = {"level": 1, "variant": None}
                
                # Upgrade to level 2 with chosen variant
                player["powers_evolution"][power_name]["level"] = 2
                player["powers_evolution"][power_name]["variant"] = variant

                # --- Effets immédiats des variants Poursuite ---
                if power_name == "goliath":
                    if variant == "endurante":
                        # +2 tours si la Poursuite est encore active
                        if game.get("goliath_active", False):
                            game["goliath_turns_remaining"] = game.get("goliath_turns_remaining", 0) + 2
                            extra_msg = f"⚔️ Poursuite Endurante ! La Poursuite dure 2 tours de plus ({game['goliath_turns_remaining']} tours restants)."
                            game["events"].append({"message": extra_msg, "type": "poursuite_status"})
                            await broadcast_to_session(session_id, {"type": "event", "message": extra_msg})
                            logger.info(f"⚔️ Poursuite Endurante : +2 tours → {game['goliath_turns_remaining']} tours restants")

                    elif variant == "precision":
                        # Calculer les positions actuelles des survivants
                        survivor_rooms = set()
                        for p in game["players"].values():
                            if p.get("role") == "survivor" and not p.get("eliminated") and p.get("current_room"):
                                survivor_rooms.add(p["current_room"])
                        # Aussi inclure les pending_actions du tour en cours
                        for pid, action in game.get("pending_actions", {}).items():
                            if pid in game["players"] and game["players"][pid].get("role") == "survivor":
                                room_selected = action.get("room")
                                if room_selected:
                                    survivor_rooms.add(room_selected)

                        # Révéler 1 salle sans survivant par étage
                        floors_order = ["upper_floor", "ground_floor", "basement"]
                        empty_rooms_by_floor = {}
                        for floor_key in floors_order:
                            candidates = []
                            for room_name, room_data in game["rooms"].items():
                                if room_data.get("floor") != floor_key:
                                    continue
                                if room_data.get("locked"):
                                    continue
                                # Salle "vide" = aucun survivant présent ou se dirigeant vers elle
                                if room_name not in survivor_rooms:
                                    candidates.append(room_name)
                            if candidates:
                                empty_rooms_by_floor[floor_key] = random.choice(candidates)

                        # Stocker dans l'état du jeu (visible uniquement par les killers côté App.js)
                        revealed = list(empty_rooms_by_floor.values())
                        game["poursuite_precision_empty_rooms"] = revealed

                        floor_labels = {"upper_floor": "Étage", "ground_floor": "Rez-de-chaussée", "basement": "Sous-sol"}
                        revealed_names = ", ".join(
                            f"{empty_rooms_by_floor[f]} ({floor_labels.get(f, f)})"
                            for f in floors_order if f in empty_rooms_by_floor
                        )
                        precision_msg = f"⚔️ Poursuite de Précision ! Salles sans aventuriers révélées : {revealed_names}."
                        game["events"].append({"message": precision_msg, "type": "poursuite_status", "for_role": "killer"})
                        await broadcast_to_session(session_id, {"type": "event", "message": precision_msg}, role_filter="killer")
                        logger.info(f"⚔️ Poursuite Précision : salles sans survivants → {revealed}")

                # Persist specialization display data so the power card shows the
                # specialized name/description on future turns.
                # NOTE: pending_specializations is cleared before the modal is shown,
                # so we read from pending_events (which still holds the full payload).
                pending_event = game.get("pending_events", {}).get(player_id, {})
                spec_data = (
                    pending_event.get("specializations", {}).get(variant)
                    or game.get("pending_specializations", {})
                       .get(player_id, {})
                       .get("specializations", {})
                       .get(variant, {})
                )
                if spec_data:
                    player["powers_evolution"][power_name]["variant_name"] = spec_data.get("name")
                    player["powers_evolution"][power_name]["variant_description"] = spec_data.get("description")
                    player["powers_evolution"][power_name]["variant_video_path"] = spec_data.get("video_path")

                logger.info(f"🔮 {player['name']} a spécialisé {power_name} vers {variant}")
                
                # Remove pending event
                if player_id in game.get("pending_events", {}):
                    del game["pending_events"][player_id]
                
                # Broadcast update
                await broadcast_to_session(session_id, {
                    "type": "state_update",
                    "game": game_sessions[session_id]
                })
                
                await websocket.send_json({
                    "type": "specialization_confirmed",
                    "power": power_name,
                    "variant": variant,
                    "message": f"✨ {power_name} amélioré vers {variant} !"
                })

                # ✅ Vérifier si tous les killers ont terminé leur spécialisation
                # On vérifie uniquement les pending_events de type "power_specialization"
                # pour ne pas être bloqué par d'éventuels events de combat.
                alive_killers = [
                    p for p in game["players"].values()
                    if p["role"] == "killer" and not p["eliminated"]
                ]
                all_specs_done = all(
                    game.get("pending_events", {}).get(p["id"], {}).get("type") != "power_specialization"
                    for p in alive_killers
                )

                if all_specs_done:
                    logger.info("🔮 Toutes les spécialisations terminées — reprise du flux via process_turn()")
                    # Déléguer entièrement à process_turn() pour éviter la duplication
                    # de logique (poison, Poursuite, nouveau tour, etc.)
                    await process_turn(session_id)
            
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

            elif data["type"] == "curse_item":
                # Killer applies curse on a specific item in a survivor's inventory
                if player["role"] != "killer" or game["phase"] != "killer_power_selection":
                    continue

                target_player_id = data.get("target_player_id")
                slot_index = data.get("slot_index")

                if target_player_id not in game["players"]:
                    continue

                target = game["players"][target_player_id]
                if target.get("role") != "survivor" or target.get("eliminated", False):
                    continue

                inventory = target.get("inventory") or []
                if slot_index is None or slot_index < 0 or slot_index >= len(inventory):
                    continue

                item = inventory[slot_index]
                if not item:
                    continue

                CURSABLE_TYPES = {"rune_dommage", "rune_initiative", "rune_vitalite", "antidote", "couronne", "culotte", "chaussons"}
                if item.get("type") not in CURSABLE_TYPES:
                    continue

                # Mark the item as cursed
                item["cursed"] = True

                # Read the killer's malediction specialization (None = base level 1)
                killer_evolution = (player or {}).get("powers_evolution", {}).get("malediction", {})
                curse_variant = killer_evolution.get("variant") if killer_evolution.get("level") == 2 else None

                # Store curse info in game state
                game["active_curse"] = {
                    "target_player_id": target_player_id,
                    "slot_index": slot_index,
                    "item_type": item["type"],
                    "cursed_by": player_id,
                    "variant": curse_variant
                }

                # SPÉCIALISATION "Malédiction Incertaine" : tous les objets maudissables
                # de l'inventaire ciblé affichent l'overlay de malédiction. Seul item
                # gardera "cursed": True ; les autres reçoivent "cursed_display": True
                # pour le rendu, sans déclencher la levée de malédiction.
                if curse_variant == "incertaine":
                    for idx, slot in enumerate(inventory):
                        if slot and slot.get("type") in CURSABLE_TYPES and idx != slot_index:
                            slot["cursed_display"] = True
                    item["cursed_display"] = True


                # Mark power action as complete
                if player_id in game["pending_power_selections"]:
                    game["pending_power_selections"][player_id]["action_complete"] = True
                    game["pending_power_selections"][player_id]["action_data"] = {
                        "target_player_id": target_player_id,
                        "slot_index": slot_index
                    }

                event_msg = f"🔮 {player['name']} maudit un objet !"
                game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
                await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

                # Broadcast state update so the cursed item renders in inventory
                await broadcast_to_session(session_id, {"type": "state_update", "game": game})

                # Warn all survivors with video + message
                curse_warning_msg = "L'un de vous a son inventaire maudit ! Utilisez ou débarrassez vous de l'objet maudit avant la fin de votre tour pour lever la malédiction , sous peine de perdre 10 points de vie vous et vos coéquipiers !"
                await broadcast_to_session(session_id, {
                    "type": "malediction_warning",
                    "message": curse_warning_msg,
                    "video_path": "/powers/Malediction.mp4"
                }, role_filter="survivor")

                await check_power_selection_complete(session_id)

            elif data["type"] == "curse_item_masse":
                # SPÉCIALISATION "Malédiction de Masse" : le killer maudit simultanément
                # un objet dans l'inventaire de chaque aventurier vivant.
                if player["role"] != "killer" or game["phase"] != "killer_power_selection":
                    continue

                killer_evolution = (player or {}).get("powers_evolution", {}).get("malediction", {})
                if not (killer_evolution.get("level") == 2 and killer_evolution.get("variant") == "masse"):
                    continue

                CURSABLE_TYPES = {"rune_dommage", "rune_initiative", "rune_vitalite", "antidote", "couronne", "culotte", "chaussons"}

                selections = data.get("selections", [])
                if not isinstance(selections, list):
                    continue

                new_curses = []
                cursed_player_names = []

                for sel in selections:
                    target_player_id = sel.get("target_player_id")
                    slot_index = sel.get("slot_index")

                    if target_player_id not in game["players"]:
                        continue

                    target = game["players"][target_player_id]
                    if target.get("role") != "survivor" or target.get("eliminated", False):
                        continue

                    inventory = target.get("inventory") or []
                    if slot_index is None or slot_index < 0 or slot_index >= len(inventory):
                        continue

                    item = inventory[slot_index]
                    if not item or item.get("type") not in CURSABLE_TYPES:
                        continue

                    item["cursed"] = True
                    new_curses.append({
                        "target_player_id": target_player_id,
                        "slot_index": slot_index,
                        "item_type": item["type"],
                        "cursed_by": player_id
                    })
                    cursed_player_names.append(target["name"])

                if not new_curses:
                    continue

                game["active_curses"] = new_curses

                # Mark power action as complete
                if player_id in game["pending_power_selections"]:
                    game["pending_power_selections"][player_id]["action_complete"] = True
                    game["pending_power_selections"][player_id]["action_data"] = {
                        "selections": selections
                    }

                event_msg = f"🔮 {player['name']} maudit un objet dans l'inventaire de chaque aventurier !"
                game["events"].append({"message": event_msg, "type": "power_used", "for_role": "killer"})
                await broadcast_to_session(session_id, {"type": "event", "message": event_msg}, role_filter="killer")

                # Broadcast state update so the cursed items render in inventories
                await broadcast_to_session(session_id, {"type": "state_update", "game": game})

                # Warn all survivors with video + message
                curse_warning_msg = "Chacun de vous a un objet maudit dans son inventaire ! Utilisez ou débarrassez vous de votre objet maudit avant la fin de votre tour pour lever votre malédiction, sous peine de perdre 10 points de vie !"
                await broadcast_to_session(session_id, {
                    "type": "malediction_warning",
                    "message": curse_warning_msg,
                    "video_path": "/powers/MalédictionDeMasse.mp4"
                }, role_filter="survivor")

                await check_power_selection_complete(session_id)

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


            elif data["type"] == "action" and data.get("action", {}).get("type") == "join_combat":
                action_data = data["action"]
                attacker_id = action_data.get("attacker_id")

                combat_window = game.get("combat_help_windows", {}).get(attacker_id)
                if not combat_window:
                    await websocket.send_json({
                        "type": "combat_help_expired",
                        "message": "⏱️ Combat introuvable"
                    })
                    continue

                if time.time() > combat_window["expires_at"] or combat_window.get("finalized"):
                    await websocket.send_json({
                        "type": "combat_help_expired",
                        "message": "⏱️ La fenêtre de combat est expirée"
                    })
                    continue

                # Vérifier que le joueur est éligible
                if player.get("eliminated", False):
                    continue
                if player_id in game.get("pending_actions", {}):
                    continue
                if player_id == attacker_id:
                    continue

                if player_id not in combat_window["participants"]:
                    combat_window["participants"].append(player_id)

                    # Marquer l'action du joueur comme complétée
                    game.setdefault("pending_actions", {})[player_id] = {
                        "type": "join_combat",
                        "combat_id": attacker_id,
                        "room": combat_window["room"],
                    }

                    logger.info(f"✅ {player['name']} rejoint le combat Mimic de {attacker_id}")

                    # Broadcast : informer tous les joueurs (A voit B rejoindre)
                    await broadcast_to_session(session_id, {
                        "type": "player_joined_combat",
                        "player_id": player_id,
                        "player_name": player["name"],
                        "attacker_id": attacker_id,
                        "participants": combat_window["participants"],
                    })

                    # Push state pour mettre à jour les autres clients
                    await broadcast_to_session(session_id, {
                        "type": "state_update",
                        "game": game
                    })

            # NEW: Handle event completion notification from frontend
            elif data["type"] == "event_completed":
                if player_id in game.get("pending_events", {}):
                    del game["pending_events"][player_id]
                    logger.info(f"Player {player_id} completed their event")

                # Dispatch the next queued popup event for this player (if any)
                dispatched = await dispatch_next_player_event(session_id, player_id)

                # Backward-compat: legacy "pending_forge_room" queue (the forge feature still
                # uses this for the rare case where it was queued before this refactor).
                if not dispatched:
                    pending_forge_room = player.get("pending_forge_room") if player else None
                    if pending_forge_room and player_id not in game.get("pending_events", {}):
                        player["pending_forge_room"] = None
                        await enqueue_player_event(session_id, player_id, "forge", {
                            "type": "forge_encounter",
                            "message": "🔥 Vous avez trouvé la Forge ! Voulez-vous utiliser vos runes ?",
                            "video_path": "/event/Forge.mp4",
                        })

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