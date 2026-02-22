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
    path: "/avatars/Assassin.png", 
    class: "Assassin",
    description: "Agile et sournois, il peut crocheter certaines serrures. Le plus souvent celles où les portes sont déjà ouvertes.",
    illustration: "/illustrations/Assassin_animation.mp4"
  },
  { 
    path: "/avatars/Barbare.png", 
    class: "Barbare",
    description: "Un vrai bourrin qui résout tous les problèmes à coups de hache. Même ceux qui demandent juste un peu de diplomatie.",
    illustration: "/illustrations/Barbare_animation.mp4"
  },
  { 
    path: "/avatars/Barde.png", 
    class: "Barde",
    description: "Le musicien raté du groupe. Son instrument ? Une arme sonore capable d'endormir certaines créatures.",
    illustration: "/illustrations/Barde_animation.mp4"
  },
  { 
    path: "/avatars/Elfe.png", 
    class: "Elfe",
    description: "Elle seule sait lire l'elfique. Ça tombe bien : elle ne sait lire que ça.",
    illustration: "/illustrations/Elfe_animation.mp4"
  },
  { 
    path: "/avatars/Guerrier.png", 
    class: "Guerrier",
    description: "Vaillant et téméraire, il est élu de cette aventure. Enfin ça c'est ce qu'il croit.",
    illustration: "/illustrations/Guerrier.mp4"
  },
  { 
    path: "/avatars/Mage.png", 
    class: "Mage",
    description: "Son bâton magique peut incendier certains décors… parfois même sa propre barbe.",
    illustration: "/illustrations/Mage_animation.mp4"
  }
];

