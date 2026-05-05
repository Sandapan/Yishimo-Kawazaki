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

// Inventory system constants
// Slot positions are measured from grid_background.png (1440x1440, ~5% wood border).
// Cells are centered at 28%, 52%, 76% (horizontal) and 27%, 51%, 75% (vertical).
// With slot size 21% x 21%, top-left = center - 10.5%.
const SLOT_POSITIONS = [
  { left: '17.5%', top: '16.5%' }, // slot 0 (haut-gauche)
  { left: '41.5%', top: '16.5%' }, // slot 1
  { left: '65.5%', top: '16.5%' }, // slot 2
  { left: '17.5%', top: '40.5%' }, // slot 3
  { left: '41.5%', top: '40.5%' }, // slot 4 (centre)
  { left: '65.5%', top: '40.5%' }, // slot 5
  { left: '17.5%', top: '64.5%' }, // slot 6
  { left: '41.5%', top: '64.5%' }, // slot 7
  { left: '65.5%', top: '64.5%' }, // slot 8 (bas-droite)
];

// Slot dimensions (kept here so InventoryModal can stay declarative).
const SLOT_SIZE_PCT = 21; // % of inventory container - matches the stone cell interior

const ITEM_SPRITES = {
  rune_dommage: '/inventory/rune_dommage.png',
  rune_initiative: '/inventory/rune_initiative.png',
  rune_vitalite: '/inventory/rune_vitalite.png',
  medikit: '/inventory/medikit.png',
  antidote: '/inventory/antidote.png',
};

const ITEM_NAMES = {
  rune_dommage: 'Rune de Dommage',
  rune_initiative: 'Rune d\'Initiative',
  rune_vitalite: 'Rune de Vitalité',
  medikit: 'Médikit',
  antidote: 'Antidote',
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


// ========== GOBLIN COMBAT COMPONENT ==========
const GoblinCombat = ({ event, playerId, sessionId, onClose, wsRef }) => {
  // L'orc a 6 PV, l'aventurier a ses PV actuels (depuis le serveur, défaut 36)
  const isDefender = event.defender_id === playerId;
  const isAttacker = event.attacker_id === playerId;
  
  // Seul le DÉFENSEUR (aventurier) simule le combat et envoie le résultat
  const isSimulator = isDefender;
  
  // PV initiaux selon le rôle dans le combat
  const initialSurvivorHP = event.defender_hp || 36;
  const [survivorHP, setSurvivorHP] = useState(36);
  const [orcHP, setOrcHP] = useState(6);
  const [turn, setTurn] = useState("survivor");
  const [speed, setSpeed] = useState(400);
  const [combatLog, setCombatLog] = useState([]);
  const [combatOver, setCombatOver] = useState(false);
  const [combatResult, setCombatResult] = useState(null);
  const [survivorAttacking, setSurvivorAttacking] = useState(false);
  const [orcAttacking, setOrcAttacking] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [totalDamageToSurvivor, setTotalDamageToSurvivor] = useState(0);

  // Classes et noms
  const survivorClass = event.defender_class;
  const survivorName = event.defender_name || survivorClass;
  const orcClass = event.attacker_class;
  const orcName = event.attacker_name || orcClass;

  // Images
  const survivorImage = `/fight/${survivorClass}-fight.png`;
  const orcImage = `/fight/Gobelin-fight.png`;

  // A) Attacker (orc) listens for combat logs from server
  useEffect(() => {
    if (!isAttacker || isDefender) return;
    if (!wsRef?.current) return;

    const ws = wsRef.current;

    const handleMessage = (messageEvent) => {
      try {
        const data = JSON.parse(messageEvent.data);

        // We accept multiple possible server message types to avoid breaking
        if (data.type === "combat_log_update") {
          // Ensure it's the correct combat
          if (
            data.attacker_id === event.attacker_id &&
            data.defender_id === event.defender_id
          ) {
            if (data.log_entry) {
              setCombatLog((prev) => [...prev, data.log_entry]);
            } else if (data.entry) {
              setCombatLog((prev) => [...prev, data.entry]);
            }
          }
        }

        // Optional: allow server to force close / end combat view
        if (data.type === "combat_result") {
          if (
            data.attacker_id === event.attacker_id &&
            data.defender_id === event.defender_id
          ) {
            if (data.result) setCombatResult(data.result);
            setCombatOver(true);
            setCanClose(true);
          }
        }
      } catch (e) {
        // ignore parsing errors
      }
    };

    ws.addEventListener("message", handleMessage);

    return () => {
      ws.removeEventListener("message", handleMessage);
    };
  }, [isAttacker, isDefender, wsRef, event]);
  useEffect(() => {
    // Seul le défenseur (aventurier) simule le combat
    if (!isSimulator) return;

    let mounted = true;

    const runCombat = async () => {
      // Utiliser les PV actuels de l'aventurier depuis le serveur
      let currentSurvivorHP = initialSurvivorHP;
      let currentOrcHP = 6;
      let currentTurn = "survivor";
      let currentSpeed = 400;
      const log = [];
      let damageToSurvivor = 0;

      while (currentSurvivorHP > 0 && currentOrcHP > 0 && mounted) {
        await new Promise((resolve) => setTimeout(resolve, currentSpeed));

        const damage = Math.floor(Math.random() * 6) + 1; // 1-6
        let logEntry = "";

        if (currentTurn === "survivor") {
          // L'aventurier attaque l'orc
          setSurvivorAttacking(true);
          setTimeout(() => setSurvivorAttacking(false), 300);

          currentOrcHP = Math.max(0, currentOrcHP - damage);
          setOrcHP(currentOrcHP);
          logEntry = `⚔️ ${survivorClass} inflige ${damage} dégâts !`;
          log.push(logEntry);
          setCombatLog([...log]);

          currentTurn = "orc";
        } else {
          // L'orc attaque l'aventurier
          setOrcAttacking(true);
          setTimeout(() => setOrcAttacking(false), 300);

          currentSurvivorHP = Math.max(0, currentSurvivorHP - damage);
          damageToSurvivor += damage;
          setSurvivorHP(currentSurvivorHP);
          setTotalDamageToSurvivor(damageToSurvivor);
          logEntry = `🩸 L'Orc inflige ${damage} dégâts !`;
          log.push(logEntry);
          setCombatLog([...log]);

          currentTurn = "survivor";
        }

        // C) Send log entry to server (so attacker can see it)
        try {
          await axios.post(`${API}/game/${sessionId}/combat_log`, {
            attacker_id: event.attacker_id,
            defender_id: event.defender_id,
            log_entry: logEntry,
          });
        } catch (e) {}

        setTurn(currentTurn);
        currentSpeed = Math.max(120, currentSpeed - 40);
        setSpeed(currentSpeed);
      }

      if (!mounted) return;

      // Combat terminé
      setCombatOver(true);
      
      // Résultat : si l'orc est à 0 PV, l'aventurier gagne
      const result = currentOrcHP <= 0 ? "defender_win" : "attacker_win";
      setCombatResult(result);

      // Pause dramatique puis envoyer le résultat
      await new Promise((resolve) => setTimeout(resolve, 1500));

      try {
        await axios.post(`${API}/game/${sessionId}/resolve_combat`, {
          attacker_id: event.attacker_id,
          defender_id: event.defender_id,
          result: result,
          damage_dealt: damageToSurvivor
        });
      } catch (error) {
        console.error("Erreur lors de la résolution du combat:", error);
      }

      // Permettre de fermer après 1 seconde
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setCanClose(true);
    };

    runCombat();

    return () => {
      mounted = false;
    };
  }, [isSimulator, sessionId, event, survivorClass]);

  // Pour l'attaquant (orc), on affiche la vue avec les logs (sans simuler le combat)
  if (isAttacker && !isDefender) {
    return (
      <div
        className="game-over-overlay"
        style={{ zIndex: 3000, cursor: canClose ? "pointer" : "default" }}
        onClick={() => canClose && onClose && onClose()}
        data-testid="goblin-combat"
      >
        <Card
          className="game-over-card"
          style={{
            maxWidth: "800px",
            backgroundColor: "#2a1f17",
            borderColor: "#d4af37",
          }}
        >
          <CardHeader>
            <CardTitle style={{ color: "#d4af37", textAlign: "center", fontSize: "1.8rem" }}>
              ⚔️ COMBAT !
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
              {/* Orc (vous) */}
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ position: "relative", marginBottom: "1rem" }}>
                  <img
                    src={orcImage}
                    alt={orcClass}
                    style={{
                      width: "200px",
                      height: "112px",
                      objectFit: "contain",
                      transform: orcAttacking ? "translateX(-30px) scale(1.1)" : "translateX(0) scale(1)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                  {orcAttacking && (
                    <div style={{ position: "absolute", top: "50%", left: "-20px", fontSize: "2rem" }}>💥</div>
                  )}
                </div>
                <h3 style={{ color: "#ef4444", marginBottom: "0.5rem" }}>{orcClass} (Vous)</h3>
                <div style={{ width: "200px", height: "20px", backgroundColor: "#333", borderRadius: "10px", overflow: "hidden", margin: "0 auto" }}>
                  <div
                    style={{
                      width: `${(orcHP / 6) * 100}%`,
                      height: "100%",
                      backgroundColor: orcHP > 2 ? "#ef4444" : "#991b1b",
                      transition: "width 0.3s ease",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.75rem",
                      fontWeight: "bold",
                      color: "#fff",
                    }}
                  >
                    {orcHP}/6
                  </div>
                </div>
              </div>

              {/* VS */}
              <div style={{ fontSize: "3rem", fontWeight: "bold", color: "#d4af37", margin: "0 2rem" }}>VS</div>

              {/* Aventurier */}
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ position: "relative", marginBottom: "1rem" }}>
                  <img
                    src={survivorImage}
                    alt={survivorClass}
                    style={{
                      width: "200px",
                      height: "112px",
                      objectFit: "contain",
                      transform: survivorAttacking ? "translateX(30px) scale(1.1)" : "translateX(0) scale(1)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                  {survivorAttacking && (
                    <div style={{ position: "absolute", top: "50%", right: "-20px", fontSize: "2rem" }}>💥</div>
                  )}
                </div>
                <h3 style={{ color: "#10b981", marginBottom: "0.5rem" }}>{survivorClass}</h3>
                <div style={{ width: "200px", height: "20px", backgroundColor: "#333", borderRadius: "10px", overflow: "hidden", margin: "0 auto" }}>
                  <div
                    style={{
                      width: `${(survivorHP / initialSurvivorHP) * 100}%`,
                      height: "100%",
                      backgroundColor: survivorHP > 12 ? "#10b981" : "#ef4444",
                      transition: "width 0.3s ease",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.75rem",
                      fontWeight: "bold",
                      color: "#fff",
                    }}
                  >
                    {survivorHP}/{initialSurvivorHP}
                  </div>
                </div>
              </div>
            </div>

            {/* Combat Log */}
            <div style={{ backgroundColor: "rgba(0,0,0,0.5)", padding: "1rem", borderRadius: "8px", maxHeight: "120px", overflowY: "auto", marginBottom: "1rem" }}>
              {combatLog.length === 0 ? (
                <div style={{ color: "#888", textAlign: "center" }}>En attente des actions...</div>
              ) : (
                combatLog.map((entry, idx) => (
                  <div key={idx} style={{ color: "#e8dcc4", fontSize: "0.9rem", marginBottom: "0.3rem" }}>
                    {entry}
                  </div>
                ))
              )}
            </div>

            {combatOver && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: combatResult === "attacker_win" ? "#10b981" : "#ef4444" }}>
                  {combatResult === "attacker_win"
                    ? "🎉 VICTOIRE ! Vous avez vaincu l'aventurier !"
                    : "💀 DÉFAITE ! L'aventurier vous a repoussé !"}
                </div>
              </div>
            )}

            {canClose && (
              <p style={{ color: "#d4af37", marginTop: "1rem", fontSize: "0.9rem", textAlign: "center" }}>
                Cliquez pour fermer
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Vue pour le défenseur (aventurier) - combat complet
  return (
    <div
      className="game-over-overlay"
      style={{ zIndex: 3000, cursor: canClose ? "pointer" : "default" }}
      onClick={() => canClose && onClose && onClose()}
      data-testid="goblin-combat"
    >
      <Card
        className="game-over-card"
        style={{
          maxWidth: "800px",
          backgroundColor: "#2a1f17",
          borderColor: "#d4af37",
        }}
      >
        <CardHeader>
          <CardTitle style={{ color: "#d4af37", textAlign: "center", fontSize: "1.8rem" }}>
            ⚔️ COMBAT !
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
            {/* Aventurier (vous) */}
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ position: "relative", marginBottom: "1rem" }}>
                <img
                  src={survivorImage}
                  alt={survivorClass}
                  style={{
                    width: "200px",
                    height: "112px",
                    objectFit: "contain",
                    transform: survivorAttacking ? "translateX(30px) scale(1.1)" : "translateX(0) scale(1)",
                    transition: "transform 0.2s ease",
                  }}
                />
                {survivorAttacking && (
                  <div style={{ position: "absolute", top: "50%", right: "-20px", fontSize: "2rem" }}>💥</div>
                )}
              </div>
              <h3 style={{ color: "#10b981", marginBottom: "0.5rem" }}>{survivorClass} (Vous)</h3>
              <div style={{ width: "200px", height: "20px", backgroundColor: "#333", borderRadius: "10px", overflow: "hidden", margin: "0 auto" }}>
                <div
                  style={{
                    width: `${(survivorHP / 36) * 100}%`,
                    height: "100%",
                    backgroundColor: survivorHP > 12 ? "#10b981" : "#ef4444",
                    transition: "width 0.3s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.75rem",
                    fontWeight: "bold",
                    color: "#fff",
                  }}
                >
                  {survivorHP}/36
                </div>
              </div>
            </div>

            {/* VS */}
            <div style={{ fontSize: "3rem", fontWeight: "bold", color: "#d4af37", margin: "0 2rem" }}>VS</div>

            {/* Orc */}
            <div style={{ textAlign: "center", flex: 1 }}>
              <div style={{ position: "relative", marginBottom: "1rem" }}>
                <img
                  src={orcImage}
                  alt="Orc"
                  style={{
                    width: "200px",
                    height: "112px",
                    objectFit: "contain",
                    transform: orcAttacking ? "translateX(-30px) scale(1.1)" : "translateX(0) scale(1)",
                    transition: "transform 0.2s ease",
                  }}
                />
                {orcAttacking && (
                  <div style={{ position: "absolute", top: "50%", left: "-20px", fontSize: "2rem" }}>💥</div>
                )}
              </div>
              <h3 style={{ color: "#ef4444", marginBottom: "0.5rem" }}>{orcClass}</h3>
              <div style={{ width: "200px", height: "20px", backgroundColor: "#333", borderRadius: "10px", overflow: "hidden", margin: "0 auto" }}>
                <div
                  style={{
                    width: `${(orcHP / 6) * 100}%`,
                    height: "100%",
                    backgroundColor: orcHP > 2 ? "#ef4444" : "#991b1b",
                    transition: "width 0.3s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.75rem",
                    fontWeight: "bold",
                    color: "#fff",
                  }}
                >
                  {orcHP}/6
                </div>
              </div>
            </div>
          </div>

          {/* Combat Log */}
          <div style={{ backgroundColor: "rgba(0,0,0,0.5)", padding: "1rem", borderRadius: "8px", maxHeight: "120px", overflowY: "auto", marginBottom: "1rem" }}>
            {combatLog.map((logEntry, idx) => (
              <div key={idx} style={{ color: "#e8dcc4", fontSize: "0.9rem", marginBottom: "0.3rem" }}>
                {logEntry}
              </div>
            ))}
          </div>

          {combatOver && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: combatResult === "defender_win" ? "#10b981" : "#ef4444" }}>
                {combatResult === "defender_win" ? "🎉 VICTOIRE ! Vous avez vaincu l'Orc !" : "💀 DÉFAITE ! L'Orc vous a terrassé !"}
              </div>
              {canClose && (
                <p style={{ color: "#d4af37", marginTop: "1rem", fontSize: "0.9rem" }}>
                  Cliquez pour fermer
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ========== SPRITE SHEET ANIMATOR COMPONENT ==========
const SpriteSheetAnimator = ({ spriteSheet, frameWidth, frameHeight, cols, rows, totalFrames, frameDuration = 100, loop = true, onAnimationEnd }) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    const image = new Image();
    image.src = spriteSheet;
    image.onload = () => {
      imageRef.current = image;
    };
    // Réinitialiser la frame à 0 quand on change de sprite sheet (idle → attack → hurt)
    setCurrentFrame(0);
  }, [spriteSheet]);

  useEffect(() => {
    if (!imageRef.current || !canvasRef.current) return;
    
    // Attendre que l'image soit complètement chargée
    if (!imageRef.current.complete) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Calculer la position de la frame dans la sprite sheet
    const col = currentFrame % cols;
    const row = Math.floor(currentFrame / cols);
    
    // Effacer le canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Dessiner la frame actuelle
    try {
      ctx.drawImage(
        imageRef.current,
        col * frameWidth,      // source X
        row * frameHeight,     // source Y
        frameWidth,            // source largeur
        frameHeight,           // source hauteur
        0,                     // destination X
        0,                     // destination Y
        canvas.width,          // destination largeur
        canvas.height          // destination hauteur
      );
    } catch (error) {
      console.error('Erreur lors du dessin de la frame:', error);
    }
  }, [currentFrame, frameWidth, frameHeight, cols, rows]);

  useEffect(() => {
    const animate = () => {
      setCurrentFrame(prev => {
        const nextFrame = prev + 1;
        if (nextFrame >= totalFrames) {
          if (loop) {
            return 0;
          } else {
            if (onAnimationEnd) onAnimationEnd();
            return prev; // Rester sur la dernière frame
          }
        }
        return nextFrame;
      });
    };

    animationRef.current = setInterval(animate, frameDuration);

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, [totalFrames, frameDuration, loop, onAnimationEnd]);

  return (
    <canvas
      ref={canvasRef}
      width={200}  // Taille d'affichage à l'écran
      height={138} // Ratio 1000:690 ≈ 200:138
      style={{ imageRendering: 'pixelated' }}
    />
  );
};

