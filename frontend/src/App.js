import { useState, useEffect, useRef } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

// Avatar images by role with their associated classes and descriptions
const SURVIVOR_AVATARS = [
  { 
    path: "/avatars/Archère.png", 
    class: "Archère",
    description: "Ses flèches atteignent les cibles les plus éloignées avec une précision redoutable…"
  },
  { 
    path: "/avatars/Assassin.png", 
    class: "Assassin",
    description: "Agile et silencieux, il se faufile entre les pièges sans un bruit. Enfin, sauf quand il est enrhumé."
  },
  { 
    path: "/avatars/Barbare.png", 
    class: "Barbare",
    description: "Un vrai bourrin qui résout tous les problèmes à coups de hache. Même ceux qui demandent juste un peu de diplomatie."
  },
  { 
    path: "/avatars/Barde.png", 
    class: "Barde",
    description: "Le musicien raté du groupe. Son instrument ? Une arme sonore capable d'endormir certaines créatures."
  },
  { 
    path: "/avatars/Elfe.png", 
    class: "Elfe",
    description: "Elle seule sait lire l'elfique. Ça tombe bien : elle ne sait lire que ça."
  },
  { 
    path: "/avatars/Guerrier.png", 
    class: "Guerrier",
    description: "Vaillant et téméraire, il est élu de cette aventure. Enfin ça c'est ce qu'il croit."
  },
  { 
    path: "/avatars/Mage.png", 
    class: "Mage",
    description: "Son bâton magique peut incendier certains décors… parfois même sa propre barbe."
  }
];

const KILLER_AVATARS = [
  { 
    path: "/avatars/Orc Berzerker.png", 
    class: "Orc Berzerker",
    description: "Votre soif de vengeance n'a d'yeux que pour ces sales petits voleurs. Et parfois, pour le buffet après la bataille."
  },
  { 
    path: "/avatars/Orc Chaman.png", 
    class: "Orc Chaman",
    description: "Traquer les intrus, très peu pour vous. Vous préférez laisser ce travail à vos morts-vivants — ils sont bien moins bavards."
  },
  { 
    path: "/avatars/Orc Roi.png", 
    class: "Orc Roi",
    description: "« Rendez les bijoux de la couronne ! Bande de losers, de voleurs, de crapules !» hurlez-vous avec rage."
  }
];

// Helper function to get class from avatar path
const getAvatarClass = (avatarPath) => {
  const allAvatars = [...SURVIVOR_AVATARS, ...KILLER_AVATARS];
  const avatar = allAvatars.find(a => a.path === avatarPath);
  return avatar ? avatar.class : null;
};

const FLOOR_NAMES = {
  "basement": "🕳️ Sous-sol",
  "ground_floor": "🏰 Rez-de-chaussée",
  "upper_floor": "🕯️ Étage"
};

// MODIFIED: Helper function to copy text with fallback
const copyToClipboard = (text) => {
  // Method 1: Try modern Clipboard API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text)
      .then(() => true)
      .catch(() => false);
  }
  
  // Method 2: Fallback for older browsers or non-HTTPS contexts
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    
    return Promise.resolve(successful);
  } catch (err) {
    return Promise.resolve(false);
  }
};