const KILLER_AVATARS = [
  { 
    path: "/avatars/Orc Berzerker.png", 
    class: "Orc Berzerker",
    description: "Votre soif de vengeance n'a d'yeux que pour ces sales petits voleurs. Et parfois, pour le buffet après la bataille.",
    illustration: "/illustrations/Orc Berzerker_animation.mp4"
  },
  { 
    path: "/avatars/Orc Chaman.png", 
    class: "Orc Chaman",
    description: "Traquer les intrus, très peu pour vous. Vous préférez laisser ce travail à vos morts-vivants — ils sont bien moins bavards.",
    illustration: "/illustrations/Orc Chaman_animation.mp4"
  },
  { 
    path: "/avatars/Orc Roi.png", 
    class: "Orc Roi",
    description: "« Rendez les bijoux de la couronne ! Bande de losers, de voleurs, de crapules !» hurlez-vous avec rage.",
    illustration: "/illustrations/Orc Roi_animation.mp4"
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

const Home = () => {
  // Step: "menu" = create/join choice, "configure" = player setup
  const [step, setStep] = useState("menu");
  const [mode, setMode] = useState(null); // "create" or "join"
  
  const [playerName, setPlayerName] = useState("");
  const [selectedRole, setSelectedRole] = useState("survivor");
  const [selectedAvatar, setSelectedAvatar] = useState(SURVIVOR_AVATARS[0]);
  const [conspiracyMode, setConspiracyMode] = useState(false);
  const [joinSessionId, setJoinSessionId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [createdSessionId, setCreatedSessionId] = useState(null);
  const [showJoinInput, setShowJoinInput] = useState(false);
  const navigate = useNavigate();

  const availableAvatars = selectedRole === "survivor" ? SURVIVOR_AVATARS : KILLER_AVATARS;

  // Check if returning from lobby to change role/avatar
  useEffect(() => {
    const returningFromLobby = sessionStorage.getItem('returning_from_lobby');
    const pendingSessionId = sessionStorage.getItem('pending_session_id');
    const currentPlayerName = sessionStorage.getItem('player_name');

    if (returningFromLobby === 'true' && pendingSessionId) {
      setJoinSessionId(pendingSessionId);
      if (currentPlayerName) {
        setPlayerName(currentPlayerName);
      }
      sessionStorage.setItem('is_updating_player', 'true');
      toast.info("Choisissez un nouveau rôle et avatar pour rejoindre le lobby");
      sessionStorage.removeItem('returning_from_lobby');
      sessionStorage.removeItem('pending_session_id');
      
      // Go directly to configure step in join mode
      setMode("join");
      setStep("configure");
    }
  }, []);

  useEffect(() => {
    const newAvatars = selectedRole === "survivor" ? SURVIVOR_AVATARS : KILLER_AVATARS;
    setSelectedAvatar(newAvatars[0]);
  }, [selectedRole]);

 

  // Step 1: Create → create session on server, get session ID, then go to configure
  const handleCreateClick = async () => {
    setMode("create");
    setStep("configure");
  };

  // Step 1: Join → validate session exists, then go to configure
  const handleJoinClick = async () => {
    if (!joinSessionId.trim()) {
      toast.error("Veuillez entrer un code de session");
      return;
    }
    
    // Verify session exists
    try {
      await axios.get(`${API}/game/${joinSessionId}/state`);
      setMode("join");
      setStep("configure");
    } catch (error) {
      toast.error("Session introuvable. Vérifiez le code.");
    }
  };

  // Step 2: Confirm configuration and create/join
  const confirmConfiguration = async () => {
    if (!playerName.trim()) {
      toast.error("Veuillez entrer un nom");
      return;
    }

    if (mode === "create") {
      setIsCreating(true);
      try {
        const response = await axios.post(`${API}/game/create`, {
          host_name: playerName,
          host_avatar: selectedAvatar.path,
          role: selectedRole,
          conspiracy_mode: conspiracyMode
        });

        const { session_id, player_id } = response.data;
        sessionStorage.setItem('player_id', player_id);
        sessionStorage.setItem('player_name', playerName);
        navigate(`/lobby/${session_id}`);
      } catch (error) {
        console.error("Error creating game:", error);
        toast.error("Erreur lors de la création de la partie");
      } finally {
        setIsCreating(false);
      }
    } else {
      // Join mode
      setIsJoining(true);
      try {
        const isUpdatingPlayer = sessionStorage.getItem('is_updating_player') === 'true';
        const updatingPlayerId = sessionStorage.getItem('updating_player_id');

        if (isUpdatingPlayer && updatingPlayerId) {
          await axios.post(`${API}/game/${joinSessionId}/update_player`, {
            player_name: playerName,
            player_avatar: selectedAvatar.path,
            role: selectedRole
          }, {
            params: { player_id: updatingPlayerId }
          });

          sessionStorage.setItem('player_id', updatingPlayerId);
          sessionStorage.setItem('player_name', playerName);
          sessionStorage.removeItem('is_updating_player');
          sessionStorage.removeItem('updating_player_id');
          toast.success("Profil mis à jour !");
          navigate(`/lobby/${joinSessionId}`);
        } else {
          const response = await axios.post(`${API}/game/${joinSessionId}/join`, {
            player_name: playerName,
            player_avatar: selectedAvatar.path,
            role: selectedRole
          });

          const { session_id, player_id } = response.data;
          sessionStorage.setItem('player_id', player_id);
          sessionStorage.setItem('player_name', playerName);
          navigate(`/lobby/${session_id}`);
        }
      } catch (error) {
        console.error("Error joining game:", error);
        toast.error("Erreur : session introuvable ou partie déjà commencée");
      } finally {
        setIsJoining(false);
      }
    }
  };

   // ==================== MENU STEP ====================
  if (step === "menu") {
    return (
      <div className="home-container" data-testid="home-page">
        <div className="home-content">
          <h1 className="game-title" data-testid="game-title">Le Donjon</h1>

          {/* Lore Introduction */}
          <div style={{
            maxWidth: '500px',
            margin: '1.5rem auto 2rem auto',
            padding: '1.5rem',
            background: 'linear-gradient(135deg, rgba(30, 20, 10, 0.9) 0%, rgba(50, 30, 15, 0.9) 100%)',
            border: '2px solid rgba(212, 175, 55, 0.4)',
            borderRadius: '12px',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Decorative corners */}
            <div style={{
              position: 'absolute', top: '4px', left: '4px',
              width: '20px', height: '20px',
              borderTop: '2px solid #d4af37', borderLeft: '2px solid #d4af37'
            }} />
            <div style={{
              position: 'absolute', top: '4px', right: '4px',
              width: '20px', height: '20px',
              borderTop: '2px solid #d4af37', borderRight: '2px solid #d4af37'
            }} />
            <div style={{
              position: 'absolute', bottom: '4px', left: '4px',
              width: '20px', height: '20px',
              borderBottom: '2px solid #d4af37', borderLeft: '2px solid #d4af37'
            }} />
            <div style={{
              position: 'absolute', bottom: '4px', right: '4px',
              width: '20px', height: '20px',
              borderBottom: '2px solid #d4af37', borderRight: '2px solid #d4af37'
            }} />

            <h2 style={{
              textAlign: 'center',
              color: '#d4af37',
              fontSize: '1.2em',
              fontWeight: 'bold',
              marginBottom: '1rem',
              textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
              fontFamily: 'Georgia, serif'
            }}>
              ⚜️ Bienvenue dans le donjon ! ⚜️
            </h2>

            <p style={{
              color: '#c8b88a',
              fontSize: '0.92em',
              lineHeight: '1.6',
              marginBottom: '1rem',
              fontFamily: 'Georgia, serif',
              textAlign: 'justify'
            }}>
                            <span style={{ color: '#7cb342', fontWeight: 'bold' }}>Les joueurs aventuriers</span>, doivent trouver et détruire le cœur de ce repère : <span style={{ color: '#ce93d8', fontWeight: 'bold' }}>le cristal maudit</span>. Fouillez les pièces, évitez les pièges et terminez vos quêtes pour mettre la main dessus, mais ne croisez pas les Orcs !
            </p>

            <p style={{
              color: '#c8b88a',
              fontSize: '0.92em',
              lineHeight: '1.6',
              marginBottom: '0',
              fontFamily: 'Georgia, serif',
              textAlign: 'justify'
            }}>
                            <span style={{ color: '#ef5350', fontWeight: 'bold' }}>Les joueurs Orcs</span>,  doivent protéger ce cristal. Fouillez les pièces, déployez des pièges et tuez ces maudits envahisseurs jusqu'au dernier avant qu'ils ne s'en prennent au cristal !
            </p>
          </div>

          <div className="menu-buttons" style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            maxWidth: '500px',
            margin: '0 auto'
          }}>
            {/* Create Game Button */}
            <button
              data-testid="create-game-btn"
              onClick={handleCreateClick}
              className="menu-card-btn"
              style={{
                position: 'relative',
                overflow: 'hidden',
                borderRadius: '12px',
                border: '3px solid #d4af37',
                background: 'transparent',
                cursor: 'pointer',
                minHeight: '120px',
                transition: 'all 0.3s ease'
              }}
            >
              <img 
                src="/illustrations/creerunepartie.png" 
                alt="" 
                style={{
                  position: 'absolute',
                  top: 0, left: 0,
                  width: '100%', height: '100%',
                  objectFit: 'cover',
                  opacity: 0.9
                }}
              />
              <div style={{
                position: 'relative',
                zIndex: 1,
                padding: '2rem',
                background: 'linear-gradient(transparent 20%, rgba(0,0,0,0.8) 100%)',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span style={{ fontSize: '2em', marginBottom: '0.5rem' }}>⚔️</span>
                <span style={{ 
                  fontSize: '1.4em', 
                  fontWeight: 'bold', 
                  color: '#d4af37',
                  textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                }}>
                  Créer une partie
                </span>
              </div>
            </button>

            {/* Join Game Button - Collapsible */}
            <div style={{
              borderRadius: '12px',
              border: '3px solid #555',
              background: 'rgba(30, 30, 30, 0.8)',
              overflow: 'hidden',
              transition: 'all 0.3s ease'
            }}>
              <button
                onClick={() => setShowJoinInput(prev => !prev)}
                style={{
                  width: '100%',
                  padding: '1.5rem 2rem',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.75rem',
                  transition: 'all 0.3s ease'
                }}
              >
                <span style={{ 
                  fontSize: '1.4em', 
                  fontWeight: 'bold', 
                  color: '#ccc',
                  textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                }}>
                  Rejoindre une partie
                </span>
                <span style={{
                  color: '#d4af37',
                  fontSize: '1.2em',
                  transition: 'transform 0.3s ease',
                  transform: showJoinInput ? 'rotate(180deg)' : 'rotate(0deg)',
                  display: 'inline-block'
                }}>
                  ▼
                </span>
              </button>

              {/* Collapsible content */}
              <div style={{
                maxHeight: showJoinInput ? '200px' : '0',
                opacity: showJoinInput ? 1 : 0,
                overflow: 'hidden',
                transition: 'all 0.3s ease',
                padding: showJoinInput ? '0 1.5rem 1.5rem 1.5rem' : '0 1.5rem'
              }}>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  alignItems: 'center'
                }}>
                  <Input
                    data-testid="join-session-input"
                    placeholder="Code de session"
                    value={joinSessionId}
                    onChange={(e) => setJoinSessionId(e.target.value.toUpperCase())}
                    className="dark-input"
                    style={{ textTransform: 'uppercase', textAlign: 'center', fontSize: '1.2em' }}
                  />
                  <Button
                    data-testid="join-game-btn"
                    onClick={handleJoinClick}
                    className="secondary-btn"
                    style={{ width: '100%' }}
                  >
                    Rejoindre
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==================== CONFIGURE STEP ====================
  return (
    <div className="home-container" data-testid="home-page">
      <div className="home-content">
        <h1 className="game-title" data-testid="game-title">Le Donjon</h1>

        {/* Back button */}
        <button
          onClick={() => { setStep("menu"); setCreatedSessionId(null); }}
          style={{
            background: 'none',
            border: 'none',
            color: '#d4af37',
            cursor: 'pointer',
            fontSize: '1em',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          ← Retour
        </button>

        <Card className="setup-card">

          <CardContent className="space-y-4">
            {/* Player Name */}
            <div style={{ textAlign: 'center' }}>
              <label className="input-label" style={{ textAlign: 'center' }}>Votre nom</label>
              <Input
                data-testid="player-name-input"
                placeholder="Entrez votre pseudo"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="dark-input"
                style={{ textAlign: 'center' }}
              />
            </div>

            {/* Role Selection */}
            <div>
              <label className="input-label" style={{ textAlign: 'center', display: 'block' }}>Choisissez votre rôle</label>
                            <div className="role-selector">
                <button
                  data-testid="role-survivor-btn"
                  className={`role-option role-image-btn ${selectedRole === 'survivor' ? 'selected' : ''}`}
                  onClick={() => setSelectedRole('survivor')}
                  disabled={conspiracyMode}
                  style={{ position: 'relative', overflow: 'hidden', padding: 0 }}
                >
                  <img 
                    src="/illustrations/Survivant.png" 
                    alt="Survivant" 
                    style={{ 
                      width: '100%', height: '100%', objectFit: 'cover',
                      position: 'absolute', top: 0, left: 0,
                      opacity: selectedRole === 'survivor' ? 1 : 0.5,
                      transition: 'opacity 0.3s ease'
                    }} 
                  />
                  <div style={{
                    position: 'relative', zIndex: 1,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'flex-end',
                    height: '100%', padding: '1rem',
                    background: 'linear-gradient(transparent 40%, rgba(0,0,0,0.7) 100%)'
                  }}>
                    <span className="role-name" style={{ 
                      fontSize: '1.2em', fontWeight: 'bold', color: '#fff',
                      textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                    }}>
                      🛡️ Aventurier
                    </span>
                  </div>
                </button>
                <button
                  data-testid="role-killer-btn"
                  className={`role-option killer role-image-btn ${selectedRole === 'killer' ? 'selected' : ''}`}
                  onClick={() => setSelectedRole('killer')}
                  disabled={conspiracyMode}
                  style={{ position: 'relative', overflow: 'hidden', padding: 0 }}
                >
                  <img 
                    src="/illustrations/Tueur.png" 
                    alt="Tueur" 
                    style={{ 
                      width: '100%', height: '100%', objectFit: 'cover',
                      position: 'absolute', top: 0, left: 0,
                      opacity: selectedRole === 'killer' ? 1 : 0.5,
                      transition: 'opacity 0.3s ease'
                    }} 
                  />
                  <div style={{
                    position: 'relative', zIndex: 1,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'flex-end',
                    height: '100%', padding: '1rem',
                    background: 'linear-gradient(transparent 40%, rgba(0,0,0,0.7) 100%)'
                  }}>
                    <span className="role-name" style={{ 
                      fontSize: '1.2em', fontWeight: 'bold', color: '#fff',
                      textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                    }}>
                    🔪 Orc
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Avatar Selection */}
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
                  marginTop: '1rem', padding: '1rem', 
                  backgroundColor: 'rgba(139, 92, 46, 0.2)',
                  border: '2px solid rgba(139, 92, 46, 0.5)',
                  borderRadius: '8px', textAlign: 'center',
                  display: 'flex', flexDirection: 'column', alignItems: 'center'
                }}>
                  <h3 style={{ 
                    fontSize: '1.2em', fontWeight: 'bold', color: '#d4af37',
                    marginBottom: '0.5rem',
                    textShadow: '1px 1px 2px rgba(0,0,0,0.5)'
                  }}>
                    {selectedAvatar.class}
                  </h3>
                  
                  {selectedAvatar.illustration && (
                    <div 
                      key={selectedAvatar.class}
                      className="character-illustration-enter"
                      style={{
                        margin: '1rem 0', maxWidth: '400px', width: '100%',
                        borderRadius: '8px', overflow: 'hidden',
                        boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
                        display: 'flex', justifyContent: 'center'
                      }}
                    >
                      <video 
                        src={selectedAvatar.illustration} 
                        autoPlay loop muted playsInline
                        style={{ width: '100%', height: 'auto', display: 'block' }}
                      />
                    </div>
                  )}
                  
                  <p style={{ 
                    fontSize: '0.95em', color: '#e0e0e0',
                    fontStyle: 'italic', lineHeight: '1.4'
                  }}>
                    {selectedAvatar.description}
                  </p>
                </div>
              )}
            </div>

            {/* Conspiracy Mode - Only for create mode */}
            {mode === "create" && (
              <div style={{ marginTop: '0.5rem' }}>
                <button
                  data-testid="conspiracy-mode-btn"
                  onClick={() => setConspiracyMode(!conspiracyMode)}
                  style={{ 
                    width: '100%',
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    border: conspiracyMode ? '2px solid #9333ea' : '2px solid #555',
                    background: conspiracyMode ? 'rgba(147, 51, 234, 0.15)' : 'rgba(30, 30, 30, 0.6)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    transition: 'all 0.3s ease'
                  }}
                >
                  <span style={{ fontSize: '1em' }}>🎭</span>
                  <span style={{ 
                    fontSize: '0.9em', 
                    color: conspiracyMode ? '#c084fc' : '#888',
                    fontWeight: conspiracyMode ? 'bold' : 'normal'
                  }}>
                    Mode Complot
                  </span>
                  {conspiracyMode && <span style={{ fontSize: '0.85em', color: '#c084fc' }}>✓</span>}
                </button>
                {conspiracyMode && (
                  <p style={{ fontSize: '0.75em', color: '#888', marginTop: '0.3rem', textAlign: 'center' }}>
                    Les rôles seront attribués aléatoirement
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Confirm Button */}
        <div style={{ marginTop: '1.5rem' }}>
          <Button
            data-testid="confirm-config-btn"
            onClick={confirmConfiguration}
            disabled={isCreating || isJoining}
            className="primary-btn"
            style={{ width: '100%', padding: '1rem', fontSize: '1.1em' }}
          >
            {isCreating ? "Création..." : isJoining ? "Connexion..." : 
              mode === "create" ? "⚔️ Créer et entrer dans le donjon" : "🚪 Rejoindre le donjon"}
          </Button>
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
const storedPlayerId = sessionStorage.getItem('player_id');
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
      } else if (data.type === "player_list_update") {
        // ✅ AJOUTÉ: Re-sync la liste des joueurs (envoyé par le serveur après identify)
        setGameState(prev => {
          if (!prev) return prev;
          // Rebuild players dict from the list
          const updatedPlayers = {};
          data.players.forEach(p => {
            // Merge with existing player data if available, overlay with new data
            updatedPlayers[p.id] = { ...(prev.players?.[p.id] || {}), ...p };
          });
          return { ...prev, players: updatedPlayers };
        });
      } else if (data.type === "player_joined") {
    toast(`🚪 ${data.player.name} rejoint la partie !`, {
      duration: 1000,
      style: {
        background: 'rgba(61, 43, 31, 0.7)',
        color: '#d4af37',
        border: '1px solid rgba(212, 175, 55, 0.3)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        fontFamily: "'Cinzel', serif",
        fontSize: '0.95rem',
        pointerEvents: 'none',
      },
    });
} else if (data.type === "game_started") {
        toast.success(data.message);
        setTimeout(() => navigate(`/game/${sessionId}?pid=${storedPlayerId}`), 1000);
      } else if (data.type === "game_reset") {
        // ✅ MODIFIÉ: Re-sync complète avec les données du broadcast
        toast.info(data.message);
        if (data.players) {
          setGameState(prev => {
            if (!prev) return prev;
            const updatedPlayers = {};
            data.players.forEach(p => {
              updatedPlayers[p.id] = { ...(prev.players?.[p.id] || {}), ...p };
            });
            return { 
              ...prev, 
              players: updatedPlayers,
              game_started: false,
              phase: "waiting"
            };
          });
        } else {
          // Fallback: re-fetch from server
          fetchGameState();
        }
      } else if (data.type === "role_changed") {
        toast.info(`${data.player_name} a changé de rôle`);
      } else if (data.type === "player_updated") {
        toast.info(`${data.player.name} a mis à jour son profil`);
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
      
      // Display specific error message from backend
      const errorMessage = error.response?.data?.detail || "Erreur lors du démarrage";
      toast.error(errorMessage, {
        duration: 5000, // Show for 5 seconds
        style: {
          maxWidth: '500px'
        }
      });
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
    
    // FIXED: Store the SPECIFIC player_id who is changing role
sessionStorage.setItem('returning_from_lobby', 'true');
sessionStorage.setItem('pending_session_id', sessionId);
sessionStorage.setItem('updating_player_id', targetPlayerId);
    
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
            <CardTitle>
              Joueurs ({playerCount}/8)
              {!isHost && (
                <span style={{ 
                  fontSize: '0.65em', 
                  fontWeight: 'normal', 
                  color: '#d4af37', 
                  marginLeft: '0.75rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}>
                  <span className="hourglass-spin">⏳</span>
                  En attente de l'hôte
                  <span className="waiting-dots"></span>
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
  <div className="players-list">
    {Object.values(gameState.players).map((player) => {
      const isCurrentPlayer = player.id === playerId;
      
      return (
        <div key={player.id} className="player-item" data-testid={`player-${player.id}`}>
          <div className="player-item-main">
            <span className="player-avatar">
              <img src={player.avatar} alt={player.name} style={{ width: '3.5rem', height: '3.5rem', objectFit: 'contain' }} />
            </span>
            <span className="player-name">{player.name}</span>
          </div>
          <div className="player-item-badges">
            {/* Affichage du rôle – toujours visible en salle d'attente */}
            {player.role === "killer" && (
              <span className="killer-badge">Orc</span>
            )}
            {player.role === "survivor" && (
              <span className="survivor-badge">Aventurier</span>
            )}
            {!player.role && (
              <em>Choisit son rôle...</em>
            )}

            {/* BOUTON CHANGER RÔLE & AVATAR – visible seulement en salle d'attente */}
            {!gameState.game_started && isCurrentPlayer && (
              <button
                className="switch-role-btn"
                onClick={() => changeRole(player.id, player.role)}
                title="Changer de rôle et d'avatar"
                data-testid="switch-role-btn"
              >
                Changer
              </button>
            )}

            {player.is_host && <span className="host-badge">Hôte</span>}
          </div>
        </div>
      );
    })}
  </div>

  {/* BOUTON DÉMARRER LA PARTIE – juste en dessous de la liste */}
  {isHost && !gameState.game_started && (
    <div style={{ marginTop: '2rem', textAlign: 'center' }}>
      <button
        onClick={startGame}
        disabled={Object.values(gameState.players).some(p => !p.role)}
        style={{
          padding: '1rem 2rem',
          fontSize: '1.5rem',
          backgroundColor: Object.values(gameState.players).every(p => p.role) ? '#d32f2f' : '#666',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: Object.values(gameState.players).every(p => p.role) ? 'pointer' : 'not-allowed'
        }}
      >
        {Object.values(gameState.players).every(p => p.role)
          ? `Démarrer la partie (${Object.keys(gameState.players).length}/8)`
          : "En attente des rôles..."}
      </button>
    </div>
  )}
</CardContent>
        </Card>


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
  const [selectedFloor, setSelectedFloor] = useState(null);
  const [teleportationStep, setTeleportationStep] = useState(1); // 1 = trap room, 2 = exit room
  const [trapRoom, setTrapRoom] = useState(null);
  
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
      // Blizzard: 1 room per floor
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
    } else if (actionType === "select_room") {
      // Toxine: 1 room
      setTempRoomSelections([roomName]);
    } else if (actionType === "select_rooms") {
      // Barricade: 2 rooms
      const roomsCount = selectedPowerDef.rooms_count || 2;
      if (tempRoomSelections.includes(roomName)) {
        setTempRoomSelections(tempRoomSelections.filter(r => r !== roomName));
      } else if (tempRoomSelections.length < roomsCount) {
        setTempRoomSelections([...tempRoomSelections, roomName]);
      }
    } else if (actionType === "select_two_rooms") {
      // Teleportation: 2 rooms in sequence (trap then exit)
      if (teleportationStep === 1) {
        setTrapRoom(roomName);
      } else {
        setTempRoomSelections([roomName]);
      }
    }
  };
  
  const handleFloorSelection = (floor) => {
    setSelectedFloor(floor);
  };
  
  const canConfirmAction = () => {
    if (actionType === "select_rooms_per_floor") {
      // Must select from at least one floor
      return tempRoomSelections.length > 0;
    } else if (actionType === "select_rooms") {
      // Must select exactly the required number
      return tempRoomSelections.length === (selectedPowerDef.rooms_count || 2);
    } else if (actionType === "select_room") {
      // Must select exactly one room (for toxine)
      return tempRoomSelections.length === 1;
    } else if (actionType === "select_floor") {
      // Must select one floor
      return selectedFloor !== null;
    } else if (actionType === "select_two_rooms") {
      // Teleportation: step 1 needs trap room, step 2 needs exit room
      if (teleportationStep === 1) {
        return trapRoom !== null;
      } else {
        return tempRoomSelections.length === 1;
      }
    }
    return false;
  };
  
  if (hasCompletedSelection && !showPowerAction) {
    return (
      <div className="power-selection-overlay">
        <Card className="power-waiting-card">
          <CardContent className="text-center" style={{ padding: '2rem' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>✅ Pouvoir sélectionné</h2>
            <p>En attente des autres Orcs...</p>
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
            {actionType === "select_floor" ? (
              <>
                <p className="text-center mb-4">Choisissez un niveau à traquer:</p>
                <div className="floor-selection-buttons" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {["upper_floor", "ground_floor", "basement"].map(floor => (
                    <Button
                      key={floor}
                      onClick={() => handleFloorSelection(floor)}
                      className="w-full"
                      style={{
                        backgroundColor: selectedFloor === floor ? '#8b5cf6' : '#555',
                        padding: '1.5rem',
                        fontSize: '1.2rem'
                      }}
                    >
                      {FLOOR_NAMES[floor]} {selectedFloor === floor && " ✓"}
                    </Button>
                  ))}
                </div>
                <Button
                  onClick={() => confirmPowerAction({ floor: selectedFloor })}
                  disabled={!canConfirmAction()}
                  className="w-full mt-4"
                  style={{ backgroundColor: canConfirmAction() ? '#8b5cf6' : '#555' }}
                >
                  Confirmer
                </Button>
              </>
            ) : (
              <>
                <p className="text-center mb-4">
                  {actionType === "select_rooms_per_floor" && "Sélectionnez une pièce par étage à piéger:"}
                  {actionType === "select_rooms" && `Sélectionnez ${selectedPowerDef.rooms_count} pièces à verrouiller:`}
                  {actionType === "select_room" && "Sélectionnez une pièce à empoisonner:"}
                  {actionType === "select_two_rooms" && teleportationStep === 1 && "Posez votre piège de téléportation dans la pièce que vous souhaitez ➡️🌀"}
                  {actionType === "select_two_rooms" && teleportationStep === 2 && "Posez votre portail de sortie dans la pièce que vous souhaitez. Les joueurs téléportés arriveront dans cette pièce 🌀➡️"}
                </p>
                
                <div className="rooms-selection-grid">
                  {["upper_floor", "ground_floor", "basement"].map(floor => (
                    <div key={floor} className="floor-section-mini">
                      <h4>{FLOOR_NAMES[floor]}</h4>
                      <div className="rooms-mini-grid">
                        {Object.entries(gameState.rooms)
                          .filter(([_, data]) => data.floor === floor)
                          .map(([roomName, roomData]) => {
                            const isSelected = actionType === "select_two_rooms" && teleportationStep === 1 
                              ? trapRoom === roomName 
                              : tempRoomSelections.includes(roomName);
                            const isLocked = roomData.locked;
                            const isTrapped = roomData.trapped; // FIXED: Show trapped rooms
                            
                            return (
                              <button
                                key={roomName}
                                data-room-name={roomName}
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
                  onClick={() => {
                    if (actionType === "select_room") {
                      confirmPowerAction({ room: tempRoomSelections[0] });
                    } else if (actionType === "select_two_rooms") {
                      if (teleportationStep === 1) {
                        // Move to step 2
                        setTeleportationStep(2);
                        setTempRoomSelections([]);
                      } else {
                        // Confirm both rooms
                        confirmPowerAction({ trap_room: trapRoom, exit_room: tempRoomSelections[0] });
                      }
                    } else {
                      confirmPowerAction({ rooms: tempRoomSelections });
                    }
                  }}
                  disabled={!canConfirmAction()}
                  className="w-full mt-4"
                  style={{ backgroundColor: canConfirmAction() ? '#8b5cf6' : '#555' }}
                >
                  {actionType === "select_two_rooms" && teleportationStep === 1 ? "Suivant" : "Confirmer"}
                </Button>
              </>
            )}
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
                    <video 
                      src={`/powers/${power.icon}`} 
                      autoPlay
                      loop
                      muted
                      playsInline
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

  // NEW: Flashing rooms when teammates select
const [flashingRooms, setFlashingRooms] = useState(new Set());
const prevPendingActionsRef = useRef('{}');
  
  // NEW: Power selection states
  const [selectedPower, setSelectedPower] = useState(null);
  const [powerActionData, setPowerActionData] = useState(null);
  const [showPowerAction, setShowPowerAction] = useState(false);
  const [powerDefinitions, setPowerDefinitions] = useState({});
  
  // NEW: Key found popup state
  const [showKeyFoundPopup, setShowKeyFoundPopup] = useState(false);
  const [keyFoundMessage, setKeyFoundMessage] = useState("");
  
  // NEW: Quest completed popup state (with video)
  const [showQuestCompletedPopup, setShowQuestCompletedPopup] = useState(false);
  const [questCompletedMessage, setQuestCompletedMessage] = useState("");
  const [questVideoPath, setQuestVideoPath] = useState("");
  
  // NEW: Wrong class popup state (with image)
  const [showWrongClassPopup, setShowWrongClassPopup] = useState(false);
  const [wrongClassMessage, setWrongClassMessage] = useState("");
  const [requiredClassImage, setRequiredClassImage] = useState("");
  
  // NEW: Trap popup state (with video)
  const [showTrapPopup, setShowTrapPopup] = useState(false);
  const [trapVideoPath, setTrapVideoPath] = useState("");
  
  // NEW: Poison popup state
  const [showPoisonPopup, setShowPoisonPopup] = useState(false);
  const [poisonMessage, setPoisonMessage] = useState("");
  const [poisonVideoPath, setPoisonVideoPath] = useState("");
  const [showPoisonVideoPopup, setShowPoisonVideoPopup] = useState(false);
  
  // NEW: Mimic popup state (with video)
  const [showMimicPopup, setShowMimicPopup] = useState(false);
  const [mimicVideoPath, setMimicVideoPath] = useState("");
  const [mimicMessage, setMimicMessage] = useState("");
  
  // NEW: Teleportation popup state (with video)
  const [showTeleportationPopup, setShowTeleportationPopup] = useState(false);
  const [teleportationVideoPath, setTeleportationVideoPath] = useState("");
  const [teleportationMessage, setTeleportationMessage] = useState("");
  
  // NEW: Toxin death popup state (with video)
  const [showToxinDeathPopup, setShowToxinDeathPopup] = useState(false);
  const [toxinDeathMessage, setToxinDeathMessage] = useState("");
  const [toxinDeathVideoPath, setToxinDeathVideoPath] = useState("");
  
  // NEW: Killer elimination popup state (with image)
  const [showKillerEliminationPopup, setShowKillerEliminationPopup] = useState(false);
  const [killerEliminationMessage, setKillerEliminationMessage] = useState("");
  const [killerEliminationImage, setKillerEliminationImage] = useState("");
  const [killerName, setKillerName] = useState("");
  const [survivorName, setSurvivorName] = useState("");
  const [eliminationRoom, setEliminationRoom] = useState("");
  
  // NEW: Gold found popup state (with image)
  const [showGoldFoundPopup, setShowGoldFoundPopup] = useState(false);
  const [goldMessage, setGoldMessage] = useState("");
  const [goldAmount, setGoldAmount] = useState(0);
  const [goldImage, setGoldImage] = useState("");

  // NEW: Crystal spawned popup state (with video)
  const [showCrystalSpawnedPopup, setShowCrystalSpawnedPopup] = useState(false);
  const [crystalSpawnedMessage, setCrystalSpawnedMessage] = useState("");
  const [crystalSpawnedVideoPath, setCrystalSpawnedVideoPath] = useState("");
  
  // NEW: Crystal destroyed popup state (with video)
  const [showCrystalDestroyedPopup, setShowCrystalDestroyedPopup] = useState(false);
  const [crystalDestroyedMessage, setCrystalDestroyedMessage] = useState("");
  const [crystalDestroyedVideoPath, setCrystalDestroyedVideoPath] = useState("");

  // NEW: Merchant encounter popup state (with video)
  const [showMerchantPopup, setShowMerchantPopup] = useState(false);
  const [merchantVideoPath, setMerchantVideoPath] = useState("");
  
  // NEW: Shop dialog state
  const [showShopDialog, setShowShopDialog] = useState(false);
  
  // NEW: Antidote used popup state
  const [showAntidotePopup, setShowAntidotePopup] = useState(false);
  const [antidoteMessage, setAntidoteMessage] = useState("");

  // NEW: Goliath spawn popup state
  const [showGoliathSpawnPopup, setShowGoliathSpawnPopup] = useState(false);
  const [goliathSpawnMessage, setGoliathSpawnMessage] = useState("");
  const [goliathSpawnVideoPath, setGoliathSpawnVideoPath] = useState("");

  // NEW: Goliath death popup state
  const [showGoliathDeathPopup, setShowGoliathDeathPopup] = useState(false);
  const [goliathDeathMessage, setGoliathDeathMessage] = useState("");
  const [goliathDeathVideoPath, setGoliathDeathVideoPath] = useState("");

  // NEW: Eboulement popup state
  const [showEboulementPopup, setShowEboulementPopup] = useState(false);
  const [eboulementMessage, setEboulementMessage] = useState("");
  const [eboulementVideoPath, setEboulementVideoPath] = useState("");

  // NEW: Active traps section state
  const [expandedTrap, setExpandedTrap] = useState(null);

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
        // NEW: Show trap popup for survivor who entered trapped room with video
        setTrapVideoPath(data.video_path || "");
        setShowTrapPopup(true);
        // Auto-hide after 5 seconds
        setTimeout(() => {
          setShowTrapPopup(false);
        }, 5000);
      } else if (data.type === "poisoned_notification") {
        // NEW: Show poison video popup first, then image popup
        setPoisonMessage(data.message);
        setPoisonVideoPath(data.video_path || "");
        
        if (data.video_path) {
          // Show video popup first
          setShowPoisonVideoPopup(true);
        } else {
          // If no video, show image popup directly
          setShowPoisonPopup(true);
          setTimeout(() => {
            setShowPoisonPopup(false);
          }, 5000);
        }
      } else if (data.type === "mimic_notification") {
        // NEW: Show mimic popup for survivor who entered room with mimic
        setMimicVideoPath(data.video_path || "");
        setMimicMessage(data.message);
        setShowMimicPopup(true);
        // Auto-hide after 7 seconds (video is longer)
        setTimeout(() => {
          setShowMimicPopup(false);
        }, 7000);
      } else if (data.type === "teleportation_notification") {
        // NEW: Show teleportation popup for survivor who entered teleportation trap with video
        setTeleportationVideoPath(data.video_path || "");
        setTeleportationMessage(data.message);
        setShowTeleportationPopup(true);
        // Auto-hide after 5 seconds
        setTimeout(() => {
          setShowTeleportationPopup(false);
        }, 5000);
      } else if (data.type === "merchant_encounter") {
        // NEW: Show merchant popup for survivor who encountered the merchant
        setMerchantVideoPath(data.video_path || "");
        setShowMerchantPopup(true);
      } else if (data.type === "antidote_used") {
        // NEW: Show antidote used notification
        setAntidoteMessage(data.message);
        setShowAntidotePopup(true);
        setTimeout(() => {
          setShowAntidotePopup(false);
        }, 3000);
      } else if (data.type === "goliath_spawned") {
        // Show Goliath spawn popup with video (for survivors)
        setGoliathSpawnMessage(data.message);
        setGoliathSpawnVideoPath(data.video_path);
        setShowGoliathSpawnPopup(true);
        // No auto-hide - survivors must click to close
      } else if (data.type === "eboulement_activated") {
        // Show Eboulement popup with video (for survivors)
        setEboulementMessage(data.message);
        setEboulementVideoPath(data.video_path);
        setShowEboulementPopup(true);
        // Auto-hide after 8 seconds
        setTimeout(() => {
          setShowEboulementPopup(false);
        }, 8000);
      } else if (data.type === "goliath_death_popup") {
        // Show Goliath death popup with video
        setGoliathDeathMessage(data.message);
        setGoliathDeathVideoPath(data.video_path);
        setShowGoliathDeathPopup(true);
        // Auto-hide after 6 seconds
        setTimeout(() => {
          setShowGoliathDeathPopup(false);
        }, 6000);
      } else if (data.type === "poison_countdown") {
        // Show poison countdown notification
        toast.warning(data.message, {
          duration: 4000,
          icon: '😷'
        });
      } else if (data.type === "event") {
        toast.info(data.message);
      } else if (data.type === "new_turn") {
    setHasSelectedRoom(false);
    setSelectedRoom(null);
    setSelectedPower(null);
    setPowerActionData(null);
    setShowPowerAction(false);
    setFlashingRooms(new Set());           // ← AJOUTER
    prevPendingActionsRef.current = '{}';  // ← AJOUTER
    toast.info(data.message);
} else if (data.type === "phase_change") {
        setHasSelectedRoom(false);
        setSelectedRoom(null);
        setFlashingRooms(new Set());           // ← AJOUTER
    prevPendingActionsRef.current = '{}';  // ← AJOUTER
        if (data.phase !== "killer_power_selection" && data.phase !== "rage_second_selection") {
          setSelectedPower(null);
          setPowerActionData(null);
          setShowPowerAction(false);
        }
        toast.info(data.message);
      } else if (data.type === "rage_second_chance") {
        // Killer gets a second chance to select a room
        toast.success(data.message, {
          duration: 5000,
          style: {
            backgroundColor: '#dc2626',
            color: 'white',
            fontSize: '1.2rem'
          }
        });
      } else if (data.type === "game_over") {
        // If game over has a video (crystal destroyed), show popup
        if (data.video_path) {
          setCrystalDestroyedMessage(data.message);
          setCrystalDestroyedVideoPath(data.video_path);
          setShowCrystalDestroyedPopup(true);
          // Auto-hide after video ends (assuming ~8 seconds for crystal videos)
          setTimeout(() => {
            setShowCrystalDestroyedPopup(false);
          }, 8000);
        } else {
          // Otherwise just show toast
          toast.success(data.message);
        }
      } else if (data.type === "key_found_popup") {
        // Show popup for key found
        setKeyFoundMessage(data.message);
        setShowKeyFoundPopup(true);
        // Auto-hide after 5 seconds
        setTimeout(() => {
          setShowKeyFoundPopup(false);
        }, 5000);
      } else if (data.type === "quest_completed_popup") {
        // Show popup with video for quest completed
        setQuestCompletedMessage(data.message);
        setQuestVideoPath(data.video_path);
        setShowQuestCompletedPopup(true);
        // Auto-hide after video ends (assuming ~10 seconds)
        setTimeout(() => {
          setShowQuestCompletedPopup(false);
        }, 10000);
      } else if (data.type === "toxin_death_popup") {
        // Show popup with video for toxin death
        setToxinDeathMessage(data.message);
        setToxinDeathVideoPath(data.video_path);
        setShowToxinDeathPopup(true);
        // Auto-hide after video ends (5 seconds for toxin videos)
        setTimeout(() => {
          setShowToxinDeathPopup(false);
        }, 5000);
      } else if (data.type === "wrong_class_popup") {
        // Show popup with image for wrong class
        setWrongClassMessage(data.message);
        setRequiredClassImage(data.required_class_image);
        setShowWrongClassPopup(true);
        // No auto-hide, user must click to close
      } else if (data.type === "gold_found") {
        // Show popup with gold image
        setGoldMessage(data.message);
        setGoldAmount(data.gold_amount);
        setGoldImage(data.gold_image);
        setShowGoldFoundPopup(true);
        // Auto-hide after 5 seconds
        setTimeout(() => {
          setShowGoldFoundPopup(false);
        }, 5000);
      } else if (data.type === "crystal_spawned") {
        // Show popup with video for crystal spawned
        setCrystalSpawnedMessage(data.message);
        setCrystalSpawnedVideoPath(data.video_path);
        setShowCrystalSpawnedPopup(true);
        // Auto-hide after video ends (assuming ~10 seconds)
        setTimeout(() => {
          setShowCrystalSpawnedPopup(false);
        }, 10000);
      } else if (data.type === "crystal_destroyed_popup") {
        // Show popup with video for crystal destroyed
        setCrystalDestroyedMessage(data.message);
        setCrystalDestroyedVideoPath(data.video_path);
        setShowCrystalDestroyedPopup(true);
        // Auto-hide after video ends (assuming ~10 seconds)
        setTimeout(() => {
          setShowCrystalDestroyedPopup(false);
        }, 10000);
      } else if (data.type === "killer_elimination_popup") {
        // Show dramatic elimination popup with fouille video
        setKillerEliminationMessage(data.message);
        setKillerEliminationImage(data.fouille_video); // Reuse this state for video path
        setKillerName(data.killer_name);
        setSurvivorName(data.survivor_name);
        setEliminationRoom(data.room_name);
        setShowKillerEliminationPopup(true);
        // Note: Video will auto-hide when it ends or when clicked
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

 // NEW: Detect teammate room selections and trigger flash
useEffect(() => {
  if (!gameState || !playerId) return;

  const currentPlayer = gameState.players?.[playerId];
  if (!currentPlayer || currentPlayer.role !== 'survivor') return;
  if (gameState.phase !== 'survivor_selection') return;

  const currentActions = gameState.pending_actions || {};
  const currentStr = JSON.stringify(currentActions);

  if (currentStr !== prevPendingActionsRef.current) {
    const prevActions = JSON.parse(prevPendingActionsRef.current);

    Object.entries(currentActions).forEach(([pid, action]) => {
      if (pid === playerId) return; // ignore own selection
      if (!prevActions[pid] || prevActions[pid].room !== action.room) {
        const roomName = action.room;

        setFlashingRooms(prev => new Set([...prev, roomName]));

        // Stop flashing after 2s
        setTimeout(() => {
          setFlashingRooms(prev => {
            const next = new Set(prev);
            next.delete(roomName);
            return next;
          });
        }, 2000);
      }
    });

    prevPendingActionsRef.current = currentStr;
  }
}, [gameState?.pending_actions, gameState?.phase, playerId]);

  const selectRoom = (roomName) => {
    if (hasSelectedRoom || !gameState) return;

    // Check if it's the current player's turn
    const currentPlayer = gameState.players[playerId];
    if (!currentPlayer) return;

    const isMyTurn = (currentPlayer.role === "survivor" && gameState.phase === "survivor_selection") ||
                     (currentPlayer.role === "killer" && (gameState.phase === "killer_selection" || gameState.phase === "rage_second_selection"));

    if (!isMyTurn) {
      if (currentPlayer.role === "survivor" && (gameState.phase === "killer_selection" || gameState.phase === "rage_second_selection")) {
        toast.error("C'est le tour des Orcs !");
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

  // Calculate active traps for survivors
  const getActiveTraps = () => {
    if (currentPlayerRole !== "survivor") return [];
    
    const traps = [];
    
    // Check for Blizzard (trapped rooms)
    const trappedRoomsCount = Object.values(gameState.rooms).filter(room => room.trapped).length;
    if (trappedRoomsCount > 0) {
      traps.push({
        type: "blizzard",
        icon: "/icons/blizzard.png",
        name: "Blizzard",
        description: `Une pièce est prise dans un violent blizzard pour encore 1 Tour.`,
        count: trappedRoomsCount
      });
    }
    
    // Check for Toxine (poisoned rooms)
    const poisonedRooms = Object.values(gameState.rooms).filter(room => room.poisoned_turns_remaining > 0);
    if (poisonedRooms.length > 0) {
      const maxTurns = Math.max(...poisonedRooms.map(room => room.poisoned_turns_remaining));
      traps.push({
        type: "toxine",
        icon: "/icons/toxine.png",
        name: "Toxine",
        description: `Une pièce est empoisonnée par la toxine pour encore ${maxTurns} Tour(s).`,
        count: poisonedRooms.length
      });
    }
    
    // Check for La Goliath
    if (gameState.goliath_active && gameState.goliath_turns_remaining > 0) {
      traps.push({
        type: "goliath",
        icon: "/icons/La goliath.png",
        name: "La Goliath",
        description: `La goliath rôde encore pour ${gameState.goliath_turns_remaining} tours : Ne choisissez jamais une pièce que l'un de vous a visité durant le tour précédent !`,
        count: 1
      });
    }
    
    // Check for Eboulement
    if (gameState.eboulement_active) {
      traps.push({
        type: "eboulement",
        icon: "/icons/Eboulement.png",
        name: "Eboulement",
        description: "Durant ce tour, vous ne pouvez pas changer d'étage.",
        count: 1
      });
    }
    
    return traps;
  };

  const activeTraps = getActiveTraps();

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
                  ? "Vous êtes un aventurier, trouvez le cristal et échappez-vous d'ici !" 
                  : "Vous êtes un Orc, trouvez les survivants et débarrassez-vous d'eux !"}
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
          <Card className="game-over-card" style={{ maxWidth: '600px', backgroundColor: '#2a3f4f', borderColor: '#60a5fa' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#60a5fa' }}>
                🥶
                <span>C'est un blizzard !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trapVideoPath && (
                <video 
                  autoPlay 
                  muted 
                  style={{ width: '100%', maxHeight: '300px', borderRadius: '8px', marginBottom: '1rem' }}
                  onEnded={() => setTimeout(() => setShowTrapPopup(false), 1000)}
                >
                  <source src={trapVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                C'est un blizzard ! Vous n'avez pas d'autre choix que de vous cacher ce tour-ci.
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Poison Video Popup */}
      {showPoisonVideoPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1001 }}
          onClick={() => {
            setShowPoisonVideoPopup(false);
            setShowPoisonPopup(true);
            setTimeout(() => {
              setShowPoisonPopup(false);
            }, 5000);
          }}
          data-testid="poison-video-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '600px', backgroundColor: '#3a4a2a', borderColor: '#84cc16' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#84cc16' }}>
                😷
                <span>Empoisonné !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {poisonVideoPath && (
                <video 
                  autoPlay 
                  muted 
                  style={{ width: '100%', maxHeight: '300px', borderRadius: '8px', marginBottom: '1rem', cursor: 'pointer' }}
                  onEnded={() => {
                    setTimeout(() => {
                      setShowPoisonVideoPopup(false);
                      setShowPoisonPopup(true);
                      setTimeout(() => {
                        setShowPoisonPopup(false);
                      }, 5000);
                    }, 500);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPoisonVideoPopup(false);
                    setShowPoisonPopup(true);
                    setTimeout(() => {
                      setShowPoisonPopup(false);
                    }, 5000);
                  }}
                >
                  <source src={poisonVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez sur la vidéo pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Poison Popup */}
      {showPoisonPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => setShowPoisonPopup(false)}
          data-testid="poison-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '600px', backgroundColor: '#3a4a2a', borderColor: '#84cc16' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#84cc16' }}>
                😷
                <span>Empoisonné !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <img 
                src="/event/Toxine.png" 
                alt="Toxine" 
                style={{ width: '100%', maxHeight: '200px', objectFit: 'contain', marginBottom: '1rem', borderRadius: '8px' }}
              />
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {poisonMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Mimic Popup */}
      {showMimicPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => setShowMimicPopup(false)}
          data-testid="mimic-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '600px', backgroundColor: '#4a3a2a', borderColor: '#f59e0b' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#f59e0b' }}>
                💰
                <span>Mimic !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mimicVideoPath && (
                <video 
                  autoPlay 
                  muted 
                  style={{ width: '100%', maxHeight: '300px', borderRadius: '8px', marginBottom: '1rem' }}
                  onEnded={() => setTimeout(() => setShowMimicPopup(false), 1000)}
                >
                  <source src={mimicVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {mimicMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Teleportation Popup */}
      {showTeleportationPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => setShowTeleportationPopup(false)}
          data-testid="teleportation-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '600px', backgroundColor: '#2a3a4a', borderColor: '#06b6d4' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#06b6d4' }}>
                🌀
                <span>Téléportation !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {teleportationVideoPath && (
                <video 
                  autoPlay 
                  muted 
                  style={{ width: '100%', maxHeight: '300px', borderRadius: '8px', marginBottom: '1rem' }}
                  onEnded={() => setTimeout(() => setShowTeleportationPopup(false), 1000)}
                >
                  <source src={teleportationVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {teleportationMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Quest Completed Popup with Video */}
      {showQuestCompletedPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => setShowQuestCompletedPopup(false)}
          data-testid="quest-completed-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '600px', backgroundColor: '#2a5934', borderColor: '#4ade80' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#4ade80' }}>
                ✅
                <span>Quête complétée !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {questVideoPath && (
                <video 
                  autoPlay 
                  muted 
                  style={{ width: '100%', maxHeight: '300px', borderRadius: '8px', marginBottom: '1rem' }}
                  onEnded={() => setTimeout(() => setShowQuestCompletedPopup(false), 1000)}
                >
                  <source src={questVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {questCompletedMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Toxin Death Popup with Video */}
      {showToxinDeathPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => setShowToxinDeathPopup(false)}
          data-testid="toxin-death-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '600px', backgroundColor: '#4a1d1d', borderColor: '#dc2626' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#dc2626' }}>
                💀
                <span>Mort par toxine</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {toxinDeathVideoPath && (
                <video 
                  autoPlay 
                  muted 
                  style={{ width: '100%', maxHeight: '300px', borderRadius: '8px', marginBottom: '1rem' }}
                  onEnded={() => setTimeout(() => setShowToxinDeathPopup(false), 500)}
                >
                  <source src={toxinDeathVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {toxinDeathMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Wrong Class Popup with Image */}
      {showWrongClassPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => setShowWrongClassPopup(false)}
          data-testid="wrong-class-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '600px', backgroundColor: '#4a3a2a', borderColor: '#f59e0b' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#f59e0b' }}>
                ⚠️
                <span>Classe requise</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {requiredClassImage && (
                <img 
                  src={requiredClassImage} 
                  alt="Classe requise" 
                  style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: '8px', marginBottom: '1rem' }}
                />
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {wrongClassMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Gold Found Popup with Image */}
      {showGoldFoundPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => setShowGoldFoundPopup(false)}
          data-testid="gold-found-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '600px', backgroundColor: '#2d1b00', borderColor: '#FFD700' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#FFD700' }}>
                🪙
                <span>Or trouvé !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {goldImage && (
                <img 
                  src={goldImage} 
                  alt="Or trouvé" 
                  style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: '8px', marginBottom: '1rem' }}
                />
              )}
              <p className="game-over-message" style={{ fontSize: '1.3em', textAlign: 'center', color: '#FFD700', fontWeight: 'bold' }}>
                {goldMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Killer Elimination Popup with Fouille Video */}
      {showKillerEliminationPopup && (
        <div 
          className="killer-elimination-overlay" 
          style={{ zIndex: 2000 }}
          onClick={() => setShowKillerEliminationPopup(false)}
          data-testid="killer-elimination-popup"
        >
          <div className="killer-elimination-card">
            <div className="blood-overlay"></div>
            <div className="elimination-content">
              {killerEliminationImage && (
                <div className="death-image-container">
                  <video 
                    src={killerEliminationImage}
                    autoPlay
                    onEnded={() => setShowKillerEliminationPopup(false)}
                    className="death-image"
                    style={{ width: '100%', height: 'auto', maxHeight: '500px', objectFit: 'contain' }}
                  />
                </div>
              )}
              <div className="elimination-text">
                <h2 className="elimination-title">💀 ÉLIMINATION 💀</h2>
                <p className="elimination-message" style={{ fontSize: '1.2em', textAlign: 'center' }}>
                  {killerEliminationMessage}
                </p>
              </div>
              <p className="elimination-dismiss">Cliquez pour continuer</p>
            </div>
          </div>
        </div>
      )}

      {/* NEW: Crystal Spawned Popup with Video */}
      {showCrystalSpawnedPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1500 }}
          data-testid="crystal-spawned-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '800px', backgroundColor: '#1a0033', borderColor: '#9333ea' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#c084fc' }}>
                💎
                <span>Le Cristal Est Apparu !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {crystalSpawnedVideoPath && (
                <video 
                  src={crystalSpawnedVideoPath} 
                  autoPlay 
                  loop
                  muted
                  style={{ width: '100%', maxHeight: '400px', borderRadius: '8px', marginBottom: '1rem' }}
                />
              )}
              <p className="game-over-message" style={{ fontSize: '1.3em', textAlign: 'center', color: '#c084fc', fontWeight: 'bold' }}>
                {crystalSpawnedMessage}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Crystal Destroyed Popup with Video */}
      {showCrystalDestroyedPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 2000 }}
          data-testid="crystal-destroyed-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '800px', backgroundColor: '#001a33', borderColor: '#3b82f6' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#60a5fa' }}>
                💎
                <span>Cristal Détruit !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {crystalDestroyedVideoPath && (
                <video 
                  src={crystalDestroyedVideoPath} 
                  autoPlay 
                  muted
                  style={{ width: '100%', maxHeight: '400px', borderRadius: '8px', marginBottom: '1rem' }}
                  onEnded={() => setTimeout(() => setShowCrystalDestroyedPopup(false), 1000)}
                />
              )}
              <p className="game-over-message" style={{ fontSize: '1.5em', textAlign: 'center', color: '#60a5fa', fontWeight: 'bold' }}>
                {crystalDestroyedMessage}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Merchant Encounter Popup with Video */}
      {showMerchantPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 2000 }}
          data-testid="merchant-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#3a2817', borderColor: '#d4af37' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#d4af37' }}>
                🧙
                <span>Vous rencontrez le marchand !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {merchantVideoPath && (
                <video 
                  src={merchantVideoPath} 
                  autoPlay 
                  loop
                  muted
                  style={{ width: '100%', maxHeight: '400px', borderRadius: '8px', marginBottom: '1rem' }}
                />
              )}
              <p className="game-over-message" style={{ fontSize: '1.2em', textAlign: 'center', color: '#fff', marginBottom: '1.5rem' }}>
                Vous rencontrez le marchand !
              </p>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                <Button
                  onClick={() => {
                    setShowMerchantPopup(false);
                    setShowShopDialog(true);
                  }}
                  style={{ 
                    backgroundColor: '#d4af37', 
                    color: '#000', 
                    fontWeight: 'bold',
                    padding: '1rem 2rem',
                    fontSize: '1.1rem'
                  }}
                >
                  Qu'avez-vous à me vendre ?
                </Button>
                <Button
                  onClick={() => setShowMerchantPopup(false)}
                  style={{ 
                    backgroundColor: '#555', 
                    color: '#fff',
                    padding: '1rem 2rem',
                    fontSize: '1.1rem'
                  }}
                >
                  Je ne suis pas intéressé
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Shop Dialog */}
      {showShopDialog && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 2001 }}
          data-testid="shop-dialog"
        >
          <Card className="game-over-card" style={{ maxWidth: '800px', backgroundColor: '#2a1f17', borderColor: '#d4af37' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#d4af37' }}>
                🛒
                <span>Boutique du Marchand</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Display player's gold */}
              <div style={{ textAlign: 'center', marginBottom: '1.5rem', fontSize: '1.3rem', color: '#FFD700', fontWeight: 'bold' }}>
                Votre or: 🪙 {gameState.players[playerId]?.gold || 0}
              </div>

              {/* Shop items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Resurrection Potion */}
                <div style={{ 
                  padding: '1.5rem', 
                  backgroundColor: 'rgba(139, 92, 46, 0.3)', 
                  border: '2px solid #d4af37',
                  borderRadius: '8px',
                  display: 'flex',
                  gap: '1rem',
                  alignItems: 'center'
                }}>
                  <img src="/items/medikit.png" alt="Potion de résurrection" style={{ width: '80px', height: '80px', objectFit: 'contain' }} />
                  <div style={{ flex: 1 }}>
                    <h3 style={{ color: '#d4af37', fontSize: '1.2rem', marginBottom: '0.5rem' }}>Potion de résurrection</h3>
                    <p style={{ color: '#ccc', fontSize: '0.95rem', marginBottom: '0.5rem' }}>
                      Cette potion permet de réanimer le joueur que vous aspergez.
                    </p>
                    <p style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '1.1rem' }}>Prix: 🪙 1000</p>
                  </div>
                  <Button
                    onClick={async () => {
                      try {
                        await axios.post(`${API}/shop/buy_item?session_id=${sessionId}&player_id=${playerId}&item_name=resurrection_potion`);
                        toast.success("Potion de résurrection achetée !");
                      } catch (error) {
                        toast.error(error.response?.data?.detail || "Erreur lors de l'achat");
                      }
                    }}
                    disabled={gameState.players[playerId]?.gold < 1000 || gameState.players[playerId]?.has_medikit}
                    style={{ 
                      backgroundColor: (gameState.players[playerId]?.gold >= 1000 && !gameState.players[playerId]?.has_medikit) ? '#10b981' : '#555',
                      minWidth: '100px'
                    }}
                  >
                    Acheter
                  </Button>
                </div>

                {/* Antidote */}
                <div style={{ 
                  padding: '1.5rem', 
                  backgroundColor: 'rgba(139, 92, 46, 0.3)', 
                  border: '2px solid #d4af37',
                  borderRadius: '8px',
                  display: 'flex',
                  gap: '1rem',
                  alignItems: 'center'
                }}>
                  <img src="/items/antidote.png" alt="Antidote" style={{ width: '80px', height: '80px', objectFit: 'contain' }} />
                  <div style={{ flex: 1 }}>
                    <h3 style={{ color: '#d4af37', fontSize: '1.2rem', marginBottom: '0.5rem' }}>Antidote</h3>
                    <p style={{ color: '#ccc', fontSize: '0.95rem', marginBottom: '0.5rem' }}>
                      Cet antidote soigne de la toxine.
                    </p>
                    <p style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '1.1rem' }}>Prix: 🪙 300</p>
                  </div>
                  <Button
                    onClick={async () => {
                      try {
                        await axios.post(`${API}/shop/buy_item?session_id=${sessionId}&player_id=${playerId}&item_name=antidote`);
                        toast.success("Antidote acheté !");
                      } catch (error) {
                        toast.error(error.response?.data?.detail || "Erreur lors de l'achat");
                      }
                    }}
                    disabled={gameState.players[playerId]?.gold < 300 || gameState.players[playerId]?.has_antidote}
                    style={{ 
                      backgroundColor: (gameState.players[playerId]?.gold >= 300 && !gameState.players[playerId]?.has_antidote) ? '#10b981' : '#555',
                      minWidth: '100px'
                    }}
                  >
                    Acheter
                  </Button>
                </div>
              </div>

              {/* Close button */}
              <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                <Button
                  onClick={() => setShowShopDialog(false)}
                  style={{ 
                    backgroundColor: '#dc2626', 
                    color: '#fff',
                    padding: '0.8rem 2rem',
                    fontSize: '1rem'
                  }}
                >
                  Fermer la boutique
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Antidote Used Popup */}
      {showAntidotePopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => setShowAntidotePopup(false)}
          data-testid="antidote-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '600px', backgroundColor: '#2a4a3a', borderColor: '#10b981' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#10b981' }}>
                💊
                <span>Antidote utilisé !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {antidoteMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Goliath Spawn Popup */}
      {showGoliathSpawnPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1001 }}
          onClick={() => setShowGoliathSpawnPopup(false)}
          data-testid="goliath-spawn-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#2a2a2a', borderColor: '#8b0000' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#dc2626' }}>
                🕷️
                <span>La Goliath est invoquée !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {goliathSpawnVideoPath && (
                <video 
                  autoPlay 
                  muted 
                  style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1rem' }}
                  onEnded={() => setTimeout(() => setShowGoliathSpawnPopup(false), 1000)}
                >
                  <source src={goliathSpawnVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {goliathSpawnMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Eboulement Popup */}
      {showEboulementPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1001 }}
          onClick={() => setShowEboulementPopup(false)}
          data-testid="eboulement-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#3a2a1a', borderColor: '#8b4513' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#d2691e' }}>
                ⛰️
                <span>Éboulement !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {eboulementVideoPath && (
                <video 
                  autoPlay 
                  muted 
                  style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1rem' }}
                  onEnded={() => setTimeout(() => setShowEboulementPopup(false), 1000)}
                >
                  <source src={eboulementVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {eboulementMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Goliath Death Popup */}
      {showGoliathDeathPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1001 }}
          onClick={() => setShowGoliathDeathPopup(false)}
          data-testid="goliath-death-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#1a1a1a', borderColor: '#8b0000' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#dc2626' }}>
                💀🕷️
                <span>La Goliath frappe !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {goliathDeathVideoPath && (
                <video 
                  autoPlay 
                  muted 
                  style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1rem' }}
                  onEnded={() => setTimeout(() => setShowGoliathDeathPopup(false), 1000)}
                >
                  <source src={goliathDeathVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {goliathDeathMessage}
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
          {gameState.phase === "survivor_selection" && (
            <div className="phase-indicator survivor-phase" data-testid="phase-indicator">
              🛡️ Tour des survivants
            </div>
          )}
{gameState.phase === "killer_power_selection" && (
    <div className="phase-indicator killer-phase" data-testid="phase-indicator">
      {currentPlayerRole === "killer" ? "🎴 Sélection de pouvoir" : "🔪 Tour des Orcs"}
    </div>
)}
{gameState.phase === "killer_selection" && (
    <div className="phase-indicator killer-phase" data-testid="phase-indicator">
      🔪 {currentPlayerRole === "killer" ? "Choisissez une pièce à fouiller" : "Tour des Orcs"}
    </div>
)}
          {gameState.phase === "processing" && (
            <div className="phase-indicator processing-phase" data-testid="phase-indicator">
              ⏳ Traitement en cours...
            </div>
          )}
          <h2 className="turn-indicator" data-testid="turn-indicator">Tour {gameState.turn}</h2>
          <div className="keys-counter" data-testid="keys-counter">
            🔑 {gameState.keys_collected}/{gameState.keys_needed}
          </div>
        </div>
      </div>

      {/* Active Traps Section - Only for survivors */}
      {currentPlayerRole === "survivor" && !isEliminated && activeTraps.length > 0 && (
        <div className="active-traps-section" data-testid="active-traps-section">
          <div className="active-traps-container">
            {activeTraps.map((trap) => (
              <div key={trap.type} className="trap-icon-wrapper">
                <button
                  className={`trap-icon-btn ${expandedTrap === trap.type ? 'expanded' : ''}`}
                  onClick={() => setExpandedTrap(expandedTrap === trap.type ? null : trap.type)}
                  title={trap.name}
                  data-testid={`trap-icon-${trap.type}`}
                >
                  <img src={trap.icon} alt={trap.name} className="trap-icon" />
                </button>
                {expandedTrap === trap.type && (
                  <div className="trap-description" data-testid={`trap-description-${trap.type}`}>
                    {trap.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
                  ? "Les aventuriers ont collecté toutes les clefs !"
                  : "Les Orcs ont éliminé tous les survivants..."}
              </p>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
<Button
  data-testid="back-lobby-btn"
  onClick={async () => {
    // Reset game - the server will broadcast game_reset to ALL players
    // The game_reset handler below will redirect everyone to lobby
    try {
      await axios.post(`${API}/game/${sessionId}/reset`);
      // Don't navigate here - wait for the game_reset broadcast
      // which will redirect ALL players including this one
    } catch (error) {
      console.error("Error resetting game:", error);
      // Fallback: redirect manually if reset fails
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

          {["upper_floor", "ground_floor", "basement"].map((floor) => (
            <div key={floor} className="floor-section">
              <h4 className="floor-title">{FLOOR_NAMES[floor]}</h4>
              <div className="rooms-grid">
                {roomsByFloor[floor].map((room) => {
                  // CORRECTION: Show players that are in this room during selection phase
                  let playersSelectingThisRoom = [];

                  // During survivor_selection or killer_selection phase, show who is selecting this room
                  // Only show players of the same role as current player
                  if (gameState.phase === "survivor_selection" || gameState.phase === "killer_selection" || gameState.phase === "rage_second_selection" || gameState.phase === "processing") {
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
                  const isPoisoned = room.poisoned_turns_remaining > 0 && currentPlayerRole === "killer";
                  const hasMimic = room.has_mimic && currentPlayerRole === "killer";
                  const hasTeleportationTrap = room.teleportation_trap && currentPlayerRole === "killer";
                  const hasTeleportationExit = room.teleportation_exit && currentPlayerRole === "killer";

                  return (
                    <button
                      key={room.name}
                      data-testid={`room-${room.name.replace(/\s+/g, '-').toLowerCase()}`}
                      data-room-name={room.name}
                      className={`room-card ${
                        selectedRoom === room.name ? 'selected' :
                        room.locked ? 'locked' : ''
                       } ${isHighlighted ? 'room-highlighted' : ''} ${flashingRooms.has(room.name) ? 'room-teammate-flash' : ''}`}
                      onClick={() => selectRoom(room.name)}
                      disabled={isEliminated || hasSelectedRoom || room.locked}
                    >
                      <div className="room-name">{room.name}</div>
                      <div className="room-indicators">
                        {room.locked && <span className="room-icon locked-icon">❌</span>}
                        {eliminatedInRoom.length > 0 && <span className="room-icon skull-icon">💀</span>}
                        {isTrapped && <span className="room-icon room-trap-indicator" title="Blizzard">🥶</span>}
                        {isTrapTriggered && <span className="room-icon room-trap-indicator" title="Blizzard activé">🥶</span>}
                        {isPoisoned && <span className="room-icon room-poison-indicator" title="Toxine">😷</span>}
                        {hasMimic && <span className="room-icon room-mimic-indicator" title="Mimic">💰</span>}
                        {hasTeleportationTrap && <span className="room-icon room-teleport-trap-indicator" title="Piège de téléportation">➡️🌀</span>}
                        {hasTeleportationExit && <span className="room-icon room-teleport-exit-indicator" title="Portail de sortie">🌀➡️</span>}
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

                      // Filter search events (fouille) - only for survivors
                      if ((event.type === "key_found" || event.type === "search_no_key" || 
                           event.type === "search_no_quest" || event.type === "search_wrong_class" || 
                           event.type === "quest_completed") && 
                          event.for_role && event.for_role !== currentPlayerRole) {
                        return null; // Don't show search events meant for survivors to killers
                      }

                      // Render event with avatar if player info is available
                      const renderEventContent = () => {
                        if (event.player_avatar) {
                          // Extract player name and the rest of the message
                          const message = event.message;
                          
                          // For revival events with two players
                          if (event.type === "revival" && event.target_player_avatar) {
                            // Pattern: "💚 PlayerA a ranimé PlayerB !"
                            const reviverPlayer = gameState.players[event.player_id];
                            const revivedPlayer = gameState.players[event.target_player_id];
                            
                            if (reviverPlayer && revivedPlayer) {
                              return (
                                <span className="event-with-avatars">
                                  <span className="event-emoji">💚</span>
                                  <img src={event.player_avatar} alt="" className="event-avatar" />
                                  <span className="event-player-name">{reviverPlayer.name}</span>
                                  <span> a ranimé </span>
                                  <img src={event.target_player_avatar} alt="" className="event-avatar" />
                                  <span className="event-player-name">{revivedPlayer.name}</span>
                                  <span> !</span>
                                </span>
                              );
                            }
                          }
                          
                          // For all other events with a player
                          const player = gameState.players[event.player_id];
                          if (player) {
                            // Extract emoji at the beginning (if present)
                            const emojiMatch = message.match(/^([\u{1F300}-\u{1F9FF}]|\u{2600}-\u{27BF}|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2700}-\u{27BF}])+/u);
                            const emoji = emojiMatch ? emojiMatch[0] : '';
                            
                            // Remove emoji and player name from message to get the rest
                            let restOfMessage = message;
                            if (emoji) {
                              restOfMessage = restOfMessage.replace(emoji, '').trim();
                            }
                            // Remove player name from the message
                            const nameIndex = restOfMessage.indexOf(player.name);
                            if (nameIndex !== -1) {
                              restOfMessage = restOfMessage.substring(nameIndex + player.name.length);
                            }
                            
                            return (
                              <span className="event-with-avatar">
                                <img src={event.player_avatar} alt="" className="event-avatar" />
                                <span className="event-player-name">{player.name}</span>
                                <span>{restOfMessage}</span>
                                {emoji && <span className="event-emoji-suffix"> {emoji}</span>}
                              </span>
                            );
                          }
                        }
                        
                        // Default: show message as is
                        return event.message;
                      };

                      return (
                        <div
                          key={idx}
                          className={`event-item event-${event.type}`}
                          data-testid={`event-${idx}`}
                        >
                          {renderEventContent()}
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
                    {player.has_medikit && <span className="status-medikit">⚗️</span>}
                    {player.has_antidote && <span className="status-antidote">💊</span>}
                    {player.eliminated && <span className="status-eliminated">💀</span>}
                    {player.poisoned_countdown > 0 && currentPlayerRole === "survivor" && player.role === "survivor" && (
                      <span className="status-poisoned">
                        {player.poisoned_countdown <= 3 ? '🤮' : player.poisoned_countdown <= 6 ? '🤢' : '😷'}{player.poisoned_countdown}
                      </span>
                    )}
                    {currentPlayerRole === "survivor" && player.role === "survivor" && player.gold > 0 && (
                      <span className="status-gold" style={{ color: '#FFD700', fontWeight: 'bold' }}>
                        🪙{player.gold}
                      </span>
                    )}
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
