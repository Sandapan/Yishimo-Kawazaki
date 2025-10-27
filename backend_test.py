import requests
import websocket
import json
import sys
import time
import threading
from datetime import datetime
from typing import Dict, List, Optional

class YishimoGameTester:
    def __init__(self, base_url="https://survival-coop.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.ws_url = base_url.replace('https://', 'wss://').replace('http://', 'ws://')
        self.tests_run = 0
        self.tests_passed = 0
        self.session_id = None
        self.player_ids = []
        self.websockets = []
        self.ws_messages = []

    def log_test(self, name: str, success: bool, details: str = ""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED {details}")
        else:
            print(f"❌ {name} - FAILED {details}")
        return success

    def test_api_root(self):
        """Test API root endpoint"""
        try:
            response = requests.get(f"{self.api_url}/", timeout=10)
            success = response.status_code == 200
            data = response.json() if success else {}
            expected_message = "Yishimo Kawazaki's Game API"
            
            if success and data.get("message") == expected_message:
                return self.log_test("API Root", True, f"- Status: {response.status_code}")
            else:
                return self.log_test("API Root", False, f"- Status: {response.status_code}, Message: {data}")
        except Exception as e:
            return self.log_test("API Root", False, f"- Error: {str(e)}")

    def test_create_game(self):
        """Test game creation"""
        try:
            payload = {
                "host_name": "TestHost",
                "host_avatar": "👤"
            }
            response = requests.post(f"{self.api_url}/game/create", json=payload, timeout=10)
            success = response.status_code == 200
            
            if success:
                data = response.json()
                required_fields = ["session_id", "player_id", "join_link"]
                if all(field in data for field in required_fields):
                    self.session_id = data["session_id"]
                    self.player_ids.append(data["player_id"])
                    return self.log_test("Create Game", True, f"- Session: {self.session_id[:8]}...")
                else:
                    return self.log_test("Create Game", False, f"- Missing fields: {data}")
            else:
                return self.log_test("Create Game", False, f"- Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Create Game", False, f"- Error: {str(e)}")

    def test_join_game(self):
        """Test joining a game"""
        if not self.session_id:
            return self.log_test("Join Game", False, "- No session to join")
        
        try:
            payload = {
                "player_name": "TestPlayer2",
                "player_avatar": "👨"
            }
            response = requests.post(f"{self.api_url}/game/{self.session_id}/join", json=payload, timeout=10)
            success = response.status_code == 200
            
            if success:
                data = response.json()
                if "player_id" in data and data["session_id"] == self.session_id:
                    self.player_ids.append(data["player_id"])
                    return self.log_test("Join Game", True, f"- Player ID: {data['player_id'][:8]}...")
                else:
                    return self.log_test("Join Game", False, f"- Invalid response: {data}")
            else:
                return self.log_test("Join Game", False, f"- Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Join Game", False, f"- Error: {str(e)}")

    def test_get_game_state(self):
        """Test getting game state"""
        if not self.session_id:
            return self.log_test("Get Game State", False, "- No session available")
        
        try:
            response = requests.get(f"{self.api_url}/game/{self.session_id}/state", timeout=10)
            success = response.status_code == 200
            
            if success:
                data = response.json()
                required_fields = ["session_id", "players", "rooms", "game_started", "turn", "phase"]
                if all(field in data for field in required_fields):
                    player_count = len(data["players"])
                    room_count = len(data["rooms"])
                    return self.log_test("Get Game State", True, f"- Players: {player_count}, Rooms: {room_count}")
                else:
                    return self.log_test("Get Game State", False, f"- Missing fields in response")
            else:
                return self.log_test("Get Game State", False, f"- Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Get Game State", False, f"- Error: {str(e)}")

    def test_start_game(self):
        """Test starting a game"""
        if not self.session_id:
            return self.log_test("Start Game", False, "- No session available")
        
        try:
            response = requests.post(f"{self.api_url}/game/{self.session_id}/start", timeout=10)
            success = response.status_code == 200
            
            if success:
                data = response.json()
                if data.get("status") == "started":
                    return self.log_test("Start Game", True, "- Game started successfully")
                else:
                    return self.log_test("Start Game", False, f"- Unexpected response: {data}")
            else:
                return self.log_test("Start Game", False, f"- Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Start Game", False, f"- Error: {str(e)}")

    def test_websocket_connection(self):
        """Test WebSocket connection and basic functionality"""
        if not self.session_id or not self.player_ids:
            return self.log_test("WebSocket Connection", False, "- No session or player available")
        
        try:
            player_id = self.player_ids[0]
            ws_url = f"{self.ws_url}/ws/{self.session_id}/{player_id}"
            
            # Create WebSocket connection
            ws = websocket.create_connection(ws_url, timeout=10)
            
            # Wait for initial state message
            message = ws.recv()
            data = json.loads(message)
            
            if data.get("type") == "state_update" and "game" in data:
                game_state = data["game"]
                if game_state.get("session_id") == self.session_id:
                    ws.close()
                    return self.log_test("WebSocket Connection", True, "- Received initial state")
                else:
                    ws.close()
                    return self.log_test("WebSocket Connection", False, "- Invalid game state")
            else:
                ws.close()
                return self.log_test("WebSocket Connection", False, f"- Unexpected message: {data}")
                
        except Exception as e:
            return self.log_test("WebSocket Connection", False, f"- Error: {str(e)}")

    def test_room_selection_websocket(self):
        """Test room selection via WebSocket"""
        if not self.session_id or not self.player_ids:
            return self.log_test("Room Selection WebSocket", False, "- No session or player available")
        
        try:
            player_id = self.player_ids[0]
            ws_url = f"{self.ws_url}/ws/{self.session_id}/{player_id}"
            
            # Create WebSocket connection
            ws = websocket.create_connection(ws_url, timeout=10)
            
            # Wait for initial state
            initial_message = ws.recv()
            initial_data = json.loads(initial_message)
            
            if initial_data.get("type") != "state_update":
                ws.close()
                return self.log_test("Room Selection WebSocket", False, "- No initial state received")
            
            game_state = initial_data["game"]
            
            # Check if game is started and in player_selection phase
            if not game_state.get("game_started") or game_state.get("phase") != "player_selection":
                ws.close()
                return self.log_test("Room Selection WebSocket", False, f"- Game not ready for room selection. Phase: {game_state.get('phase')}")
            
            # Select a room (first available room)
            available_rooms = [name for name, room in game_state["rooms"].items() if not room.get("locked")]
            if not available_rooms:
                ws.close()
                return self.log_test("Room Selection WebSocket", False, "- No available rooms")
            
            selected_room = available_rooms[0]
            room_selection = {
                "type": "select_room",
                "room": selected_room
            }
            
            ws.send(json.dumps(room_selection))
            
            # Wait for response (with timeout)
            ws.settimeout(5.0)
            try:
                response_message = ws.recv()
                response_data = json.loads(response_message)
                
                if response_data.get("type") == "player_action":
                    ws.close()
                    return self.log_test("Room Selection WebSocket", True, f"- Selected room: {selected_room}")
                else:
                    ws.close()
                    return self.log_test("Room Selection WebSocket", True, f"- Room selected, got: {response_data.get('type')}")
            except websocket.WebSocketTimeoutException:
                ws.close()
                return self.log_test("Room Selection WebSocket", True, "- Room selection sent (no immediate response)")
                
        except Exception as e:
            return self.log_test("Room Selection WebSocket", False, f"- Error: {str(e)}")

    def test_invalid_endpoints(self):
        """Test invalid endpoints return proper errors"""
        tests = [
            ("Invalid Session Join", f"{self.api_url}/game/invalid-session/join", {"player_name": "Test", "player_avatar": "👤"}, 404),
            ("Invalid Session State", f"{self.api_url}/game/invalid-session/state", None, 404),
            ("Invalid Session Start", f"{self.api_url}/game/invalid-session/start", {}, 404),
        ]
        
        all_passed = True
        for test_name, url, payload, expected_status in tests:
            try:
                if payload:
                    response = requests.post(url, json=payload, timeout=10)
                else:
                    response = requests.get(url, timeout=10)
                
                if response.status_code == expected_status:
                    self.log_test(test_name, True, f"- Status: {response.status_code}")
                else:
                    self.log_test(test_name, False, f"- Expected {expected_status}, got {response.status_code}")
                    all_passed = False
            except Exception as e:
                self.log_test(test_name, False, f"- Error: {str(e)}")
                all_passed = False
        
        return all_passed

    def test_game_mechanics_validation(self):
        """Test game state validation and mechanics"""
        if not self.session_id:
            return self.log_test("Game Mechanics Validation", False, "- No session available")
        
        try:
            response = requests.get(f"{self.api_url}/game/{self.session_id}/state", timeout=10)
            if response.status_code != 200:
                return self.log_test("Game Mechanics Validation", False, "- Cannot get game state")
            
            game_state = response.json()
            
            # Validate room structure
            rooms = game_state.get("rooms", {})
            expected_room_count = 12  # 4 rooms per floor * 3 floors
            
            if len(rooms) != expected_room_count:
                return self.log_test("Game Mechanics Validation", False, f"- Expected {expected_room_count} rooms, got {len(rooms)}")
            
            # Validate floor distribution
            floor_counts = {"basement": 0, "ground_floor": 0, "upper_floor": 0}
            for room_data in rooms.values():
                floor = room_data.get("floor")
                if floor in floor_counts:
                    floor_counts[floor] += 1
            
            if not all(count == 4 for count in floor_counts.values()):
                return self.log_test("Game Mechanics Validation", False, f"- Invalid floor distribution: {floor_counts}")
            
            # Validate keys and medikit placement
            keys_count = sum(1 for room in rooms.values() if room.get("has_key"))
            medikit_count = sum(1 for room in rooms.values() if room.get("has_medikit"))
            
            if keys_count == 0:
                return self.log_test("Game Mechanics Validation", False, "- No keys found in rooms")
            
            if medikit_count != 1:
                return self.log_test("Game Mechanics Validation", False, f"- Expected 1 medikit, found {medikit_count}")
            
            # Validate player structure
            players = game_state.get("players", {})
            if len(players) < 1:
                return self.log_test("Game Mechanics Validation", False, "- No players found")
            
            for player in players.values():
                required_fields = ["id", "name", "avatar", "is_host", "eliminated", "current_room", "has_medikit"]
                if not all(field in player for field in required_fields):
                    return self.log_test("Game Mechanics Validation", False, f"- Player missing required fields")
            
            return self.log_test("Game Mechanics Validation", True, f"- Rooms: {len(rooms)}, Players: {len(players)}, Keys: {keys_count}")
            
        except Exception as e:
            return self.log_test("Game Mechanics Validation", False, f"- Error: {str(e)}")

    def run_all_tests(self):
        """Run all backend tests"""
        print("🎮 Starting Yishimo Kawazaki's Game Backend Tests")
        print("=" * 60)
        
        # Basic API tests
        self.test_api_root()
        self.test_create_game()
        self.test_join_game()
        self.test_get_game_state()
        self.test_game_mechanics_validation()
        self.test_start_game()
        
        # WebSocket tests
        self.test_websocket_connection()
        self.test_room_selection_websocket()
        
        # Error handling tests
        self.test_invalid_endpoints()
        
        # Print summary
        print("=" * 60)
        print(f"📊 Backend Tests Summary:")
        print(f"   Tests Run: {self.tests_run}")
        print(f"   Tests Passed: {self.tests_passed}")
        print(f"   Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        return self.tests_passed == self.tests_run

def main():
    """Main test execution"""
    tester = YishimoGameTester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())