// Fonction de hash simple pour générer des nombres déterministes
const hashCode = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
};

// Générateur de nombres pseudo-aléatoires déterministe (PRNG)
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }
  
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

// ========== MULTIPLAYER COMBAT COMPONENT ==========
const MultiPlayerCombat = ({ event, playerId, sessionId, onClose, wsRef }) => {
  const isAttacker = event.attacker_id === playerId;
  const isSurvivor = event.survivors.some(s => s.id === playerId);
  
  // NOUVEAU : Tous les clients simulent le combat localement (déterministe)
  // Seul le PREMIER aventurier envoie les résultats au serveur
  const isSimulator = isSurvivor && event.survivors[0].id === playerId;
  const shouldSimulate = true; // Tous les clients simulent
  
  // État du combat
  const [combatants, setCombatants] = useState([]);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [combatLog, setCombatLog] = useState([]);
  const [combatOver, setCombatOver] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [animatingEntity, setAnimatingEntity] = useState(null); // {id, type: 'attack' | 'hurt'}
  const [damageIndicators, setDamageIndicators] = useState({}); // {entityId: {damage: number, timestamp: number}}

  // Initialiser les combattants avec initiative
  useEffect(() => {
    const fighters = [];
    
    // Ajouter les aventuriers
    event.survivors.forEach((survivor, idx) => {
      // NEW: récupérer les bonus individuels de cet aventurier
      const initiativeBonus = survivor.initiative_bonus || 0;
      const damageBonus = survivor.damage_bonus || 0;
      const baseInitiative = Math.floor((hashCode(survivor.id + event.attacker_id + (event.combat_id || event.turn || Date.now())) % 20) + 1);

      fighters.push({
        id: survivor.id,
        name: survivor.name,
        class: survivor.class,
        type: 'survivor',
        hp: survivor.hp,
        maxHp: survivor.max_hp || survivor.hp, // NEW: utilise max_hp pour la barre de vie
        initiative: baseInitiative + initiativeBonus, // NEW: + bonus d'initiative individuel
        damageBonus: damageBonus, // NEW: stocké sur le combattant pour le calcul des dégâts
        position: idx, // Position 0-3
        alive: true,
        currentAnimation: 'idle'
      });
    });
    
    // Ajouter les gobelins
    for (let i = 0; i < event.num_goblins; i++) {
      fighters.push({
        id: `goblin_${i}`,
        name: `Gobelin ${i + 1}`,
        class: 'Goblin',
        type: 'goblin',
        hp: event.goblin_hp,
        maxHp: event.goblin_hp,
        initiative: Math.floor((hashCode(`goblin_${i}` + event.attacker_id + (event.combat_id || event.turn || Date.now())) % 20) + 1),
        position: i, // Position 0-3
        alive: true,
        currentAnimation: 'idle'
      });
    }
    
    // Trier par initiative (du plus haut au plus bas)
    fighters.sort((a, b) => b.initiative - a.initiative);
    
    setCombatants(fighters);
    
    const initLog = [`⚔️ Combat commencé ! Ordre d'initiative :`];
    fighters.forEach(f => {
      initLog.push(`${f.name} (${f.initiative})`);
    });
    setCombatLog(initLog);
  }, [event]);

  // Écouter les événements de combat via WebSocket (TOUS les clients)
  useEffect(() => {
    if (!wsRef || !wsRef.current) return;

    const handleCombatUpdate = (data) => {
      if (data.type === 'combat_update') {
        // Mettre à jour les combattants
        setCombatants(data.combatants);
        
        // Mettre à jour l'animation
        if (data.animatingEntity) {
          setAnimatingEntity(data.animatingEntity);
          
          // Retour à idle après l'animation
          setTimeout(() => {
            setAnimatingEntity(null);
          }, data.animatingEntity.type === 'attack' ? 1000 : 600);
        }
        
        // Ajouter au log
        if (data.logEntry) {
          setCombatLog(prev => [...prev, data.logEntry]);
        }
      } else if (data.type === 'combat_over') {
        setCombatOver(true);
        setTimeout(() => {
          setCanClose(true);
        }, 2000);
      }
    };

    wsRef.current.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      handleCombatUpdate(data);
    });

    return () => {
      if (wsRef.current) {
        wsRef.current.removeEventListener('message', handleCombatUpdate);
      }
    };
  }, [wsRef]);

  // Simuler le combat (TOUS les clients, de manière déterministe)
  useEffect(() => {
    if (!shouldSimulate || combatants.length === 0) return;

    let mounted = true;
    let turnIndex = 0;
    let fighters = [...combatants];
    
    // Créer un générateur déterministe basé sur combat_id (inclut le tour)
    const combatSeed = hashCode(event.combat_id || (event.attacker_id + event.survivors.map(s => s.id).join('') + event.turn));
    const rng = new SeededRandom(combatSeed);
    
    // Chauffer le générateur pour éviter les patterns initiaux
    for (let i = 0; i < 10; i++) {
      rng.next();
    }

    const runCombat = async () => {
      while (mounted) {
        // Vérifier les conditions de victoire
        const aliveSurvivors = fighters.filter(f => f.type === 'survivor' && f.alive);
        const aliveGoblins = fighters.filter(f => f.type === 'goblin' && f.alive);
        
        if (aliveSurvivors.length === 0 || aliveGoblins.length === 0) {
          // Combat terminé
          setCombatOver(true);
          
          // Broadcaster la fin du combat à tous les clients
          
          // Préparer les résultats
          const survivorsResults = event.survivors.map(survivor => {
            const fighter = fighters.find(f => f.id === survivor.id);
            const damageDealt = survivor.hp - (fighter?.hp || 0);
            return {
              id: survivor.id,
              damage_dealt: Math.max(0, damageDealt),
              eliminated: !fighter || !fighter.alive
            };
          });
          
          const goblinsDefeated = event.num_goblins - aliveGoblins.length;
          
          // Seul le simulateur envoie les résultats au serveur
          if (isSimulator) {
            try {
              await axios.post(`${API}/game/${sessionId}/resolve_multiplayer_combat`, {
                attacker_id: event.attacker_id,
                survivors_results: survivorsResults,
                goblins_defeated: goblinsDefeated,
                combat_log: combatLog
              });
            } catch (error) {
              console.error("Erreur lors de la résolution du combat:", error);
            }
          }
          
          // TOUS les clients peuvent fermer après 2 secondes
          await new Promise(resolve => setTimeout(resolve, 2000));
          setCanClose(true);
          break;
        }
        
        // Tour du combattant actuel
        const attacker = fighters[turnIndex % fighters.length];
        
        // Passer si le combattant est mort
        if (!attacker.alive) {
          turnIndex++;
          continue;
        }
        
        // Trouver une cible aléatoire dans le camp opposé
        const targets = fighters.filter(f => 
          f.type !== attacker.type && f.alive
        );
        
        if (targets.length === 0) {
          turnIndex++;
          continue;
        }
        
        const target = targets[Math.floor(rng.next() * targets.length)];
        
        // Animation d'attaque - Broadcaster à tous les clients
        const attackAnim = { id: attacker.id, type: 'attack' };
        setAnimatingEntity(attackAnim);

        
        await new Promise(resolve => setTimeout(resolve, 1700)); // 30 frames × 50ms + 200ms buffer
        
        // Calculer les dégâts
        const baseDamage = rng.nextInt(1, 6);
        // NEW: si l'attaquant est un aventurier, on ajoute son bonus de dégâts individuel
        const bonusDamage = (attacker.type === 'survivor' && attacker.damageBonus) ? attacker.damageBonus : 0;
        const damage = baseDamage + bonusDamage;
        target.hp = Math.max(0, target.hp - damage);
        
        if (target.hp <= 0) {
          target.alive = false;
        }
        
        // Afficher l'indicateur de dégâts
        setDamageIndicators(prev => ({
          ...prev,
          [target.id]: { damage: damage, timestamp: Date.now() }
        }));
        
        // Faire disparaître l'indicateur après 1.5 secondes
        setTimeout(() => {
          setDamageIndicators(prev => {
            const newIndicators = { ...prev };
            delete newIndicators[target.id];
            return newIndicators;
          });
        }, 1500);
        
        // Animation de blessure sur la cible - Broadcaster à tous les clients
        const hurtAnim = { id: target.id, type: 'hurt' };
        setAnimatingEntity(hurtAnim);

        
await new Promise(resolve => setTimeout(resolve, 1000)); // 10 frames × 80ms + 200ms buffer
        
        // Retour à idle
        setAnimatingEntity(null);
        
        // Log de l'action
        const logEntry = `${attacker.name} attaque ${target.name} : ${damage} dégâts ! (${target.hp}/${target.maxHp} HP)`;
        setCombatLog(prev => [...prev, logEntry]);
        
        // Broadcaster le log et les HP mis à jour

        
        // Mettre à jour l'état
        setCombatants([...fighters]);
        
        // Attendre avant le prochain tour (augmenté pour mieux voir les animations)
        await new Promise(resolve => setTimeout(resolve, 1500)); // Augmenté à 1.5 secondes
        
        turnIndex++;
      }
    };

    runCombat();

    return () => {
      mounted = false;
    };
  }, [isSimulator, combatants.length, sessionId, event, wsRef]);

  // Fonction pour obtenir le sprite sheet approprié
  const getSpriteSheet = (combatant, animationType) => {
    if (combatant.type === 'goblin') {
      return `/fight/Goblin_${animationType}.webp`;
    } else {
      return `/fight/${combatant.class}_${animationType}.webp`;
    }
  };

  // Fonction pour obtenir les paramètres de sprite sheet (UNIFORMISÉS)
  const getSpriteParams = (combatant, animationType) => {
    // Paramètres uniformisés pour tous les personnages (gobelins et aventuriers)
    switch (animationType) {
      case 'idle':
        return { cols: 5, rows: 6, totalFrames: 30 };
      case 'attack':
        return { cols: 5, rows: 6, totalFrames: 30 };
      case 'hurt':
        return { cols: 5, rows: 2, totalFrames: 10 };
      case 'fainted':
        return { cols: 5, rows: 4, totalFrames: 20 };
      default:
        return { cols: 5, rows: 6, totalFrames: 30 };
    }
  };

  // Calculer les positions des combattants
  const getPosition = (combatant) => {
    const positions = [
      { bottom: '15%', top: 'auto' },
      { bottom: '35%', top: 'auto' },
      { bottom: '55%', top: 'auto' },
      { bottom: '75%', top: 'auto' }
    ];
    return positions[combatant.position] || positions[0];
  };

  return (
    <div
      className="game-over-overlay"
      style={{ zIndex: 3000, cursor: (canClose || combatOver) ? "pointer" : "default" }}
      onClick={() => (canClose || combatOver) && onClose && onClose()}
      data-testid="multiplayer-combat"
    >
      <div style={{
        position: 'relative',
        width: '90%',
        maxWidth: '1200px',
        height: '80vh',
        backgroundImage: 'url(/fight/Ground.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        borderRadius: '12px',
        border: '4px solid #d4af37',
        overflow: 'hidden'
      }}>
        {/* Aventuriers (à gauche) */}
        {combatants.filter(c => c.type === 'survivor').map((combatant, idx) => {
          const animationType = !combatant.alive 
            ? 'fainted' 
            : (animatingEntity?.id === combatant.id ? animatingEntity.type : 'idle');
          const spriteParams = getSpriteParams(combatant, animationType);
          
          return (
            <div
              key={combatant.id}
              style={{
                position: 'absolute',
                left: animatingEntity?.id === combatant.id && animatingEntity.type === 'attack' ? '30%' : '10%',
                ...getPosition(combatant),
                opacity: combatant.alive ? 1 : 0.3,
                transition: 'all 0.4s ease-out'
              }}
            >
              <SpriteSheetAnimator
                spriteSheet={getSpriteSheet(combatant, animationType)}
                frameWidth={200}
                frameHeight={115}
                cols={spriteParams.cols}
                rows={spriteParams.rows}
                totalFrames={spriteParams.totalFrames}
                frameDuration={animationType === 'attack' ? 33 : animationType === 'hurt' ? 80 : animationType === 'fainted' ? 100 : 100}
                loop={animationType === 'idle'}
              />
              
              {/* Indicateur de dégâts */}
              {damageIndicators[combatant.id] && (
                <div style={{
                  position: 'absolute',
                  top: '-30px',
                  left: '50%',
                  transform: 'translateX(-50%) scaleX(-1)',
                  fontSize: '28px',
                  fontWeight: 'bold',
                  color: '#ff0000',
                  textShadow: '2px 2px 4px #000, -1px -1px 2px #fff',
                  animation: 'floatUp 1.5s ease-out',
                  pointerEvents: 'none',
                  zIndex: 1000
                }}>
                  -{damageIndicators[combatant.id].damage}
                </div>
              )}
              
              {/* Barre de vie */}
              <div style={{
                width: '200px',
                height: '12px',
                backgroundColor: '#333',
                borderRadius: '6px',
                overflow: 'hidden',
                marginTop: '5px',
                border: '2px solid #d4af37'
              }}>
                <div style={{
                  width: `${(combatant.hp / combatant.maxHp) * 100}%`,
                  height: '100%',
                  backgroundColor: combatant.hp > combatant.maxHp * 0.3 ? '#10b981' : '#ef4444',
                  transition: 'width 0.3s'
                }} />
              </div>
              <div style={{ color: '#fff', textAlign: 'center', fontSize: '14px', fontWeight: 'bold', textShadow: '2px 2px 4px #000' }}>
                {combatant.name} ({combatant.hp}/{combatant.maxHp})
              </div>
            </div>
          );
        })}

        {/* Gobelins (à droite) */}
        {combatants.filter(c => c.type === 'goblin').map((combatant, idx) => {
          const animationType = !combatant.alive 
            ? 'fainted' 
            : (animatingEntity?.id === combatant.id ? animatingEntity.type : 'idle');
          const spriteParams = getSpriteParams(combatant, animationType);
          
          return (
            <div
              key={combatant.id}
              style={{
                position: 'absolute',
                right: animatingEntity?.id === combatant.id && animatingEntity.type === 'attack' ? '30%' : '10%',
                ...getPosition(combatant),
                opacity: combatant.alive ? 1 : 0.3,
                transition: 'all 0.4s ease-out',
                transform: 'scaleX(-1)' // Miroir pour faire face aux aventuriers
              }}
            >
              <SpriteSheetAnimator
                spriteSheet={getSpriteSheet(combatant, animationType)}
                frameWidth={200}
                frameHeight={115}
                cols={spriteParams.cols}
                rows={spriteParams.rows}
                totalFrames={spriteParams.totalFrames}
                frameDuration={animationType === 'attack' ? 50 : animationType === 'hurt' ? 80 : animationType === 'fainted' ? 100 : 100}
                loop={animationType === 'idle'}
              />
              
              {/* Indicateur de dégâts */}
              {damageIndicators[combatant.id] && (
                <div style={{
                  position: 'absolute',
                  top: '-30px',
                  left: '50%',
                  transform: 'translateX(-50%) scaleX(-1)',
                  fontSize: '28px',
                  fontWeight: 'bold',
                  color: '#ff0000',
                  textShadow: '2px 2px 4px #000, -1px -1px 2px #fff',
                  animation: 'floatUpMirrored 1.5s ease-out',
                  pointerEvents: 'none',
                  zIndex: 1000
                }}>
                  -{damageIndicators[combatant.id].damage}
                </div>
              )}
              
              {/* Barre de vie */}
              <div style={{
                width: '200px',
                height: '12px',
                backgroundColor: '#333',
                borderRadius: '6px',
                overflow: 'hidden',
                marginTop: '5px',
                border: '2px solid #d4af37',
                transform: 'scaleX(-1)' // Re-miroir pour la barre de vie
              }}>
                <div style={{
                  width: `${(combatant.hp / combatant.maxHp) * 100}%`,
                  height: '100%',
                  backgroundColor: combatant.hp > combatant.maxHp * 0.3 ? '#ef4444' : '#991b1b',
                  transition: 'width 0.3s'
                }} />
              </div>
              <div style={{ 
                color: '#fff', 
                textAlign: 'center', 
                fontSize: '14px', 
                fontWeight: 'bold', 
                textShadow: '2px 2px 4px #000',
                transform: 'scaleX(-1)' // Re-miroir pour le texte
              }}>
                {combatant.name} ({combatant.hp}/{combatant.maxHp})
              </div>
            </div>
          );
        })}

        {/* Combat Log */}
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '80%',
          maxHeight: '150px',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          borderRadius: '8px',
          padding: '10px',
          overflowY: 'auto',
          border: '2px solid #d4af37'
        }}>
          {combatLog.map((entry, idx) => (
            <div key={idx} style={{ color: '#e8dcc4', fontSize: '12px', marginBottom: '3px' }}>
              {entry}
            </div>
          ))}
        </div>

        {/* Message de fin */}
        {combatOver && (
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            padding: '20px 40px',
            borderRadius: '12px',
            border: '3px solid #d4af37'
          }}>
            <div style={{ color: '#d4af37', fontSize: '24px', fontWeight: 'bold', textAlign: 'center' }}>
              ⚔️ COMBAT TERMINÉ !
            </div>
          </div>
        )}

        {(canClose || combatOver) && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#d4af37',
            fontSize: '18px',
            fontWeight: 'bold',
            textAlign: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: '15px 30px',
            borderRadius: '8px',
            border: '2px solid #d4af37',
            cursor: 'pointer'
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (onClose) onClose();
          }}
          >
            {canClose ? 'Cliquez pour fermer' : 'Combat terminé - Cliquez pour fermer'}
          </div>
        )}
      </div>
    </div>
  );
};