// Home Page - Create or Join Game
const Home = () => {
  const [playerName, setPlayerName] = useState("");
  const [selectedRole, setSelectedRole] = useState("survivor"); // "survivor" or "killer"
  const [selectedAvatar, setSelectedAvatar] = useState(SURVIVOR_AVATARS[0]);
  const [conspiracyMode, setConspiracyMode] = useState(false); // NEW: conspiracy mode
  const [joinSessionId, setJoinSessionId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const navigate = useNavigate();

  // Get available avatars based on selected role
  const availableAvatars = selectedRole === "survivor" ? SURVIVOR_AVATARS : KILLER_AVATARS;

  // Check if returning from lobby to change role/avatar
  useEffect(() => {
    const returningFromLobby = localStorage.getItem('returning_from_lobby');
    const pendingSessionId = localStorage.getItem('pending_session_id');
    const currentPlayerName = localStorage.getItem('player_name');

    if (returningFromLobby === 'true' && pendingSessionId) {
      // Pre-fill the form with existing data
      setJoinSessionId(pendingSessionId);
      if (currentPlayerName) {
        setPlayerName(currentPlayerName);
      }
      
      // Mark that we're updating an existing player
      localStorage.setItem('is_updating_player', 'true');
      
      // Show info message
      toast.info("Choisissez un nouveau rôle et avatar pour rejoindre le lobby");
      
      // Clean up the flags
      localStorage.removeItem('returning_from_lobby');
      localStorage.removeItem('pending_session_id');
    }
  }, []);

  // Update selected avatar when role changes
  useEffect(() => {
    const newAvatars = selectedRole === "survivor" ? SURVIVOR_AVATARS : KILLER_AVATARS;
    setSelectedAvatar(newAvatars[0]);
  }, [selectedRole]);

  const createGame = async () => {
    if (!playerName.trim()) {
      toast.error("Veuillez entrer un nom");
      return;
    }

    setIsCreating(true);
    try {
      const response = await axios.post(`${API}/game/create`, {
        host_name: playerName,
        host_avatar: selectedAvatar.path,  // MODIFIED: send path instead of full object
        role: selectedRole,
        conspiracy_mode: conspiracyMode // NEW: send conspiracy mode
      });

      const { session_id, player_id } = response.data;
      localStorage.setItem('player_id', player_id);
      localStorage.setItem('player_name', playerName);
      navigate(`/lobby/${session_id}`);
    } catch (error) {
      console.error("Error creating game:", error);
      toast.error("Erreur lors de la création de la partie");
    } finally {
      setIsCreating(false);
    }
  };

  const joinGame = async () => {
    if (!playerName.trim()) {
      toast.error("Veuillez entrer un nom");
      return;
    }
    if (!joinSessionId.trim()) {
      toast.error("Veuillez entrer un code de session");
      return;
    }

    setIsJoining(true);
    try {
      const existingPlayerId = localStorage.getItem('player_id');
      const isUpdatingPlayer = localStorage.getItem('is_updating_player') === 'true';
      
      // If we're updating an existing player (coming back from lobby)
      if (isUpdatingPlayer && existingPlayerId) {
        await axios.post(`${API}/game/${joinSessionId}/update_player`, {
          player_name: playerName,
          player_avatar: selectedAvatar.path,
          role: selectedRole
        }, {
          params: {
            player_id: existingPlayerId
          }
        });
        
        // Keep the same player_id
        localStorage.setItem('player_name', playerName);
        localStorage.removeItem('is_updating_player');
        toast.success("Profil mis à jour !");
        navigate(`/lobby/${joinSessionId}`);
      } else {
        // Normal join for a new player
        const response = await axios.post(`${API}/game/${joinSessionId}/join`, {
          player_name: playerName,
          player_avatar: selectedAvatar.path,
          role: selectedRole
        });

        const { session_id, player_id } = response.data;
        localStorage.setItem('player_id', player_id);
        localStorage.setItem('player_name', playerName);
        navigate(`/lobby/${session_id}`);
      }
    } catch (error) {
      console.error("Error joining game:", error);
      toast.error("Erreur : session introuvable ou partie déjà commencée");
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="home-container" data-testid="home-page">
      <div className="home-content">
        <h1 className="game-title" data-testid="game-title">Yishimo Kawazaki's Game</h1>
        <p className="game-subtitle">Un jeu de survie coopératif</p>

        <Card className="setup-card">
          <CardHeader>
            <CardTitle>Configuration du joueur</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="input-label">Votre nom</label>
              <Input
                data-testid="player-name-input"
                placeholder="Entrez votre nom"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="dark-input"
              />
            </div>

            <div>
              <label className="input-label">Choisissez votre avatar</label>
              <div className="avatar-grid">
                {availableAvatars.map((avatar, idx) => (
                  <button
                    key={idx}
                    data-testid={`avatar-option-${idx}`}
                    className={`avatar-option ${selectedAvatar.path === avatar.path ? 'selected' : ''}`}
                    onClick={() => setSelectedAvatar(avatar)}
                  >
                    <img src={avatar.path} alt={`Avatar ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </button>
                ))}
              </div>
              
              {/* Character class description */}
              {selectedAvatar && (
                <div style={{ 
                  marginTop: '1rem', 
                  padding: '1rem', 
                  backgroundColor: 'rgba(139, 92, 46, 0.2)',
                  border: '2px solid rgba(139, 92, 46, 0.5)',
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <h3 style={{ 
                    fontSize: '1.2em', 
                    fontWeight: 'bold', 
                    color: '#d4af37',
                    marginBottom: '0.5rem',
                    textShadow: '1px 1px 2px rgba(0,0,0,0.5)'
                  }}>
                    {selectedAvatar.class}
                  </h3>
                  <p style={{ 
                    fontSize: '0.95em', 
                    color: '#e0e0e0',
                    fontStyle: 'italic',
                    lineHeight: '1.4'
                  }}>
                    {selectedAvatar.description}
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="input-label">Choisissez votre rôle</label>
              <div className="role-selector">
                <button
                  data-testid="role-survivor-btn"
                  className={`role-option ${selectedRole === 'survivor' ? 'selected' : ''}`}
                  onClick={() => setSelectedRole('survivor')}
                  disabled={conspiracyMode}
                >
                  <span className="role-icon">🛡️</span>
                  <span className="role-name">Survivant</span>
                </button>
                <button
                  data-testid="role-killer-btn"
                  className={`role-option killer ${selectedRole === 'killer' ? 'selected' : ''}`}
                  onClick={() => setSelectedRole('killer')}
                  disabled={conspiracyMode}
                >
                  <span className="role-icon">🔪</span>
                  <span className="role-name">Tueur</span>
                </button>
              </div>
            </div>

            {/* NEW: Conspiracy Mode Toggle */}
            <div>
              <label className="input-label">Mode de jeu</label>
              <button
                data-testid="conspiracy-mode-btn"
                className={`role-option ${conspiracyMode ? 'selected' : ''}`}
                onClick={() => setConspiracyMode(!conspiracyMode)}
                style={{ width: '100%', marginTop: '0.5rem' }}
              >
                <span className="role-icon">🎭</span>
                <span className="role-name">Mode Complot</span>
                {conspiracyMode && <span style={{ marginLeft: '0.5rem', fontSize: '0.9em' }}>✓ Activé</span>}
              </button>
              {conspiracyMode && (
                <p style={{ fontSize: '0.85em', color: '#888', marginTop: '0.5rem', textAlign: 'center' }}>
                  Les rôles seront attribués aléatoirement au début de la partie
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="action-buttons">
          <Button
            data-testid="create-game-btn"
            onClick={createGame}
            disabled={isCreating}
            className="primary-btn"
          >
            {isCreating ? "Création..." : "Créer une partie"}
          </Button>

          <div className="join-section">
            <Input
              data-testid="join-session-input"
              placeholder="Code de session"
              value={joinSessionId}
              onChange={(e) => setJoinSessionId(e.target.value.toUpperCase())}
              className="dark-input"
              style={{ textTransform: 'uppercase' }}
            />
            <Button
              data-testid="join-game-btn"
              onClick={joinGame}
              disabled={isJoining}
              className="secondary-btn"
            >
              {isJoining ? "Connexion..." : "Rejoindre"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Lobby Page - Wait for players and start game
const Lobby = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [gameState, setGameState] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const ws = useRef(null);

  useEffect(() => {
    const storedPlayerId = localStorage.getItem('player_id');
    setPlayerId(storedPlayerId);

    // Fetch initial game state
    const fetchGameState = async () => {
      try {
        const response = await axios.get(`${API}/game/${sessionId}/state?player_id=${storedPlayerId}`);
        setGameState(response.data);
      } catch (error) {
        console.error("Error fetching game state:", error);
        toast.error("Erreur lors du chargement de la partie");
      }
    };

    fetchGameState();

    // Connect WebSocket
    ws.current = new WebSocket(`${WS_URL}/api/ws/${sessionId}/${storedPlayerId}`);

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "state_update") {
        setGameState(data.game);
      } else if (data.type === "player_joined") {
        toast.success(`${data.player.name} a rejoint la partie`);
      } else if (data.type === "game_started") {
        toast.success(data.message);
        setTimeout(() => navigate(`/game/${sessionId}?pid=${storedPlayerId}`), 1000);
      } else if (data.type === "game_reset") {
        toast.info(data.message);
        // Fetch updated state
        fetchGameState();
      } else if (data.type === "role_changed") {
        toast.info(`${data.player_name} a changé de rôle`);
      } else if (data.type === "player_updated") {
        toast.info(`${data.player.name} a mis à jour son profil`);
        fetchGameState();
      }
    };

    ws.current.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [sessionId, navigate]);

  const startGame = async () => {
    try {
      await axios.post(`${API}/game/${sessionId}/start`);
    } catch (error) {
      console.error("Error starting game:", error);
      toast.error("Erreur lors du démarrage");
    }
  };

  // MODIFIED: Redirect to role selection instead of changing role directly
  const changeRole = (targetPlayerId, currentRole) => {
    // Only allow changing own role
    if (targetPlayerId !== playerId) {
      return;
    }
    
    // Don't allow role change in conspiracy mode
    if (gameState.conspiracy_mode) {
      toast.info("Impossible de changer de rôle en mode complot");
      return;
    }
    
    // Store the session ID for rejoining after role/avatar selection
    localStorage.setItem('returning_from_lobby', 'true');
    localStorage.setItem('pending_session_id', sessionId);
    
    // Close WebSocket connection before leaving
    if (ws.current) {
      ws.current.close();
    }
    
    // Navigate back to home for role/avatar selection
    navigate('/');
  };

  // MODIFIED: Copy function with fallback
  const copyJoinLink = async () => {
    const success = await copyToClipboard(sessionId);
    if (success) {
      toast.success("Code de session copié !");
    } else {
      toast.error("Impossible de copier. Veuillez copier manuellement : " + sessionId);
    }
  };

  if (!gameState) {
    return <div className="loading">Chargement...</div>;
  }

  const isHost = gameState.players[playerId]?.is_host;
  const playerCount = Object.keys(gameState.players).length;

  return (
    <div className="lobby-container" data-testid="lobby-page">
      <div className="lobby-content">
        <h1 className="lobby-title">Salle d'attente</h1>

        <Card className="lobby-card">
          <CardHeader>
            <CardTitle>Code de session</CardTitle>
            <CardDescription>Partagez ce code avec vos amis</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="session-code-box">
              <code className="session-code" data-testid="session-code" style={{ textTransform: 'uppercase' }}>{sessionId}</code>
              <Button
                data-testid="copy-session-btn"
                onClick={copyJoinLink}
                className="copy-btn"
                size="sm"
              >
                Copier
              </Button>
            </div>
            {/* NEW: Show conspiracy mode indicator */}
            {gameState.conspiracy_mode && (
              <div style={{ 
                marginTop: '1rem', 
                padding: '0.75rem', 
                backgroundColor: 'rgba(128, 90, 213, 0.1)', 
                borderRadius: '0.5rem',
                textAlign: 'center',
                border: '1px solid rgba(128, 90, 213, 0.3)'
              }}>
                <span style={{ fontSize: '1.2em' }}>🎭</span>
                <span style={{ marginLeft: '0.5rem', fontWeight: '500' }}>Mode Complot Activé</span>
                <p style={{ fontSize: '0.85em', color: '#888', marginTop: '0.25rem' }}>
                  Les rôles seront attribués aléatoirement au début de la partie
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="players-card">
          <CardHeader>
            <CardTitle>Joueurs ({playerCount}/8)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="players-list">
              {Object.values(gameState.players).map((player) => {
                const isCurrentPlayer = player.id === playerId;
                
                return (
                  <div key={player.id} className="player-item" data-testid={`player-${player.id}`}>
                    <span className="player-avatar">
                      <img src={player.avatar} alt={player.name} style={{ width: '2rem', height: '2rem', objectFit: 'contain' }} />
                    </span>
                    <span className="player-name">{player.name}</span>
                    {/* MODIFIED: Non-clickable role badges */}
                    {!gameState.conspiracy_mode && player.role === "killer" && (
                      <span className="killer-badge">
                        🔪 Tueur
                      </span>
                    )}
                    {!gameState.conspiracy_mode && player.role === "survivor" && (
                      <span className="survivor-badge">
                        🛡️ Survivant
                      </span>
                    )}
                    {/* MODIFIED: Button to return to role/avatar selection */}
                    {!gameState.conspiracy_mode && isCurrentPlayer && (
                      <button
                        className="switch-role-btn"
                        onClick={() => changeRole(player.id, player.role)}
                        title="Changer de rôle et d'avatar"
                        data-testid="switch-role-btn"
                      >
                        🔄
                      </button>
                    )}
                    {player.is_host && <span className="host-badge">Hôte</span>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {isHost && (
          <Button
            data-testid="start-game-btn"
            onClick={startGame}
            disabled={playerCount < 1}
            className="start-btn"
          >
            Démarrer la partie
          </Button>
        )}

        {!isHost && (
          <p className="waiting-text">En attente que l'hôte démarre la partie...</p>
        )}
      </div>
    </div>
  );
};

// Power Selection Overlay Component
const PowerSelectionOverlay = ({ 
  gameState, 
  playerId, 
  powerDefinitions, 
  selectedPower, 
  selectPower, 
  showPowerAction, 
  confirmPowerAction,
  powerActionData 
}) => {
  const [tempRoomSelections, setTempRoomSelections] = useState([]);
  
  const myPowerSelection = gameState.pending_power_selections?.[playerId];
  if (!myPowerSelection) return null;
  
  const powerOptions = myPowerSelection.options || [];
  const hasCompletedSelection = myPowerSelection.action_complete;
  
  // Room selection for powers that require it
  const selectedPowerDef = powerDefinitions[selectedPower];
  const requiresAction = selectedPowerDef?.requires_action;
  const actionType = selectedPowerDef?.action_type;
  
  const handleRoomSelection = (roomName) => {
    if (actionType === "select_rooms_per_floor") {
      // Piege: 1 room per floor
      const room = gameState.rooms[roomName];
      const floor = room.floor;
      
      // Check if we already have a room from this floor
      const existingRoomFromFloor = tempRoomSelections.find(r => gameState.rooms[r].floor === floor);
      if (existingRoomFromFloor) {
        // Replace it
        setTempRoomSelections(tempRoomSelections.filter(r => r !== existingRoomFromFloor).concat([roomName]));
      } else {
        setTempRoomSelections([...tempRoomSelections, roomName]);
      }
    } else if (actionType === "select_rooms") {
      // Barricade: 2 rooms
      const roomsCount = selectedPowerDef.rooms_count || 2;
      if (tempRoomSelections.includes(roomName)) {
        setTempRoomSelections(tempRoomSelections.filter(r => r !== roomName));
      } else if (tempRoomSelections.length < roomsCount) {
        setTempRoomSelections([...tempRoomSelections, roomName]);
      }
    }
  };
  
  const canConfirmAction = () => {
    if (actionType === "select_rooms_per_floor") {
      // Must select from at least one floor
      return tempRoomSelections.length > 0;
    } else if (actionType === "select_rooms") {
      // Must select exactly the required number
      return tempRoomSelections.length === (selectedPowerDef.rooms_count || 2);
    }
    return false;
  };
  
  if (hasCompletedSelection && !showPowerAction) {
    return (
      <div className="power-selection-overlay">
        <Card className="power-waiting-card">
          <CardContent className="text-center" style={{ padding: '2rem' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>✅ Pouvoir sélectionné</h2>
            <p>En attente des autres tueurs...</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (showPowerAction && requiresAction) {
    // Show room selection interface
    return (
      <div className="power-selection-overlay">
        <Card className="power-action-card">
          <CardHeader>
            <CardTitle className="text-center">
              {selectedPowerDef.name}
            </CardTitle>
            <CardDescription className="text-center">
              {selectedPowerDef.description}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center mb-4">
              {actionType === "select_rooms_per_floor" && "Sélectionnez une pièce par étage à piéger:"}
              {actionType === "select_rooms" && `Sélectionnez ${selectedPowerDef.rooms_count} pièces à verrouiller:`}
            </p>
            
            <div className="rooms-selection-grid">
              {["upper_floor", "ground_floor", "basement"].map(floor => (
                <div key={floor} className="floor-section-mini">
                  <h4>{FLOOR_NAMES[floor]}</h4>
                  <div className="rooms-mini-grid">
                    {Object.entries(gameState.rooms)
                      .filter(([_, data]) => data.floor === floor)
                      .map(([roomName, roomData]) => {
                        const isSelected = tempRoomSelections.includes(roomName);
                        const isLocked = roomData.locked;
                        const isTrapped = roomData.trapped; // FIXED: Show trapped rooms
                        
                        return (
                          <button
                            key={roomName}
                            className={`room-mini-btn ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''}`}
                            onClick={() => !isLocked && handleRoomSelection(roomName)}
                            disabled={isLocked}
                          >
                            {roomName}
                            {isSelected && " ✓"}
                            {isTrapped && " 🕸️"}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
            
            <Button
              onClick={() => confirmPowerAction({ rooms: tempRoomSelections })}
              disabled={!canConfirmAction()}
              className="w-full mt-4"
              style={{ backgroundColor: canConfirmAction() ? '#8b5cf6' : '#555' }}
            >
              Confirmer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="power-selection-overlay">
      <Card className="power-selection-card">
        <CardHeader>
          <CardTitle className="text-center power-selection-title">
            🎴 Choisissez votre pouvoir
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="power-cards-container">
            {powerOptions.map((powerName, index) => {
              const power = powerDefinitions[powerName];
              if (!power) return null;
              
              const isSelected = selectedPower === powerName;
              
              return (
                <div 
                  key={powerName} 
                  className={`power-card ${isSelected ? 'power-card-selected' : ''}`}
                  onClick={() => !selectedPower && selectPower(powerName)}
                  style={{ animationDelay: `${index * 0.15}s` }}
                >
                  <div className="power-card-image">
                    <img 
                      src={`/powers/${power.icon}`} 
                      alt={power.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                  <div className="power-card-content">
                    <h3 className="power-card-name">{power.name}</h3>
                    <p className="power-card-description">{power.description}</p>
                  </div>
                  {isSelected && (
                    <div className="power-card-selected-badge">✓</div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// Game Page - Main gameplay
const Game = () => {
  const { sessionId } = useParams();
  const [gameState, setGameState] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [hasSelectedRoom, setHasSelectedRoom] = useState(false);
  const [showRoleNotification, setShowRoleNotification] = useState(false); // NEW: role notification
  const [assignedRole, setAssignedRole] = useState(null); // NEW: assigned role
  
  // NEW: Power selection states
  const [selectedPower, setSelectedPower] = useState(null);
  const [powerActionData, setPowerActionData] = useState(null);
  const [showPowerAction, setShowPowerAction] = useState(false);
  const [powerDefinitions, setPowerDefinitions] = useState({});
  
  // NEW: Key found popup state
  const [showKeyFoundPopup, setShowKeyFoundPopup] = useState(false);
  const [keyFoundMessage, setKeyFoundMessage] = useState("");
  
  // NEW: Trap popup state
  const [showTrapPopup, setShowTrapPopup] = useState(false);
  
  const ws = useRef(null);
  const eventsEndRef = useRef(null);
  const hasShownRoleNotification = useRef(false); // Track if role notification was shown

  useEffect(() => {
    // Get player_id from URL query params or localStorage
    const urlParams = new URLSearchParams(window.location.search);
    const pidFromUrl = urlParams.get('pid');
    const storedPlayerId = pidFromUrl || localStorage.getItem('player_id');
    setPlayerId(storedPlayerId);

    // Fetch power definitions
    const fetchPowers = async () => {
      try {
        const response = await axios.get(`${API}/powers`);
        setPowerDefinitions(response.data);
      } catch (error) {
        console.error("Error fetching powers:", error);
      }
    };
    fetchPowers();

    // Fetch initial game state
    const fetchGameState = async () => {
      try {
        const response = await axios.get(`${API}/game/${sessionId}/state?player_id=${storedPlayerId}`);
        setGameState(response.data);
      } catch (error) {
        console.error("Error fetching game state:", error);
      }
    };

    fetchGameState();

    // Connect WebSocket
    ws.current = new WebSocket(`${WS_URL}/api/ws/${sessionId}/${storedPlayerId}`);

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "state_update") {
        setGameState(data.game);
        
        // NEW: Check if conspiracy mode and game just started - show role notification ONCE
        if (data.game.conspiracy_mode && 
            data.game.game_started && 
            storedPlayerId in data.game.players &&
            !hasShownRoleNotification.current) {
          // Game just started in conspiracy mode - show role notification once
          const myRole = data.game.players[storedPlayerId].role;
          setAssignedRole(myRole);
          setShowRoleNotification(true);
          hasShownRoleNotification.current = true; // Mark as shown
          
          // Auto-hide after 5 seconds
          setTimeout(() => {
            setShowRoleNotification(false);
          }, 5000);
        }
      } else if (data.type === "trapped_notification") {
        // NEW: Show trap popup for survivor who entered trapped room
        setShowTrapPopup(true);
        // Auto-hide after 5 seconds
        setTimeout(() => {
          setShowTrapPopup(false);
        }, 5000);
      } else if (data.type === "event") {
        toast.info(data.message);
      } else if (data.type === "new_turn") {
        setHasSelectedRoom(false);
        setSelectedRoom(null);
        setSelectedPower(null);
        setPowerActionData(null);
        setShowPowerAction(false);
        toast.info(data.message);
      } else if (data.type === "phase_change") {
        setHasSelectedRoom(false);
        setSelectedRoom(null);
        if (data.phase !== "killer_power_selection") {
          setSelectedPower(null);
          setPowerActionData(null);
          setShowPowerAction(false);
        }
        toast.info(data.message);
      } else if (data.type === "game_over") {
        toast.success(data.message);
      } else if (data.type === "key_found_popup") {
        // Show popup for key found
        setKeyFoundMessage(data.message);
        setShowKeyFoundPopup(true);
        // Auto-hide after 5 seconds
        setTimeout(() => {
          setShowKeyFoundPopup(false);
        }, 5000);
      } else if (data.type === "player_action") {
        toast.info(data.message);
      } else if (data.type === "power_action_required") {
        // Show power action interface
        setShowPowerAction(true);
      } else if (data.type === "game_reset") {
        // Redirect all players back to lobby when game is reset
        toast.info(data.message);
        setTimeout(() => {
          window.location.href = `/lobby/${sessionId}`;
        }, 1500); // Small delay to show the toast message
      } else if (data.type === "error") {
        toast.error(data.message);
        // Reset hasSelectedRoom to allow player to try again after error
        setHasSelectedRoom(false);
        setSelectedRoom(null);
      }
    };

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [sessionId]);

  useEffect(() => {
    // Auto-scroll to latest event
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [gameState?.events]);

  const selectRoom = (roomName) => {
    if (hasSelectedRoom || !gameState) return;

    // Check if it's the current player's turn
    const currentPlayer = gameState.players[playerId];
    if (!currentPlayer) return;

    const isMyTurn = (currentPlayer.role === "survivor" && gameState.phase === "survivor_selection") ||
                     (currentPlayer.role === "killer" && gameState.phase === "killer_selection");

    if (!isMyTurn) {
      if (currentPlayer.role === "survivor" && gameState.phase === "killer_selection") {
        toast.error("C'est le tour des tueurs !");
      } else if (currentPlayer.role === "killer" && gameState.phase === "survivor_selection") {
        toast.error("C'est le tour des survivants !");
      }
      return;
    }

    if (gameState.rooms[roomName].locked) {
      toast.error("Cette pièce est condamnée !");
      return;
    }

    if (currentPlayer?.eliminated) {
      toast.error("Vous êtes éliminé !");
      return;
    }

    setSelectedRoom(roomName);
    setHasSelectedRoom(true);

    // Send selection to server
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "select_room",
        room: roomName
      }));
    }
  };

  const useMedikit = (targetPlayerId) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "use_medikit",
        target_player_id: targetPlayerId
      }));
    }
  };
  
  // NEW: Power selection functions
  const selectPower = (powerName) => {
    if (!gameState || gameState.phase !== "killer_power_selection") return;
    if (selectedPower) return; // Already selected
    
    setSelectedPower(powerName);
    
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "select_power",
        power: powerName
      }));
    }
  };
  
  const confirmPowerAction = (actionData) => {
    if (!gameState || gameState.phase !== "killer_power_selection") return;
    
    setPowerActionData(actionData);
    setShowPowerAction(false);
    
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "power_action",
        action_data: actionData
      }));
    }
  };

  if (!gameState) {
    return <div className="loading">Chargement...</div>;
  }

  const currentPlayer = gameState.players[playerId];
  const isEliminated = currentPlayer?.eliminated;
  const currentPlayerRole = currentPlayer?.role;

  // Organize rooms by floor
  const roomsByFloor = {
    basement: [],
    ground_floor: [],
    upper_floor: []
  };

  Object.entries(gameState.rooms).forEach(([name, data]) => {
    roomsByFloor[data.floor].push({ name, ...data });
  });

  return (
    <div className="game-container" data-testid="game-page">
      {/* NEW: Role Notification for Conspiracy Mode */}
      {showRoleNotification && assignedRole && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => setShowRoleNotification(false)}
          data-testid="role-notification"
        >
          <Card className="game-over-card" style={{ maxWidth: '500px' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                {assignedRole === "survivor" ? "🛡️" : "🔪"}
                <span>Votre rôle</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center' }}>
                {assignedRole === "survivor" 
                  ? "Vous êtes survivant, trouvez les clefs et échappez-vous d'ici !" 
                  : "Vous êtes tueur, trouvez les survivants et débarrassez-vous d'eux !"}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#888', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Key Found Popup */}
      {showKeyFoundPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => setShowKeyFoundPopup(false)}
          data-testid="key-found-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '500px', backgroundColor: '#2a5934', borderColor: '#4ade80' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#4ade80' }}>
                🔑
                <span>Clef trouvée !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {keyFoundMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Trap Popup */}
      {showTrapPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => setShowTrapPopup(false)}
          data-testid="trap-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '500px', backgroundColor: '#4a2a2a', borderColor: '#dc2626' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#dc2626' }}>
                🕸️
                <span>Vous êtes piégé !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                Vous êtes tombé dans un piège ! Vous ne pourrez pas bouger au prochain tour.
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Game Header */}
      <div className="game-header">
        <div className="game-info">
          <h2 className="turn-indicator" data-testid="turn-indicator">Tour {gameState.turn}</h2>
          <div className="keys-counter" data-testid="keys-counter">
            🔑 {gameState.keys_collected}/{gameState.keys_needed}
          </div>
          {gameState.phase === "survivor_selection" && (
            <div className="phase-indicator survivor-phase" data-testid="phase-indicator">
              🛡️ Tour des survivants
            </div>
          )}
          {gameState.phase === "killer_power_selection" && (
            <div className="phase-indicator killer-phase" data-testid="phase-indicator">
              🎴 Sélection de pouvoir
            </div>
          )}
          {gameState.phase === "killer_selection" && (
            <div className="phase-indicator killer-phase" data-testid="phase-indicator">
              🔪 Tour des tueurs
            </div>
          )}
          {gameState.phase === "processing" && (
            <div className="phase-indicator processing-phase" data-testid="phase-indicator">
              ⏳ Traitement en cours...
            </div>
          )}
        </div>

        <div className="player-status">
          <span className="player-avatar-display">
            <img src={currentPlayer?.avatar} alt={currentPlayer?.name} style={{ width: '2rem', height: '2rem', objectFit: 'contain' }} />
          </span>
          <span className="player-name-display">{currentPlayer?.name}</span>
          {currentPlayerRole === "killer" && <span className="role-badge killer-role">🔪 Tueur</span>}
          {currentPlayerRole === "survivor" && <span className="role-badge survivor-role">🛡️ Survivant</span>}
          {currentPlayer?.has_medikit && <span className="medikit-badge">🩺</span>}
          {isEliminated && <span className="eliminated-badge">💀 Éliminé</span>}
          {currentPlayer?.immobilized_next_turn && <span className="immobilized-badge">🕸️ Piégé</span>}
        </div>
      </div>

      {/* Power Selection Screen */}
      {gameState.phase === "killer_power_selection" && currentPlayerRole === "killer" && !isEliminated && (
        <PowerSelectionOverlay 
          gameState={gameState}
          playerId={playerId}
          powerDefinitions={powerDefinitions}
          selectedPower={selectedPower}
          selectPower={selectPower}
          showPowerAction={showPowerAction}
          confirmPowerAction={confirmPowerAction}
          powerActionData={powerActionData}
        />
      )}

      {/* Game Over Screen */}
      {gameState.phase === "game_over" && (
        <div className="game-over-overlay" data-testid="game-over-screen">
          <Card className="game-over-card">
            <CardHeader>
              <CardTitle className="game-over-title">
                {gameState.winner === "survivors" ?
                  (currentPlayerRole === "survivor" ? "🎉 VICTOIRE !" : "💀 DÉFAITE !") :
                  (currentPlayerRole === "killer" ? "🎉 VICTOIRE !" : "💀 DÉFAITE !")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="game-over-message">
                {gameState.winner === "survivors"
                  ? "Les survivants ont collecté toutes les clefs !"
                  : "Les tueurs ont éliminé tous les survivants..."}
              </p>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
                <Button
                  data-testid="back-lobby-btn"
                  onClick={async () => {
                    // Reset game and go back to lobby
                    try {
                      await axios.post(`${API}/game/${sessionId}/reset`);
                      window.location.href = `/lobby/${sessionId}`;
                    } catch (error) {
                      console.error("Error resetting game:", error);
                      window.location.href = `/lobby/${sessionId}`;
                    }
                  }}
                  className="back-home-btn"
                >
                  🔄 Rejouer
                </Button>
                <Button
                  data-testid="back-home-btn"
                  onClick={() => window.location.href = '/'}
                  className="secondary-btn"
                  style={{ backgroundColor: '#555' }}
                >
                  🏠 Accueil
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="game-main">
        {/* Map Section */}
        <div className="map-section">
          <h3 className="map-title">Carte de la maison</h3>

          {["upper_floor", "ground_floor", "basement"].map((floor) => (
            <div key={floor} className="floor-section">
              <h4 className="floor-title">{FLOOR_NAMES[floor]}</h4>
              <div className="rooms-grid">
                {roomsByFloor[floor].map((room) => {
                  // CORRECTION: Show players that are in this room during selection phase
                  let playersSelectingThisRoom = [];

                  // During survivor_selection or killer_selection phase, show who is selecting this room
                  // Only show players of the same role as current player
                  if (gameState.phase === "survivor_selection" || gameState.phase === "killer_selection" || gameState.phase === "processing") {
                    // Get all players whose pending action is to go to this room AND have the same role as current player
                    playersSelectingThisRoom = Object.entries(gameState.pending_actions || {})
                      .filter(([pid, action]) => {
                        const player = gameState.players[pid];
                        // Only show if: action is for this room, player exists, not eliminated, and has same role as current player
                        return action.room === room.name &&
                               player &&
                               !player.eliminated &&
                               player.role === currentPlayerRole;
                      })
                      .map(([pid]) => gameState.players[pid]);
                  }

                  const eliminatedInRoom = room.eliminated_players || [];
                  
                  // Check for power effects
                  const isHighlighted = room.highlighted && currentPlayerRole === "killer";
                  const isTrapped = room.trapped && currentPlayerRole === "killer";
                  const isTrapTriggered = room.trap_triggered && currentPlayerRole === "survivor";

                  return (
                    <button
                      key={room.name}
                      data-testid={`room-${room.name.replace(/\s+/g, '-').toLowerCase()}`}
                      className={`room-card ${
                        selectedRoom === room.name ? 'selected' :
                        room.locked ? 'locked' : ''
                      } ${isHighlighted ? 'room-highlighted' : ''}`}
                      onClick={() => selectRoom(room.name)}
                      disabled={isEliminated || hasSelectedRoom || room.locked}
                    >
                      <div className="room-name">{room.name}</div>
                      <div className="room-indicators">
                        {room.locked && <span className="room-icon locked-icon">❌</span>}
                        {eliminatedInRoom.length > 0 && <span className="room-icon skull-icon">💀</span>}
                        {isTrapped && <span className="room-icon room-trap-indicator" title="Piégé">🕸️</span>}
                        {isTrapTriggered && <span className="room-icon room-trap-indicator" title="Piège activé">🕸️</span>}
                        {playersSelectingThisRoom.length > 0 && (
                          <div className="players-in-room">
                            {playersSelectingThisRoom.map((p) => (
                              <span key={p.id} className="room-player-avatar" title={p.name}>
                                <img src={p.avatar} alt={p.name} style={{ width: '1.3rem', height: '1.3rem', objectFit: 'contain' }} />
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Events Log Section */}
        <div className="events-section">
          <Card className="events-card">
            <CardHeader>
              <CardTitle>Journal des événements</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="events-scroll" data-testid="events-log">
                <div className="events-list">
                  {gameState.events.length === 0 ? (
                    <p className="no-events">Aucun événement pour le moment...</p>
                  ) : (
                    gameState.events.map((event, idx) => {
                      // Filter sound clues based on role
                      if (event.type === "sound_clue" && event.for_role && event.for_role !== currentPlayerRole) {
                        return null; // Don't show sound clues meant for other role
                      }

                      // Filter game_over messages based on role
                      if (event.type === "game_over" && event.for_role && event.for_role !== currentPlayerRole) {
                        return null; // Don't show game_over messages meant for other role
                      }

                      // Filter key_found and search_no_key messages - only for survivors
                      if ((event.type === "key_found" || event.type === "search_no_key") && event.for_role && event.for_role !== currentPlayerRole) {
                        return null; // Don't show search events meant for survivors to killers
                      }

                      return (
                        <div
                          key={idx}
                          className={`event-item event-${event.type}`}
                          data-testid={`event-${idx}`}
                        >
                          {event.message}
                        </div>
                      );
                    })
                  )}
                  <div ref={eventsEndRef} />
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Players Status */}
          <Card className="players-status-card">
            <CardHeader>
              <CardTitle>État des joueurs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="players-status-list">
                {Object.values(gameState.players).map((player) => (
                  <div
                    key={player.id}
                    className={`player-status-item ${player.eliminated ? 'eliminated' : 'alive'}`}
                    data-testid={`player-status-${player.id}`}
                  >
                    <span className="status-avatar">
                      <img src={player.avatar} alt={player.name} style={{ width: '1.8rem', height: '1.8rem', objectFit: 'contain' }} />
                    </span>
                    <span className="status-name">{player.name}</span>
                    {player.role === "killer" && <span className="status-role killer">🔪</span>}
                    {player.role === "survivor" && <span className="status-role survivor">🛡️</span>}
                    {player.has_medikit && <span className="status-medikit">🩺</span>}
                    {player.eliminated && <span className="status-eliminated">💀</span>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

// Join redirect
const JoinRedirect = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    navigate(`/lobby/${sessionId}`);
  }, [sessionId, navigate]);

  return <div className="loading">Redirection...</div>;
};

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lobby/:sessionId" element={<Lobby />} />
          <Route path="/game/:sessionId" element={<Game />} />
          <Route path="/join/:sessionId" element={<JoinRedirect />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