// ========== INVENTORY HUD COMPONENT ==========
const InventoryHUD = ({ player, onClick }) => {
  if (!player || player.role !== "survivor") return null;
  
  const inventory = player.inventory || [];
  const filledSlots = inventory.filter(slot => slot !== null).length;
  
  return (
    <button
      onClick={onClick}
      data-testid="inventory-hud-button"
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        backgroundColor: 'rgba(42, 31, 23, 0.95)',
        border: '2px solid #d4af37',
        borderRadius: '8px',
        padding: '12px 20px',
        color: '#d4af37',
        fontSize: '18px',
        fontWeight: 'bold',
        cursor: 'pointer',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'all 0.2s ease',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)'
      }}
      onMouseEnter={(e) => {
        e.target.style.backgroundColor = 'rgba(52, 41, 33, 0.95)';
        e.target.style.transform = 'scale(1.05)';
      }}
      onMouseLeave={(e) => {
        e.target.style.backgroundColor = 'rgba(42, 31, 23, 0.95)';
        e.target.style.transform = 'scale(1)';
      }}
    >
      🎒 {filledSlots}/9
    </button>
  );
};

// ========== STATS HUD BUTTON COMPONENT ==========
const StatsHUD = ({ player, onClick }) => {
  if (!player || player.role !== "survivor") return null;
  
  return (
    <button
      onClick={onClick}
      data-testid="stats-hud-button"
      style={{
        position: 'fixed',
        top: '80px',  // En dessous de l'inventaire
        right: '20px',
        backgroundColor: 'rgba(42, 31, 23, 0.95)',
        border: '2px solid #d4af37',
        borderRadius: '8px',
        padding: '12px 20px',
        color: '#d4af37',
        fontSize: '18px',
        fontWeight: 'bold',
        cursor: 'pointer',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'all 0.2s ease',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)'
      }}
      onMouseEnter={(e) => {
        e.target.style.backgroundColor = 'rgba(52, 41, 33, 0.95)';
        e.target.style.transform = 'scale(1.05)';
      }}
      onMouseLeave={(e) => {
        e.target.style.backgroundColor = 'rgba(42, 31, 23, 0.95)';
        e.target.style.transform = 'scale(1)';
      }}
    >
      ⚔️ Stats
    </button>
  );
};

// ========== STATS MODAL COMPONENT ==========
const StatsModal = ({ player, onClose }) => {
  if (!player || player.role !== "survivor") return null;
  
  // Calculer les bonus des runes
  const inventory = player.inventory || [];
  let damageBonus = 0;
  let healthBonus = 0;
  let initiativeBonus = 0;
  
  inventory.forEach(item => {
    if (item && item.type === 'rune_dommage') damageBonus += 2;
    if (item && item.type === 'rune_vitalite') healthBonus += 8;
    if (item && item.type === 'rune_initiative') initiativeBonus += 3;
  });

  // NEW: include forged bonuses (persistent on the weapon)
  damageBonus += player.damage_bonus || 0;
  initiativeBonus += player.initiative_bonus || 0;
  healthBonus += Math.max(0, (player.max_hp || 36) - 36);
  
  // Stats de base
  const baseDamage = 3;  // 1d6 = moyenne 3.5 ≈ 3
  const baseHealth = 36;
  const baseInitiative = 10;  // 1d20 = moyenne 10.5 ≈ 10
  
  // Stats totales
  const totalDamage = `1d6 ${damageBonus > 0 ? `+${damageBonus}` : ''}`;
  const totalHealth = baseHealth + healthBonus;
  const totalInitiative = `1d20 ${initiativeBonus > 0 ? `+${initiativeBonus}` : ''}`;
  
  // HP actuels
  const currentHP = player.hp || baseHealth;
  const maxHP = totalHealth;
  
  return (
    <div
      className="game-over-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
      }}
      onClick={onClose}
      data-testid="stats-modal-overlay"
    >
      <Card
        style={{
          maxWidth: '500px',
          width: '90%',
          backgroundColor: '#2a1f17',
          borderColor: '#d4af37',
          border: '3px solid #d4af37',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader>
          <CardTitle style={{ color: '#d4af37', textAlign: 'center', fontSize: '1.8rem' }}>
            ⚔️ Caractéristiques
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Nom et classe */}
          <div style={{ 
            textAlign: 'center', 
            marginBottom: '24px',
            paddingBottom: '16px',
            borderBottom: '2px solid rgba(212, 175, 55, 0.3)'
          }}>
            <h3 style={{ color: '#e8dcc4', fontSize: '1.4rem', marginBottom: '8px' }}>
              {player.name}
            </h3>
            <p style={{ color: '#b8956a', fontSize: '1.1rem' }}>
              {player.character_class}
            </p>
          </div>
          
          {/* Stats */}
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '16px',
            marginBottom: '24px'
          }}>
            {/* Vitalité */}
            <div style={{ 
              backgroundColor: 'rgba(0, 0, 0, 0.3)', 
              padding: '16px', 
              borderRadius: '8px',
              border: '1px solid rgba(212, 175, 55, 0.2)'
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '8px'
              }}>
                <span style={{ color: '#d4af37', fontSize: '1.1rem', fontWeight: 'bold' }}>
                  ❤️ Vitalité
                </span>
                <span style={{ color: '#e8dcc4', fontSize: '1.2rem', fontWeight: 'bold' }}>
                  {currentHP}/{maxHP}
                </span>
              </div>
              {healthBonus > 0 && (
                <div style={{ color: '#10b981', fontSize: '0.9rem' }}>
                  +{healthBonus} PV (Runes de vitalité)
                </div>
              )}
            </div>
            
            {/* Dégâts */}
            <div style={{ 
              backgroundColor: 'rgba(0, 0, 0, 0.3)', 
              padding: '16px', 
              borderRadius: '8px',
              border: '1px solid rgba(212, 175, 55, 0.2)'
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '8px'
              }}>
                <span style={{ color: '#d4af37', fontSize: '1.1rem', fontWeight: 'bold' }}>
                  ⚔️ Dégâts de base
                </span>
                <span style={{ color: '#e8dcc4', fontSize: '1.2rem', fontWeight: 'bold' }}>
                  {totalDamage}
                </span>
              </div>
              {damageBonus > 0 && (
                <div style={{ color: '#10b981', fontSize: '0.9rem' }}>
                  +{damageBonus} dégâts (Runes de dommage)
                </div>
              )}
            </div>
            
            {/* Initiative */}
            <div style={{ 
              backgroundColor: 'rgba(0, 0, 0, 0.3)', 
              padding: '16px', 
              borderRadius: '8px',
              border: '1px solid rgba(212, 175, 55, 0.2)'
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '8px'
              }}>
                <span style={{ color: '#d4af37', fontSize: '1.1rem', fontWeight: 'bold' }}>
                  ⚡ Initiative
                </span>
                <span style={{ color: '#e8dcc4', fontSize: '1.2rem', fontWeight: 'bold' }}>
                  {totalInitiative}
                </span>
              </div>
              {initiativeBonus > 0 && (
                <div style={{ color: '#10b981', fontSize: '0.9rem' }}>
                  +{initiativeBonus} initiative (Runes d'initiative)
                </div>
              )}
            </div>
            
            {/* Or */}
            <div style={{ 
              backgroundColor: 'rgba(0, 0, 0, 0.3)', 
              padding: '16px', 
              borderRadius: '8px',
              border: '1px solid rgba(212, 175, 55, 0.2)'
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center'
              }}>
                <span style={{ color: '#d4af37', fontSize: '1.1rem', fontWeight: 'bold' }}>
                  💰 Or
                </span>
                <span style={{ color: '#e8dcc4', fontSize: '1.2rem', fontWeight: 'bold' }}>
                  {player.gold || 0}
                </span>
              </div>
            </div>
          </div>
          
          {/* Bouton fermer */}
          <button
            onClick={onClose}
            data-testid="stats-modal-close"
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: '#d4af37',
              border: 'none',
              borderRadius: '8px',
              color: '#1a1410',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = '#c9a033';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = '#d4af37';
            }}
          >
            Fermer
          </button>
        </CardContent>
      </Card>
    </div>
  );
};

// ========== INVENTORY MODAL COMPONENT ==========
const InventoryModal = ({ player, onClose, sessionId }) => {
  const [deleteMode, setDeleteMode] = useState(false);
  const [pendingDeleteSlot, setPendingDeleteSlot] = useState(null); // {index, item}

  if (!player || player.role !== "survivor") return null;

  const inventory = player.inventory || [];

  const resetDeleteState = () => {
    setDeleteMode(false);
    setPendingDeleteSlot(null);
  };

  const handleClose = () => {
    resetDeleteState();
    onClose();
  };

  const handleSlotClick = async (index, item) => {
    if (!item) return;

    // If in delete mode, select this item for confirmation
    if (deleteMode) {
      setPendingDeleteSlot({ index, item });
      return;
    }

    const itemType = item.type;

    // Only medikit and antidote can be used directly
    if (itemType === 'medikit' || itemType === 'antidote') {
      try {
        const response = await axios.post(`${API}/game/${sessionId}/use_item`, {
          player_id: player.id,
          slot_index: index
        });

        if (response.data.status === 'success') {
          toast.success(response.data.message);
        }
      } catch (error) {
        const errorMsg = error.response?.data?.detail || "Erreur lors de l'utilisation de l'item";
        toast.error(errorMsg);
      }
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteSlot) return;

    try {
      const response = await axios.post(`${API}/game/${sessionId}/delete_item`, {
        player_id: player.id,
        slot_index: pendingDeleteSlot.index
      });

      if (response.data.status === 'success') {
        toast.success(response.data.message);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.detail || "Erreur lors de la suppression de l'item";
      toast.error(errorMsg);
    } finally {
      resetDeleteState();
    }
  };

  const handleCancelDelete = () => {
    // Cancel only the current selection but stay in delete mode
    setPendingDeleteSlot(null);
  };

  const handleToggleDeleteMode = () => {
    if (deleteMode) {
      resetDeleteState();
    } else {
      setDeleteMode(true);
      setPendingDeleteSlot(null);
    }
  };

  return (
    <div
      className="game-over-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: 'min(90vw, 90vh, 600px)',
          aspectRatio: '1 / 1',
          backgroundImage: 'url(/inventory/grid_background.png)',
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
        }}
      >
        {/* Top action buttons */}
        <button
          onClick={handleToggleDeleteMode}
          data-testid="inventory-delete-toggle-btn"
          style={{
            position: 'absolute',
            top: '-50px',
            right: '130px',
            backgroundColor: deleteMode ? '#dc2626' : '#b91c1c',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 20px',
            color: '#fff',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: deleteMode ? '0 0 0 2px #fca5a5 inset' : 'none',
          }}
        >
          {deleteMode ? '✖ Annuler' : '🗑 Supprimer'}
        </button>

        {/* Close button */}
        <button
          onClick={handleClose}
          data-testid="inventory-close-btn"
          style={{
            position: 'absolute',
            top: '-50px',
            right: '0',
            backgroundColor: '#d4af37',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 20px',
            color: '#2a1f17',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          ✕ Fermer
        </button>

        {/* Inventory slots */}
        {SLOT_POSITIONS.map((position, index) => {
          const item = inventory[index];
          const isHighlighted = deleteMode && item;
          const isSelectedForDeletion = pendingDeleteSlot && pendingDeleteSlot.index === index;
          return (
            <div
              key={index}
              className="inventory-slot"
              data-testid={`inventory-slot-${index}`}
              onClick={() => handleSlotClick(index, item)}
              style={{
                position: 'absolute',
                left: position.left,
                top: position.top,
                width: `${SLOT_SIZE_PCT}%`,
                height: `${SLOT_SIZE_PCT}%`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: item ? 'pointer' : 'default',
                outline: isSelectedForDeletion
                  ? '3px solid #fbbf24'
                  : (isHighlighted ? '2px dashed #fca5a5' : 'none'),
                outlineOffset: '-2px',
                borderRadius: '8px',
                animation: isHighlighted && !isSelectedForDeletion ? 'pulse 1.2s ease-in-out infinite' : 'none',
              }}
              title={item ? ITEM_NAMES[item.type] || item.type : ''}
            >
              {item && (
                <img
                  src={ITEM_SPRITES[item.type] || '/inventory/placeholder.png'}
                  alt={ITEM_NAMES[item.type] || item.type}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5))',
                    pointerEvents: 'none',
                  }}
                />              )}
            </div>
          );
        })}

        {/* Delete mode hint / confirmation panel under the inventory */}
        {deleteMode && (
          <div
            data-testid="inventory-delete-panel"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: 'calc(100% + 16px)',
              left: '50%',
              transform: 'translateX(-50%)',
              minWidth: '320px',
              maxWidth: '90vw',
              backgroundColor: 'rgba(20, 14, 10, 0.95)',
              border: '2px solid #d4af37',
              borderRadius: '12px',
              padding: '14px 20px',
              color: '#f5e6c8',
              textAlign: 'center',
              boxShadow: '0 6px 18px rgba(0,0,0,0.6)',
            }}
          >
            {!pendingDeleteSlot ? (
              <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                🗑 Cliquez sur l'objet à supprimer
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <img
                    src={ITEM_SPRITES[pendingDeleteSlot.item.type] || '/inventory/placeholder.png'}
                    alt={ITEM_NAMES[pendingDeleteSlot.item.type] || pendingDeleteSlot.item.type}
                    style={{
                      width: '48px',
                      height: '48px',
                      objectFit: 'contain',
                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                    }}
                  />
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                    Supprimer {ITEM_NAMES[pendingDeleteSlot.item.type] || pendingDeleteSlot.item.type} ?
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                  <button
                    onClick={handleConfirmDelete}
                    data-testid="inventory-delete-confirm-yes"
                    style={{
                      backgroundColor: '#dc2626',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '8px 22px',
                      color: '#fff',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                    }}
                  >
                    Oui
                  </button>
                  <button
                    onClick={handleCancelDelete}
                    data-testid="inventory-delete-confirm-no"
                    style={{
                      backgroundColor: '#374151',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '8px 22px',
                      color: '#fff',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                    }}
                  >
                    Non
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ========== RUNE PICKUP MODAL COMPONENT ==========
const RunePickupModal = ({ event, playerId, sessionId }) => {
  if (!event || event.type !== 'rune_found') return null;
  
  const runeType = event.rune_type;
  const inventoryFull = event.inventory_full;
  
  const handlePickup = async () => {
    try {
      const response = await axios.post(`${API}/game/${sessionId}/pickup_rune`, {
        player_id: playerId,
        rune_type: runeType
      });
      
      if (response.data.status === 'success') {
        toast.success(`✨ ${ITEM_NAMES[runeType]} ajoutée à l'inventaire !`);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.detail || "Erreur lors du ramassage";
      if (errorMsg === "Inventaire plein") {
        toast.error("❌ Inventaire plein !");
      } else {
        toast.error(errorMsg);
      }
    }
  };
  
  const handleDismiss = async () => {
    try {
      await axios.post(`${API}/game/${sessionId}/dismiss_rune`, {
        player_id: playerId
      });
    } catch (error) {
      console.error("Error dismissing rune:", error);
    }
  };
  
  return (
    <div
      className="game-over-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
      }}
    >
      <Card
        style={{
          maxWidth: '500px',
          backgroundColor: '#2a1f17',
          borderColor: '#d4af37',
          border: '3px solid #d4af37',
        }}
      >
        <CardHeader>
          <CardTitle style={{ color: '#d4af37', textAlign: 'center', fontSize: '1.8rem' }}>
            ✨ Vous avez trouvé une rune !
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <img
              src={ITEM_SPRITES[runeType]}
              alt={ITEM_NAMES[runeType]}
              style={{
                width: '150px',
                height: '150px',
                objectFit: 'contain',
                margin: '0 auto',
                filter: 'drop-shadow(0 4px 8px rgba(212, 175, 55, 0.5))',
              }}
            />
            <h3 style={{ color: '#e8dcc4', marginTop: '16px', fontSize: '1.4rem' }}>
              {ITEM_NAMES[runeType]}
            </h3>
          </div>
          
          {inventoryFull && (
            <div style={{
              backgroundColor: 'rgba(239, 68, 68, 0.2)',
              border: '2px solid #ef4444',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px',
              color: '#ef4444',
              textAlign: 'center',
              fontWeight: 'bold'
            }}>
              ⚠️ Inventaire plein !
            </div>
          )}
          
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <Button
              onClick={handlePickup}
              disabled={inventoryFull}
              style={{
                backgroundColor: inventoryFull ? '#666' : '#10b981',
                color: '#fff',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: inventoryFull ? 'not-allowed' : 'pointer',
              }}
            >
              🎒 Ramasser
            </Button>
            <Button
              onClick={handleDismiss}
              style={{
                backgroundColor: '#ef4444',
                color: '#fff',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: 'bold',
              }}
            >
              ❌ Ignorer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
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
                    alt="Aventurier" 
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
                    alt="Orc" 
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
                            
                            // PATROUILLE: Highlight selected room in red, other rooms on same floor in orange
                            let highlightStyle = {};
                            if (actionType === "select_room" && selectedPower === "patrouille" && tempRoomSelections.length > 0) {
                              if (tempRoomSelections[0] === roomName) {
                                // Selected room: red border
                                highlightStyle = { border: '3px solid #ef4444', boxShadow: '0 0 15px rgba(239, 68, 68, 0.8)' };
                              } else if (roomData.floor === gameState.rooms[tempRoomSelections[0]]?.floor) {
                                // Same floor: orange border
                                highlightStyle = { border: '3px solid #f97316', boxShadow: '0 0 15px rgba(249, 115, 22, 0.6)' };
                              }
                            }
                            
                            return (
                              <button
                                key={roomName}
                                data-room-name={roomName}
                                className={`room-mini-btn ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''}`}
                                onClick={() => !isLocked && handleRoomSelection(roomName)}
                                disabled={isLocked}
                                style={highlightStyle}
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
// ========== FORGE BAR ANIMATION COMPONENT ==========
const ForgeBar = ({ successRate, onAnimationComplete }) => {
  const [cursorPos, setCursorPos] = useState(0);
  const [animating, setAnimating] = useState(true);
  const animationRef = useRef(null);
  const startTimeRef = useRef(performance.now());
  
  useEffect(() => {
    const ANIMATION_DURATION = 3500; // 3.5 secondes
    const FAST_PHASE = 2000; // 2 sec rapide
    const SLOW_PHASE = 1500; // 1.5 sec ralentissement
    
    const animate = (currentTime) => {
      const elapsed = currentTime - startTimeRef.current;
      
      if (elapsed < FAST_PHASE) {
        // Phase rapide: le curseur va de 0 à 100 plusieurs fois
        const speed = 0.3; // vitesse en %/ms
        const pos = (elapsed * speed) % 100;
        setCursorPos(pos);
        animationRef.current = requestAnimationFrame(animate);
      } else if (elapsed < ANIMATION_DURATION) {
        // Phase de ralentissement
        const slowPhaseProgress = (elapsed - FAST_PHASE) / SLOW_PHASE;
        const easeOut = 1 - Math.pow(1 - slowPhaseProgress, 3); // Cubic ease-out
        
        // Position finale basée sur le taux de succès avec un peu de variance
        const targetPos = successRate - 5 + (Math.random() * 10); // ±5% de variance
        const finalPos = Math.max(0, Math.min(100, targetPos));
        
        // Interpolation vers la position finale
        const lastFastPos = ((FAST_PHASE * 0.3) % 100);
        const pos = lastFastPos + (finalPos - lastFastPos) * easeOut;
        
        setCursorPos(pos);
        animationRef.current = requestAnimationFrame(animate);
      } else {
        // Animation terminée
        const finalPos = successRate - 3 + (Math.random() * 6);
        setCursorPos(Math.max(0, Math.min(100, finalPos)));
        setAnimating(false);
        
        // Attendre un peu avant de notifier
        setTimeout(() => {
          if (onAnimationComplete) {
            onAnimationComplete();
          }
        }, 500);
      }
    };
    
    animationRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [successRate, onAnimationComplete]);
  
  return (
    <div style={{
      width: '100%',
      marginTop: '30px',
      marginBottom: '20px'
    }}>
      {/* Titre */}
      <div style={{
        textAlign: 'center',
        color: '#d4af37',
        fontSize: '18px',
        fontWeight: 'bold',
        marginBottom: '15px',
        animation: animating ? 'pulse 1s infinite' : 'none'
      }}>
        {animating ? '⚒️ Forge en cours...' : '✨ Forge terminée !'}
      </div>
      
      {/* Barre de progression */}
      <div style={{
        position: 'relative',
        width: '100%',
        height: '50px',
        backgroundColor: '#1a1410',
        border: '3px solid #d4af37',
        borderRadius: '10px',
        overflow: 'hidden',
        boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.8)'
      }}>
        {/* Zone de succès (verte) */}
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${successRate}%`,
          height: '100%',
          background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
          transition: 'width 0.3s ease'
        }}>
          <div style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 'bold',
            textShadow: '1px 1px 3px rgba(0,0,0,0.8)'
          }}>
            ✓ SUCCÈS
          </div>
        </div>
        
        {/* Zone d'échec (rouge) */}
        <div style={{
          position: 'absolute',
          left: `${successRate}%`,
          top: 0,
          width: `${100 - successRate}%`,
          height: '100%',
          background: 'linear-gradient(90deg, #dc2626 0%, #991b1b 100%)'
        }}>
          <div style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 'bold',
            textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
            whiteSpace: 'nowrap'
          }}>
            ✗ ÉCHEC
          </div>
        </div>
        
        {/* Curseur */}
        <div style={{
          position: 'absolute',
          left: `${cursorPos}%`,
          top: '-10px',
          bottom: '-10px',
          width: '4px',
          backgroundColor: '#fff',
          boxShadow: '0 0 20px rgba(255,255,255,0.8), 0 0 40px rgba(212,175,55,0.6)',
          transform: 'translateX(-50%)',
          transition: animating ? 'none' : 'left 0.3s ease',
          zIndex: 10
        }}>
          {/* Flèche du curseur */}
          <div style={{
            position: 'absolute',
            top: '-15px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderTop: '12px solid #fff',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
          }} />
          <div style={{
            position: 'absolute',
            bottom: '-15px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderBottom: '12px solid #fff',
            filter: 'drop-shadow(0 -2px 4px rgba(0,0,0,0.5))'
          }} />
        </div>
      </div>
      
      {/* Légende */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: '10px',
        fontSize: '12px',
        color: '#b8956a'
      }}>
        <span>0%</span>
        <span style={{ color: '#d4af37', fontWeight: 'bold' }}>
          Chance de réussite : {successRate}%
        </span>
        <span>100%</span>
      </div>
    </div>
  );
};

const Game = () => {
  const { sessionId } = useParams();
  const [gameState, setGameState] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [hasSelectedRoom, setHasSelectedRoom] = useState(false);
  const [showRoleNotification, setShowRoleNotification] = useState(false); // NEW: role notification
  const [assignedRole, setAssignedRole] = useState(null); // NEW: assigned role

  // NEW: Goblin combat popup states
  const [showGoblinCombat, setShowGoblinCombat] = useState(false);
  const [goblinCombatEvent, setGoblinCombatEvent] = useState(null);
  const [showMultiplayerCombat, setShowMultiplayerCombat] = useState(false);
  const [multiplayerCombatEvent, setMultiplayerCombatEvent] = useState(null);

  // NEW: Flashing rooms when teammates select
const [flashingRooms, setFlashingRooms] = useState(new Set());
const prevPendingActionsRef = useRef('{}');

  // NEW: Discovered rooms animation (fog of war)
  const [discoveredRoomsAnimation, setDiscoveredRoomsAnimation] = useState(new Set());
  
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

  // NEW: Forge popup + interface state
  const [showForgePopup, setShowForgePopup] = useState(false);
  const [forgeVideoPath, setForgeVideoPath] = useState("");
  const [showForgeInterface, setShowForgeInterface] = useState(false);
  const [forgeAnimation, setForgeAnimation] = useState(null); // null | "forging" | "success" | "failure"
  const [forgeBusy, setForgeBusy] = useState(false);
  const [forgeFlashLabel, setForgeFlashLabel] = useState("");
  const [forgePendingResult, setForgePendingResult] = useState(null); // response cached during "forging"
  
  // Animation de la barre de forge
  const [forgeBarAnimation, setForgeBarAnimation] = useState(false);
  const [forgeBarCursorPosition, setForgeBarCursorPosition] = useState(0);
  
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

  // NEW: Patrouille popup state
  const [showPatrouillePopup, setShowPatrouillePopup] = useState(false);
  const [patrouilleMessage, setPatrouilleMessage] = useState("");
  const [patrouilleVideoPath, setPatrouilleVideoPath] = useState("");

  // NEW: Active traps section state
  const [expandedTrap, setExpandedTrap] = useState(null);

  // NEW: Turn announcement popups (flashing)
  const [showAdventurerTurnPopup, setShowAdventurerTurnPopup] = useState(false);
  const [showOrcSearchPopup, setShowOrcSearchPopup] = useState(false);

  // NEW: Room selection with confirmation - preSelectedRoom is the room clicked once, selectedRoom is confirmed
  const [preSelectedRoom, setPreSelectedRoom] = useState(null);

  // NEW: Inventory system states
  const [showInventory, setShowInventory] = useState(false);

  // NEW: Character stats modal state
  const [showStats, setShowStats] = useState(false);

  const ws = useRef(null);
  const eventsEndRef = useRef(null);
  const hasShownRoleNotification = useRef(false);
  const lastShownAdventurerTurn = useRef(0); // Track last turn where adventurer popup was shown // Track if role notification was shown

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

        // Gérer l'événement de combat
        if (data.type === "state_update" && data.game) {
          const pendingEvents = data.game.pending_events || {};

          if (pendingEvents[storedPlayerId]) {
            const event = pendingEvents[storedPlayerId];
            
            if (event.type === "goblin_combat") {
              setGoblinCombatEvent(event);
              setShowGoblinCombat(true);
            } else if (event.type === "multiplayer_combat") {
              setMultiplayerCombatEvent(event);
              setShowMultiplayerCombat(true);
            }
          }
        }
        
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

        // NEW: Show adventurer turn popup when game started and it's survivor_selection phase
        if (data.game.game_started && 
            data.game.phase === "survivor_selection" &&
            storedPlayerId in data.game.players) {
          const currentPlayer = data.game.players[storedPlayerId];
          const currentTurn = data.game.turn || 1;
          
          if (currentPlayer.role === "survivor" && 
              !currentPlayer.eliminated &&
              lastShownAdventurerTurn.current < currentTurn) {
            lastShownAdventurerTurn.current = currentTurn;
            setShowAdventurerTurnPopup(true);
            setTimeout(() => {
              setShowAdventurerTurnPopup(false);
            }, 3000);
          }
        }
      } else if (data.type === "trapped_notification") {
        // NEW: Show trap popup for survivor who entered trapped room with video
        setTrapVideoPath(data.video_path || "");
        setShowTrapPopup(true);
        // Auto-hide after 5 seconds
        setTimeout(() => {
          setShowTrapPopup(false);
  notifyEventCompleted();
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
  notifyEventCompleted();
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
  notifyEventCompleted();
}, 7000);
      } else if (data.type === "teleportation_notification") {
        // NEW: Show teleportation popup for survivor who entered teleportation trap with video
        setTeleportationVideoPath(data.video_path || "");
        setTeleportationMessage(data.message);
        setShowTeleportationPopup(true);
        // Auto-hide after 5 seconds
        setTimeout(() => {
          setShowTeleportationPopup(false);
  notifyEventCompleted();
}, 5000);
      } else if (data.type === "merchant_encounter") {
        // NEW: Show merchant popup for survivor who encountered the merchant
        setMerchantVideoPath(data.video_path || "");
        setShowMerchantPopup(true);
      } else if (data.type === "forge_encounter") {
        // NEW: Show forge intro popup for survivor who found the forge
        setForgeVideoPath(data.video_path || "/event/Forge.mp4");
        setShowForgePopup(true);
      } else if (data.type === "room_discovered") {
        // NEW: Show room discovery animation
        const roomName = data.room_name;
        toast.success(data.message, {
          duration: 4000,
          icon: '✨',
        });
        
        // Ajouter l'animation de découverte
        setDiscoveredRoomsAnimation(prev => new Set([...prev, roomName]));
        
        // Retirer l'animation après 2 secondes
        setTimeout(() => {
          setDiscoveredRoomsAnimation(prev => {
            const newSet = new Set(prev);
            newSet.delete(roomName);
            return newSet;
          });
        }, 2000);
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
      } else if (data.type === "patrol_detected" || data.type === "patrol_found") {
        // Show Patrouille detection popup with video (for survivors)
        setPatrouilleMessage(data.message);
        setPatrouilleVideoPath(data.video_path);
        setShowPatrouillePopup(true);
        // Auto-hide after 6 seconds
        setTimeout(() => {
          setShowPatrouillePopup(false);
        }, 6000);
      } else if (data.type === "patrol_reveal") {
        // Killers get notified that a survivor has been revealed by the patrol goblin
        toast.info(`🔍 ${data.player_name} a été repéré par le gobelin de Patrouille dans ${data.room} !`, {
          duration: 5000
        });
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
    setPreSelectedRoom(null); // Reset pre-selection
    setSelectedPower(null);
    setPowerActionData(null);
    setShowPowerAction(false);
    setFlashingRooms(new Set());
    prevPendingActionsRef.current = '{}';
    toast.info(data.message);
    
    // NEW: Show adventurer turn popup if survivor_selection phase
    if (data.phase === "survivor_selection" && data.game) {
      const currentPlayer = data.game.players?.[storedPlayerId];
      const currentTurn = data.game.turn || 1;
      
      if (currentPlayer && 
          currentPlayer.role === "survivor" && 
          !currentPlayer.eliminated &&
          lastShownAdventurerTurn.current < currentTurn) {
        lastShownAdventurerTurn.current = currentTurn;
        setShowAdventurerTurnPopup(true);
        setTimeout(() => { setShowAdventurerTurnPopup(false); }, 3000);
      }
    }
} else if (data.type === "phase_change") {
        setHasSelectedRoom(false);
        setSelectedRoom(null);
        setPreSelectedRoom(null); // Reset pre-selection
        setFlashingRooms(new Set());
    prevPendingActionsRef.current = '{}';
    
    // NEW: Show adventurer turn popup when entering survivor_selection phase
    if (data.phase === "survivor_selection") {
      const currentPlayer = gameState?.players?.[storedPlayerId];
      if (currentPlayer && currentPlayer.role === "survivor" && !currentPlayer.eliminated) {
        setShowAdventurerTurnPopup(true);
        // Auto-hide after 3 seconds
        setTimeout(() => {
          setShowAdventurerTurnPopup(false);
        }, 3000);
      }
    }
    
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
        }, 5000);
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
        toast.error("C'est le tour des aventuriers !");
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

    // NEW: Two-step selection - first click pre-selects, clicking again deselects
    if (preSelectedRoom === roomName) {
      // Clicking the same room again deselects it
      setPreSelectedRoom(null);
    } else {
      // Pre-select the room (visual feedback)
      setPreSelectedRoom(roomName);
    }
  };

  // NEW: Confirm room selection function
  
  // NEW: Notify server that an event popup has been closed
  const notifyEventCompleted = () => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({    // <-- ws.current.send, pas ws.send
        type: "event_completed",
        player_id: playerId
      }));
    }
  };

  const confirmRoomSelection = () => {
    if (!preSelectedRoom || hasSelectedRoom || !gameState) return;

    const currentPlayer = gameState.players[playerId];
    if (!currentPlayer || currentPlayer.eliminated) return;

    setSelectedRoom(preSelectedRoom);
    setHasSelectedRoom(true);

    // Send selection to server
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "select_room",
        room: preSelectedRoom
      }));
    }

    // Clear pre-selection
    setPreSelectedRoom(null);
  };

  // NEW: End turn button - notifies server the player is ready to advance to killer phase
  const endTurn = () => {
    if (!gameState) return;
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "end_turn",
        player_id: playerId
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

    // NEW: For powers that don't require action, show "Fouillez une pièce" popup immediately
    const powerDef = powerDefinitions[powerName];
    if (powerDef && !powerDef.requires_action) {
      setShowOrcSearchPopup(true);
      // Auto-hide after 3 seconds
      setTimeout(() => {
        setShowOrcSearchPopup(false);
      }, 3000);
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

    // NEW: Show "Fouillez une pièce" popup for this orc after confirming power action
    setShowOrcSearchPopup(true);
    // Auto-hide after 3 seconds
    setTimeout(() => {
      setShowOrcSearchPopup(false);
    }, 3000);
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
                  : "Vous êtes un Orc, trouvez les aventuriers et débarrassez-vous d'eux !"}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#888', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Goblin Combat Popup */}
      {showGoblinCombat && goblinCombatEvent && (
        <GoblinCombat
          event={goblinCombatEvent}
          playerId={playerId}
          sessionId={sessionId}
          wsRef={ws}
          onClose={() => {
            setShowGoblinCombat(false);
            setGoblinCombatEvent(null);
          }}
        />
      )}

            {/* Multiplayer Combat Popup */}
      {showMultiplayerCombat && multiplayerCombatEvent && (
        <MultiPlayerCombat
          event={multiplayerCombatEvent}
          playerId={playerId}
          sessionId={sessionId}
          wsRef={ws}
          onClose={() => {
            setShowMultiplayerCombat(false);
            setMultiplayerCombatEvent(null);
          }}
        />
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
          onClick={() => {
  setShowTrapPopup(false);
  notifyEventCompleted();  // NEW
}}
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
                  onEnded={() => setTimeout(() => {
  setShowTrapPopup(false);
  notifyEventCompleted();
}, 1000)}
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
              notifyEventCompleted();
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
                        notifyEventCompleted();
                      }, 5000);
                    }, 500);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPoisonVideoPopup(false);
                    setShowPoisonPopup(true);
                    setTimeout(() => {
                      setShowPoisonPopup(false);
                      notifyEventCompleted();
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
          onClick={() => {
  setShowPoisonPopup(false);
  notifyEventCompleted();  // NEW
}}
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
          onClick={() => {
  setShowMimicPopup(false);
  notifyEventCompleted();  // NEW
}}
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
                  onEnded={() => setTimeout(() => {
  setShowMimicPopup(false);
  notifyEventCompleted();
}, 1000)}
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
          onClick={() => {
  setShowTeleportationPopup(false);
  notifyEventCompleted();  // NEW
}}
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
                  onEnded={() => setTimeout(() => {
  setShowTeleportationPopup(false);
  notifyEventCompleted();
}, 1000)}
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
          onClick={() => {
  setShowGoldFoundPopup(false);
  notifyEventCompleted();  // NEW
}}
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
                  onClick={() => {
                    setShowMerchantPopup(false);
                    notifyEventCompleted();  // NEW
                  }}
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
                    disabled={gameState.players[playerId]?.gold < 1000 || (gameState.players[playerId]?.inventory || []).some(s => s?.type === 'medikit')}
                    style={{ 
                      backgroundColor: (gameState.players[playerId]?.gold >= 1000 && !(gameState.players[playerId]?.inventory || []).some(s => s?.type === 'medikit')) ? '#10b981' : '#555',
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
                    disabled={gameState.players[playerId]?.gold < 300 || (gameState.players[playerId]?.inventory || []).some(s => s?.type === 'antidote')}
                    style={{ 
                      backgroundColor: (gameState.players[playerId]?.gold >= 300 && !(gameState.players[playerId]?.inventory || []).some(s => s?.type === 'antidote')) ? '#10b981' : '#555',
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
                  onClick={() => {
                    setShowShopDialog(false);
                    notifyEventCompleted();  // NEW
                  }}
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

      {/* NEW: Forge Intro Popup */}
      {showForgePopup && (() => {
        const closeForge = async () => {
          setShowForgePopup(false);
          try {
            await axios.post(`${API}/game/${sessionId}/forge_close`, { player_id: playerId });
          } catch (e) {}
          notifyEventCompleted();
        };
        return (
          <div className="game-over-overlay" style={{ zIndex: 2000 }} data-testid="forge-popup">
            <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#1a1410', borderColor: '#ff7a18', border: '3px solid #ff7a18' }}>
              <CardHeader>
                <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#ffb35a' }}>
                  🔥 <span>La Forge</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {forgeVideoPath && (
                  <video src={forgeVideoPath} autoPlay loop muted style={{ width: '100%', maxHeight: '380px', borderRadius: '8px', marginBottom: '1rem' }} />
                )}
                <p style={{ fontSize: '1.15em', textAlign: 'center', color: '#fff', marginBottom: '1.5rem' }}>
                  Vous avez trouvé la Forge ! Voulez-vous utiliser vos runes ?
                </p>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                  <Button data-testid="forge-yes-btn" onClick={() => { setShowForgePopup(false); setShowForgeInterface(true); }}
                    style={{ backgroundColor: '#ff7a18', color: '#000', fontWeight: 'bold', padding: '1rem 2rem', fontSize: '1.1rem' }}>
                    ✅ Oui
                  </Button>
                  <Button data-testid="forge-no-btn" onClick={closeForge}
                    style={{ backgroundColor: '#555', color: '#fff', padding: '1rem 2rem', fontSize: '1.1rem' }}>
                    ❌ Non
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* NEW: Forge Interface */}
      {showForgeInterface && (() => {
        const player = gameState?.players?.[playerId] || {};
        const inventory = player.inventory || [];
        const weaponBonuses = player.weapon_bonuses || [];
        const attempts = player.weapon_forge_attempts || 0;
        const RATES = [1.0, 0.8, 0.6, 0.4, 0.3];
        const currentRate = RATES[Math.min(attempts, RATES.length - 1)];

        const CLASS_TO_WEAPON = {
          Assassin: 'assassin', Barbare: 'barbare', Barde: 'barde',
          Elfe: 'elfe', Guerrier: 'knight', Mage: 'mage'
        };
        const weaponSlug = CLASS_TO_WEAPON[player.character_class] || 'mage';
        const weaponSrc = `/items/Weapon_${weaponSlug}.png`;

        const RUNE_LABELS = {
          rune_dommage: '+2 dégâts',
          rune_vitalite: '+8 vitalité',
          rune_initiative: '+3 initiative',
        };

        const runeSlots = inventory
          .map((it, idx) => ({ item: it, idx }))
          .filter(s => s.item && s.item.type && s.item.type.startsWith('rune_'));

        const handleForge = async (slotIndex) => {
          if (forgeBusy) return;
          setForgeBusy(true);
          setForgeBarAnimation(true); // NOUVEAU : Démarrer l'animation de la barre
          setForgeAnimation('forging');          // NEW: suspense phase
          setForgeFlashLabel('');
          try {
            const resPromise = axios.post(`${API}/game/${sessionId}/forge_use_rune`, {
              player_id: playerId,
              slot_index: slotIndex,
            });
            // Attendre la fin de l'animation de la barre (4 sec)
            const [res] = await Promise.all([
              resPromise,
              new Promise(r => setTimeout(r, 4000)),
            ]);
            setForgeBarAnimation(false); // NOUVEAU : Arrêter l'animation
            const ok = res.data.result === 'success';
            setForgeAnimation(ok ? 'success' : 'failure');
            setForgeFlashLabel(ok ? `✨ ${res.data.rune_label}` : `💥 Tous les bonus perdus`);
            if (ok) toast.success(`🔨 Forge réussie : ${res.data.rune_label}`);
            else toast.error(`💥 Forge ratée — bonus réinitialisés`);
            setTimeout(() => { setForgeAnimation(null); setForgeFlashLabel(""); }, 2200);
          } catch (e) {
            setForgeAnimation(null);
            setForgeBarAnimation(false); // NOUVEAU : reset en cas d'erreur
            toast.error(e.response?.data?.detail || "Erreur de forge");
          } finally {
            setTimeout(() => setForgeBusy(false), 2600);
          }
        };

        const closeInterface = async () => {
          setShowForgeInterface(false);
          try {
            await axios.post(`${API}/game/${sessionId}/forge_close`, { player_id: playerId });
          } catch (e) {}
          notifyEventCompleted();
        };

        const weaponStyle = {
          width: '180px',
          height: '180px',
          objectFit: 'contain',
          transition: 'filter 0.5s ease, transform 0.4s ease',
          filter:
            forgeAnimation === 'forging'
              ? 'drop-shadow(0 0 14px #ff6a00) drop-shadow(0 0 28px #ff2200) brightness(1.15) saturate(1.2)'
              : forgeAnimation === 'success'
              ? 'drop-shadow(0 0 30px #ffd166) drop-shadow(0 0 60px #ff9933) brightness(1.6) saturate(1.5)'
              : forgeAnimation === 'failure'
              ? 'grayscale(0.5) brightness(0.5) contrast(1.3)'
              : 'drop-shadow(0 0 8px rgba(255,170,80,0.35))',
          transform:
            forgeAnimation === 'success' ? 'scale(1.15)' :
            forgeAnimation === 'forging' ? 'scale(1.02)' : 'scale(1)',
          animation:
            forgeAnimation === 'failure' ? `forgeShake ${Math.min(0.6 + attempts * 0.1, 1.2)}s ease-in-out` :
            forgeAnimation === 'forging' ? 'forgePulse 0.6s ease-in-out infinite alternate, forgeHeat 1.4s ease-in-out infinite' :
            'none',
        };

        return (
          <div className="game-over-overlay" style={{ zIndex: 2001 }} data-testid="forge-interface">
            <style>{`
              @keyframes forgeShake {
                0%,100% { transform: translateX(0) scale(1); }
                15% { transform: translateX(-8px); }
                30% { transform: translateX(8px); }
                45% { transform: translateX(-6px); }
                60% { transform: translateX(6px); }
                75% { transform: translateX(-3px); }
              }
              @keyframes forgePulse {
                0%   { filter: drop-shadow(0 0 10px #ff6a00) brightness(1.0); }
                100% { filter: drop-shadow(0 0 26px #ffb347) drop-shadow(0 0 40px #ff2200) brightness(1.4); }
              }
              @keyframes forgeHeat {
                0%,100% { transform: translateY(0) scale(1.02); }
                50%     { transform: translateY(-3px) scale(1.05); }
              }
              @keyframes forgeSparks {
                0%   { opacity: 0.2; transform: translate(-50%,-50%) scale(0.6); }
                50%  { opacity: 0.9; transform: translate(-50%,-50%) scale(1.15); }
                100% { opacity: 0.2; transform: translate(-50%,-50%) scale(0.6); }
              }
              @keyframes forgeEmberRise {
                0%   { transform: translateY(0) scale(1); opacity: 0; }
                20%  { opacity: 1; }
                100% { transform: translateY(-120px) scale(0.3); opacity: 0; }
              }
              .forge-flash { animation: forgeFlash 1.6s ease-out; }
              @keyframes forgeFlash {
                0% { opacity: 0; transform: translateY(10px) scale(0.9); }
                30% { opacity: 1; transform: translateY(-4px) scale(1.1); }
                100% { opacity: 0; transform: translateY(-30px) scale(1); }
              }
            `}</style>
            <Card style={{ maxWidth: '880px', width: '95%', backgroundColor: '#1a1410', borderColor: '#ff7a18', border: '3px solid #ff7a18' }}>
              <CardHeader>
                <CardTitle style={{ color: '#ffb35a', textAlign: 'center', fontSize: '1.6rem' }}>
                  🔥 La Forge — Tentative {attempts + 1}
                </CardTitle>
                <p style={{ textAlign: 'center', color: '#ffd9a8', margin: 0 }}>
                  Chance de réussite actuelle : <strong style={{ color: '#fff' }}>{Math.round(currentRate * 100)}%</strong>
                </p>
              </CardHeader>
              <CardContent>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'flex-start' }}>
                  <div style={{ position: 'relative', textAlign: 'center', padding: '1rem', backgroundColor: '#0d0a08', borderRadius: '12px', minHeight: '260px' }}>
                    <img src={weaponSrc} alt="Arme" style={weaponStyle} data-testid="forge-weapon-sprite" />
                    {/* NOUVEAU : Barre d'animation de forge */}
                    {forgeBarAnimation && (
                      <div style={{
                        position: 'absolute',
                        top: '20px',
                        left: '20px',
                        right: '20px',
                        zIndex: 100
                      }}>
                        <ForgeBar 
                          successRate={Math.round(currentRate * 100)} 
                          onAnimationComplete={() => {
                            console.log("Animation de la barre terminée");
                          }}
                        />
                      </div>
                    )}
                    {forgeAnimation === 'forging' && (
                      <>
                        <div style={{
                          position: 'absolute', top: '50%', left: '50%',
                          width: '240px', height: '240px',
                          borderRadius: '50%',
                          background: 'radial-gradient(circle, rgba(255,140,40,0.45) 0%, rgba(255,60,0,0.25) 45%, rgba(0,0,0,0) 75%)',
                          pointerEvents: 'none',
                          animation: 'forgeSparks 0.9s ease-in-out infinite',
                        }} />
                        {[0, 1, 2, 3, 4].map(i => (
                          <span key={i} style={{
                            position: 'absolute',
                            left: `${35 + i * 8}%`, bottom: '18%',
                            width: '6px', height: '6px', borderRadius: '50%',
                            background: i % 2 ? '#ffb347' : '#ff5a00',
                            boxShadow: '0 0 8px #ff7a18',
                            animation: `forgeEmberRise ${1 + (i % 3) * 0.25}s ease-out ${i * 0.15}s infinite`,
                            pointerEvents: 'none',
                          }} />
                        ))}
                        <div style={{
                          position: 'absolute', top: '8%', left: 0, right: 0, textAlign: 'center',
                          color: '#ffb35a', fontWeight: 'bold', fontSize: '1rem',
                          letterSpacing: '0.2em', textTransform: 'uppercase',
                          textShadow: '0 0 8px #ff6a00',
                        }}>
                          Forge en cours...
                        </div>
                      </>
                    )}
                    {forgeFlashLabel && (
                      <div className="forge-flash" style={{ position: 'absolute', top: '40%', left: 0, right: 0, color: forgeAnimation === 'success' ? '#ffd166' : '#ff5252', fontWeight: 'bold', fontSize: '1.4rem', textShadow: '0 0 8px rgba(0,0,0,0.9)', pointerEvents: 'none' }}>
                        {forgeFlashLabel}
                      </div>
                    )}
                    <div style={{ marginTop: '0.8rem', color: '#ffd9a8', fontSize: '0.9rem' }}>
                      {player.character_class || 'Aventurier'}
                    </div>
                  </div>

                  <div style={{ backgroundColor: '#221813', borderRadius: '12px', padding: '1rem', border: '1px solid #4a3022' }}>
                    <h4 style={{ color: '#ffb35a', marginTop: 0, marginBottom: '0.6rem' }}>Bonus actifs</h4>
                    {weaponBonuses.length === 0 ? (
                      <p style={{ color: '#9a8475', fontStyle: 'italic', margin: 0 }}>Aucun bonus pour l'instant</p>
                    ) : (
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="forge-bonus-list">
                        {weaponBonuses.map((b, i) => (
                          <li key={i} style={{ color: '#fff', padding: '0.3rem 0.5rem', borderBottom: '1px solid #3a2820', fontSize: '0.95rem' }}>
                            ▸ {b.label || `+${b.value} ${b.stat}`}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div style={{ marginTop: '0.8rem', color: '#ffd9a8', fontSize: '0.85rem', borderTop: '1px solid #4a3022', paddingTop: '0.6rem' }}>
                      Total dégâts : <strong>+{player.damage_bonus || 0}</strong> &nbsp;|&nbsp;
                      Initiative : <strong>+{player.initiative_bonus || 0}</strong> &nbsp;|&nbsp;
                      PV max : <strong>{player.max_hp || 36}</strong>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '1.4rem' }}>
                  <h4 style={{ color: '#ffb35a', marginBottom: '0.6rem' }}>Runes disponibles</h4>
                  {runeSlots.length === 0 ? (
                    <p style={{ color: '#9a8475', fontStyle: 'italic' }}>
                      Vous n'avez aucune rune dans votre inventaire.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }} data-testid="forge-runes-list">
                      {runeSlots.map(({ item, idx }) => (
                        <button
                          key={idx}
                          data-testid={`forge-rune-${idx}`}
                          disabled={forgeBusy}
                          onClick={() => handleForge(idx)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.6rem',
                            backgroundColor: '#2a1f17',
                            border: '2px solid #ff7a18',
                            borderRadius: '10px',
                            padding: '0.6rem 0.9rem',
                            color: '#fff',
                            cursor: forgeBusy ? 'not-allowed' : 'pointer',
                            opacity: forgeBusy ? 0.6 : 1,
                            transition: 'transform 0.15s',
                          }}
                          onMouseEnter={(e) => { if (!forgeBusy) e.currentTarget.style.transform = 'translateY(-2px)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
                        >
                          <img src={ITEM_SPRITES[item.type]} alt="" style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
                          <div style={{ textAlign: 'left' }}>
                            <div style={{ fontWeight: 'bold' }}>{ITEM_NAMES[item.type]}</div>
                            <div style={{ fontSize: '0.78rem', color: '#ffd9a8' }}>{RUNE_LABELS[item.type]} → FORGER</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: '1.4rem', textAlign: 'center' }}>
                  <Button data-testid="forge-close-btn" onClick={closeInterface}
                    style={{ backgroundColor: '#555', color: '#fff', padding: '0.7rem 1.6rem' }}>
                    Quitter la forge
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}

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

      {/* NEW: Patrouille Detection Popup */}
      {showPatrouillePopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1001 }}
          onClick={() => setShowPatrouillePopup(false)}
          data-testid="patrouille-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#2a1a1a', borderColor: '#ef4444' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#ef4444' }}>
                🔍
                <span>Gobelin de Patrouille !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {patrouilleVideoPath && (
                <video 
                  autoPlay 
                  muted 
                  style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1rem' }}
                  onEnded={() => setTimeout(() => setShowPatrouillePopup(false), 1000)}
                >
                  <source src={patrouilleVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {patrouilleMessage}
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

      {/* NEW: Adventurer Turn Announcement Popup - Flashing */}
      {showAdventurerTurnPopup && (
        <div 
          className="turn-announcement-overlay"
          onClick={() => setShowAdventurerTurnPopup(false)}
          data-testid="adventurer-turn-popup"
        >
          <div className="turn-announcement-content">
            <img 
              src="/event/Tour-Aventurier.png" 
              alt="Tour des Aventuriers" 
              className="turn-announcement-image"
            />
            <h2 className="turn-announcement-text">Aventuriers, explorez le donjon !</h2>
          </div>
        </div>
      )}

      {/* NEW: Orc Search Announcement Popup - Flashing (Individual) */}
      {showOrcSearchPopup && (
        <div 
          className="turn-announcement-overlay"
          onClick={() => setShowOrcSearchPopup(false)}
          data-testid="orc-search-popup"
        >
          <div className="turn-announcement-content">
            <img 
              src="/event/Tour-Orc.png" 
              alt="Tour des Orcs" 
              className="turn-announcement-image"
            />
            <h2 className="turn-announcement-text">Fouillez une pièce !</h2>
          </div>
        </div>
      )}

      {/* Game Header */}
      <div className="game-header">
        <div className="game-info">
          {gameState.phase === "survivor_selection" && (
            <div className="phase-indicator survivor-phase" data-testid="phase-indicator">
              🛡️ Tour des aventuriers
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
                  : "Les Orcs ont éliminé tous les aventuriers..."}
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

                  // During survivor_selection, killer_power_selection, killer_selection phase, show who is selecting this room
                  // Only show players of the same role as current player
                  if (gameState.phase === "survivor_selection" || gameState.phase === "killer_power_selection" || gameState.phase === "killer_selection" || gameState.phase === "rage_second_selection" || gameState.phase === "processing") {
                    // 1. Joueurs qui ont déjà fait un choix de pièce (pending_action)
                    const playersWithPendingAction = Object.entries(gameState.pending_actions || {})
                      .filter(([pid, action]) => {
                        const player = gameState.players[pid];
                        return action.room === room.name &&
                               player &&
                               !player.eliminated &&
                               player.role === currentPlayerRole;
                      })
                      .map(([pid]) => gameState.players[pid]);

                    // 2. Pour les aventuriers : afficher aussi la position actuelle (current_room) des joueurs qui n'ont PAS encore fait de choix
                    let playersAtCurrentPosition = [];
                    if (currentPlayerRole === "survivor") {
                      playersAtCurrentPosition = Object.values(gameState.players)
                        .filter(player => {
                          // Aventurier, non éliminé, avec cette pièce comme position actuelle
                          if (player.role !== "survivor" || player.eliminated) return false;
                          if (player.current_room !== room.name) return false;
                          // Ne pas afficher si le joueur a déjà une pending_action (il sera affiché via playersWithPendingAction)
                          const hasPendingAction = gameState.pending_actions && gameState.pending_actions[player.id];
                          return !hasPendingAction;
                        });
                    }

                    // 3. Pour les orcs : afficher les aventuriers révélés par le gobelin de patrouille pour ce tour
                    let patrolRevealedInRoom = [];
                    if (currentPlayerRole === "killer" && gameState.patrol_revealed_survivors) {
                      patrolRevealedInRoom = Object.entries(gameState.patrol_revealed_survivors)
                        .filter(([pid, revealedRoom]) => {
                          if (revealedRoom !== room.name) return false;
                          const player = gameState.players[pid];
                          return player && !player.eliminated && player.role === "survivor";
                        })
                        .map(([pid]) => gameState.players[pid]);
                    }

                    playersSelectingThisRoom = [...playersWithPendingAction, ...playersAtCurrentPosition, ...patrolRevealedInRoom];
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
                  const hasPatrol = room.has_patrol && currentPlayerRole === "killer";

                  // Check if this room is pre-selected (for confirmation step)
                  const isPreSelected = preSelectedRoom === room.name;

                  // NOUVEAU : Fog of war pour les survivants
                  const isDiscovered = currentPlayerRole === "killer" || (gameState.discovered_rooms && gameState.discovered_rooms.includes(room.name));
                  const isAnimatingDiscovery = discoveredRoomsAnimation.has(room.name);
                  const displayName = isDiscovered ? room.name : "?";

                  return (
                    <div key={room.name} className="room-card-wrapper" style={{ position: 'relative' }}>
                      <button
                        data-testid={`room-${room.name.replace(/\s+/g, '-').toLowerCase()}`}
                        data-room-name={isDiscovered ? room.name : "undiscovered"}
                        className={`room-card ${
                          selectedRoom === room.name ? 'selected' :
                          isPreSelected ? 'pre-selected' :
                          room.locked ? 'locked' : ''
                         } ${isHighlighted ? 'room-highlighted' : ''} ${flashingRooms.has(room.name) ? 'room-teammate-flash' : ''} ${isAnimatingDiscovery ? 'room-discovery-animation' : ''}`}
                        onClick={() => selectRoom(room.name)}
                        disabled={isEliminated || hasSelectedRoom || room.locked}
                      >
                        <div className="room-name">{displayName}</div>
                        <div className="room-indicators">
                          {room.locked && <span className="room-icon locked-icon">❌</span>}
                          {eliminatedInRoom.length > 0 && <span className="room-icon skull-icon">💀</span>}
                          {isTrapped && <span className="room-icon room-trap-indicator" title="Blizzard">🥶</span>}
                          {isTrapTriggered && <span className="room-icon room-trap-indicator" title="Blizzard activé">🥶</span>}
                          {isPoisoned && <span className="room-icon room-poison-indicator" title="Toxine">😷</span>}
                          {hasMimic && <span className="room-icon room-mimic-indicator" title="Mimic">💰</span>}
                          {hasTeleportationTrap && <span className="room-icon room-teleport-trap-indicator" title="Piège de téléportation">➡️🌀</span>}
                          {hasTeleportationExit && <span className="room-icon room-teleport-exit-indicator" title="Portail de sortie">🌀➡️</span>}
                          {room.merchant_discovered && (
                             <span className="room-player-avatar" title="Marchand">
                                 <img src="/avatars/Merchant.png" alt="Marchand" style={{ width: '1.3rem', height: '1.3rem', objectFit: 'contain' }} />
                             </span>
                          )}
                          {room.forge_discovered && currentPlayerRole === "survivor" && (
                             <span className="room-icon" title="Forge" style={{ fontSize: '1.1rem' }}>🔥</span>
                          )}
                          {hasPatrol && (
                             <span className="room-player-avatar" title="Gobelin de Patrouille">
                                 <img src="/avatars/Patrouille.png" alt="Patrouille" style={{ width: '1.3rem', height: '1.3rem', objectFit: 'contain' }} />
                             </span>
                          )}                        
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
                      {/* Validation button appears when room is pre-selected */}
                      {isPreSelected && !hasSelectedRoom && (
                        <button
                          className="room-confirm-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmRoomSelection();
                          }}
                          data-testid={`confirm-room-${room.name.replace(/\s+/g, '-').toLowerCase()}`}
                        >
                          ✓ Valider
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* End Turn Button - visible to survivors after they have selected a room
            and have no pending event popup. They must click to confirm end of turn. */}
        {(() => {
          if (!gameState) return null;
          if (gameState.phase !== "survivor_selection") return null;
          if (currentPlayerRole !== "survivor") return null;
          const me = gameState.players[playerId];
          if (!me || me.eliminated) return null;

          const hasSelected = !!gameState.pending_actions?.[playerId];
          const hasPendingEvent = !!gameState.pending_events?.[playerId];
          const hasEndedTurn = (gameState.survivors_ended_turn || []).includes(playerId);

          if (!hasSelected) return null;

          // Count alive survivors and how many have ended their turn (for UI feedback)
          const aliveSurvivors = Object.values(gameState.players).filter(
            (p) => p.role === "survivor" && !p.eliminated
          );
          const endedCount = (gameState.survivors_ended_turn || []).filter(
            (pid) => gameState.players[pid] && !gameState.players[pid].eliminated
          ).length;

          return (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                margin: '16px 0',
              }}
            >
              <button
                data-testid="end-turn-btn"
                onClick={endTurn}
                disabled={hasPendingEvent || hasEndedTurn}
                style={{
                  padding: '14px 32px',
                  fontSize: '18px',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  border: '2px solid #d4af37',
                  cursor: (hasPendingEvent || hasEndedTurn) ? 'not-allowed' : 'pointer',
                  backgroundColor: hasEndedTurn ? '#4b5563' : (hasPendingEvent ? '#6b7280' : '#d4af37'),
                  color: hasEndedTurn ? '#d1d5db' : '#1a1410',
                  opacity: (hasPendingEvent || hasEndedTurn) ? 0.7 : 1,
                  boxShadow: (hasPendingEvent || hasEndedTurn) ? 'none' : '0 4px 12px rgba(212,175,55,0.4)',
                  transition: 'all 0.2s ease',
                }}
              >
                {hasEndedTurn
                  ? '✅ Tour terminé - en attente des autres aventuriers...'
                  : hasPendingEvent
                  ? '⏳ Terminez la fouille avant de finir votre tour'
                  : '⏭️ Terminer mon tour'}
              </button>
              <div
                data-testid="end-turn-counter"
                style={{ color: '#d4af37', fontSize: '13px', fontStyle: 'italic' }}
              >
                {endedCount} / {aliveSurvivors.length} aventurier(s) ont terminé leur tour
              </div>
            </div>
          );
        })()}

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
                    {/* Afficher les PV pour les aventuriers */}
                    {player.role === "survivor" && player.hp !== undefined && !player.eliminated && (
                      <span className="status-hp" style={{ color: player.hp > 12 ? '#ef4444' : '#ff6b6b', fontWeight: 'bold', marginLeft: '4px' }}>
                        ❤️{player.hp}
                      </span>
                    )}
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

      {/* Inventory HUD */}
      {currentPlayer && (
        <InventoryHUD 
          player={currentPlayer}
          onClick={() => setShowInventory(true)}
        />
      )}

      {/* Stats HUD */}
      {currentPlayer && (
        <StatsHUD 
          player={currentPlayer}
          onClick={() => setShowStats(true)}
        />
      )}

      {/* Inventory Modal */}
      {showInventory && currentPlayer && (
        <InventoryModal
          player={currentPlayer}
          onClose={() => setShowInventory(false)}
          sessionId={sessionId}
        />
      )}

      {/* Stats Modal */}
      {showStats && currentPlayer && (
        <StatsModal
          player={currentPlayer}
          onClose={() => setShowStats(false)}
        />
      )}

      {/* Rune Pickup Modal */}
      {gameState.pending_events && 
       gameState.pending_events[playerId] && 
       typeof gameState.pending_events[playerId] === 'object' &&
       gameState.pending_events[playerId].type === 'rune_found' && (
        <RunePickupModal
          event={gameState.pending_events[playerId]}
          playerId={playerId}
          sessionId={sessionId}
        />
      )}
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
