import { useState, useEffect, useRef, useMemo } from "react";
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

// Goblin roulette sequence (boucle infinie, multipliée par le multiplicateur de la stat)
const GOBLIN_ROULETTE_SEQUENCE = [1, 1, 2, 1, 3, 1, 2, 1, 2, 1];

// Helpers roulette gobelin
function getStatLabel(stat) {
  const labels = { damage: 'Dégâts', hp: 'Vitalité', initiative: 'Initiative' };
  return labels[stat] || stat;
}

function getStatIcon(stat) {
  const icons = { damage: '🗡️', hp: '❤️', initiative: '⚡' };
  return icons[stat] || '📊';
}
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
  antidote: '/inventory/antidote.png',
  pierre_quete: '/items/Pierre_Quete.png',
  chaussons: '/items/Chaussons.png',
  couronne: '/items/Couronne.png',
  culotte: '/items/Culotte.png',
  relique_triangulaire: '/items/Relique_Triangulaire.png',
  relique_cubique: '/items/Relique_Cubique.png',
  relique_spherique: '/items/Relique_Spherique.png',
  amulette_tortue: '/items/amulette_tortue.png',   // 🐢 NEW
  amulette_oignon: '/items/amulette_oignon.png',   // 🧅 NEW
  amulette_trefle: '/items/amulette_trefle.png',   // 🍀 NEW
  foulard_rankyr: '/items/Foulard%20Rankyr.png',   // 🏴 NEW
  amulette_coco: '/items/AmuCoco.png',             // 🥥 NEW
  bandana_ranja: '/items/Bandana%20Ranja.png',     // 🎯 NEW
  lait_lew: '/items/Lait%20LEW.png',               // 🥛 NEW
  bonnet_croblow: '/items/Bonnet%20Croblow.png',   // 🌸 NEW
};

const ITEM_NAMES = {
  rune_dommage: 'Rune de Dommage',
  rune_initiative: "Rune d'Initiative",
  rune_vitalite: 'Rune de Vitalité',
  antidote: 'Antidote',
  pierre_quete: "Pierre d'observation",
  chaussons: 'Chaussons du Roi Orc',
  couronne: 'Couronne de rechange du Roi Orc',
  culotte: 'Culotte du Roi Orc',
  relique_triangulaire: 'Relique Triangulaire',
  relique_cubique: 'Relique Cubique',
  relique_spherique: 'Relique Sphérique',
  amulette_tortue: 'Amulette Tortue',               // 🐢 NEW
  amulette_oignon: 'Amulette Oignon',               // 🧅 NEW
  amulette_trefle: 'Amulette Chanceuse',            // 🍀 NEW
  foulard_rankyr: 'Foulard Rankyr',                 // 🏴 NEW
  amulette_coco: 'Amulette Coco de Bouchou',         // 🥥 NEW
  bandana_ranja: 'Bandana de Ranja',                 // 🎯 NEW
  lait_lew: 'Lait LEW',                             // 🥛 NEW
  bonnet_croblow: 'Bonnet Croblow',                  // 🌸 NEW
};

// Descriptions des trophées (Chaussons / Couronne / Culotte)
const TROPHY_DESCRIPTIONS = {
  chaussons: "Porter ces chaussons est inutile, mais si vous souhaitez repartir avec un trophée, c'est l'occasion rêvée.",
  couronne: "D'aucune utilité, si ce n'est pour vous la péter sur la place du village.",
  culotte: "Comptez-vous réellement encombrer votre inventaire avec cette culotte ridicule ?",
};

// Descriptions des objets de l'inventaire (affichées dans ItemInfoModal)
const ITEM_DESCRIPTIONS = {
  rune_vitalite: "Elle vous apportera un peu de confort si vous l'appliquez correctement à votre arme grâce à la forge.",
  rune_initiative: "Passez probablement prioritaire en début de combat si vous l'appliquez correctement à votre arme grâce à la forge.",
  rune_dommage: "Gagnez en puissance si vous l'appliquez correctement à votre arme grâce à la forge.",
  antidote: "S'utilise pour vous soigner de la toxine.",
  relique_spherique: "Obtenue sur le gobelin fuyard, cette étrange relique est nécessaire pour venir à bout du cristal.",
  relique_cubique: "Obtenue suite à la quête de la pierre d'observation, cette étrange relique est nécessaire pour venir à bout du cristal.",
  relique_triangulaire: "Obtenue auprès du marchand, cette étrange relique est nécessaire pour venir à bout du cristal.",
  // Conservation des descriptions existantes
  chaussons: TROPHY_DESCRIPTIONS.chaussons,
  couronne: TROPHY_DESCRIPTIONS.couronne,
  culotte: TROPHY_DESCRIPTIONS.culotte,
  // pierre_quete: pas de description ajoutée → fallback "No description."
  amulette_tortue:
    "Être lent n'est pas forcément un vilain défaut. Vous saurez en tirer profit pour cette fois !\n\n" +
    "Effet : vous réduisez de 25% tous dégâts reçus si vous avez l'initiative la plus basse durant le combat.",
  amulette_oignon:
    "L'oignon fait la force !\n\n" +
    "Effet : Vous infligez 50% de dégats supplémentaires si vous êtes plusieurs aventuriers dans le combat.",
  amulette_trefle:
    "Vous aurez de la chance dans votre malheur.\n\n" +
    "Effet : vous obtenez 50% d'or en plus en explorant une pièce, mais vous subissez 50% de dégâts supplémentaires en combat.",
  foulard_rankyr:
    "Ce foulard appartenait autrefois à un trésorier tenu de la comptabilité de son royaume.\n\n" +
    "Effet : Dans un combat, vous infligez 50% de dégâts supplémentaires tant que vous n'avez pas subi de dégâts. L'effet se réinitialise à chaque nouveau combat.",
  amulette_coco:
    "Cette amulette appartenait autrefois à un aventurier globetrotteur qui l'a confectionnée à partir de morceaux de coco trouvés sur différentes îles.\n\n" +
    "Effet : En combat, lorsque vos PV passent sous 30% de vos PV max, vos dégâts infligés sont augmentés de 75%.",
  bandana_ranja:
    "Son porteur n'a jamais réellement porté de bandana de sa vie, ce qui vous donne l'occasion d'enfin porter quelque chose de neuf.\n\n" +
    "Effet : Si vous avez la plus haute initiative en combat (aventuriers compris), vos dégâts infligés sont augmentés de 50% pour le reste du combat.",
  lait_lew:
    "LEW, amoureux de la nature, produit le meilleur lait de la région. " +
    "Aussi étrange que cela puisse paraître, personne ne l'a jamais vu gérer un troupeau. " +
    "D'où ce lait mystérieux peut-il provenir ?\n\n" +
    "Effet : 4 PV restaurés par tour, durant 3 tours (ne peut pas dépasser les PV max).",
  bonnet_croblow:
    "Amoureux de la nature, Croblow a porté ce bonnet sur lequel quelques fleurs trouvent miraculeusement encore racine.\n\n" +
    "Effet : Dans un combat, vous vous soignez vous et vos alliés à hauteur de 10% des dégâts que vous infligez. L'effet se réinitialise à chaque nouveau combat.",
};

const getItemDescription = (itemType) => ITEM_DESCRIPTIONS[itemType] || "No description.";

// Prix de vente au marchand (doit correspondre au backend SELL_PRICES)
const SELL_PRICES = {
  rune_dommage: 100,
  rune_initiative: 100,
  rune_vitalite: 100,
  chaussons: 500,
  couronne: 500,
  culotte: 500,
  antidote: 150,
  relique_triangulaire: 500,
  lait_lew: 150,   // 🥛 NEW
};

// Items NON vendables (objets de quête)
const NON_SELLABLE_ITEMS = new Set(['pierre_quete', 'relique_triangulaire', 'relique_cubique', 'relique_spherique', 'amulette_tortue', 'amulette_oignon', 'amulette_trefle', 'foulard_rankyr', 'amulette_coco', 'bandana_ranja', 'bonnet_croblow']);

const getSellPrice = (itemType) => SELL_PRICES[itemType] ?? 50;

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
  const [initiativeIndicators, setInitiativeIndicators] = useState({});

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

      // Calcul des initiatives (affichage uniquement — l'ordre des tours reste fixe : aventurier puis orc)
      const survivorInit = Math.floor(Math.random() * 20) + 1;
      const orcInit = Math.floor(Math.random() * 20) + 1;
      setInitiativeIndicators({ survivor: survivorInit, orc: orcInit });
      setTimeout(() => setInitiativeIndicators({}), 2000);

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
                  {initiativeIndicators['orc'] !== undefined && (
                    <div
                      data-testid="initiative-indicator-orc"
                      style={{
                        position: 'absolute',
                        top: '-40px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        color: '#3b82f6',
                        fontSize: '1.8rem',
                        fontWeight: 'bold',
                        textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                        pointerEvents: 'none',
                        animation: 'initiativeFadeUp 2s ease-out forwards',
                        zIndex: 10,
                      }}
                    >
                      🎲 {initiativeIndicators['orc']}
                    </div>
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
                  {initiativeIndicators['survivor'] !== undefined && (
                    <div
                      data-testid="initiative-indicator-survivor"
                      style={{
                        position: 'absolute',
                        top: '-40px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        color: '#3b82f6',
                        fontSize: '1.8rem',
                        fontWeight: 'bold',
                        textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                        pointerEvents: 'none',
                        animation: 'initiativeFadeUp 2s ease-out forwards',
                        zIndex: 10,
                      }}
                    >
                      🎲 {initiativeIndicators['survivor']}
                    </div>
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
                {initiativeIndicators['survivor'] !== undefined && (
                  <div
                    data-testid="initiative-indicator-survivor"
                    style={{
                      position: 'absolute',
                      top: '-40px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      color: '#3b82f6',
                      fontSize: '1.8rem',
                      fontWeight: 'bold',
                      textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                      pointerEvents: 'none',
                      animation: 'initiativeFadeUp 2s ease-out forwards',
                      zIndex: 10,
                    }}
                  >
                    🎲 {initiativeIndicators['survivor']}
                  </div>
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
                {initiativeIndicators['orc'] !== undefined && (
                  <div
                    data-testid="initiative-indicator-orc"
                    style={{
                      position: 'absolute',
                      top: '-40px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      color: '#3b82f6',
                      fontSize: '1.8rem',
                      fontWeight: 'bold',
                      textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                      pointerEvents: 'none',
                      animation: 'initiativeFadeUp 2s ease-out forwards',
                      zIndex: 10,
                    }}
                  >
                    🎲 {initiativeIndicators['orc']}
                  </div>
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
// frameWidth, frameHeight et totalFrames sont OPTIONNELS :
//   - frameWidth  et frameHeight sont calculés automatiquement depuis image.naturalWidth / cols
//     et image.naturalHeight / rows si non fournis.
//   - totalFrames vaut cols x rows par défaut.
// Il suffit donc de passer spriteSheet + cols + rows pour que tout fonctionne correctement.
const SpriteSheetAnimator = ({ spriteSheet, frameWidth, frameHeight, cols, rows, totalFrames, frameDuration = 100, loop = true, onAnimationEnd }) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [computedFrameSize, setComputedFrameSize] = useState({ w: frameWidth, h: frameHeight });
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    const image = new Image();
    image.src = spriteSheet;
    image.onload = () => {
      imageRef.current = image;
      // Calcul automatique si frameWidth / frameHeight ne sont pas fournis explicitement
      const w = frameWidth  || Math.floor(image.naturalWidth  / cols);
      const h = frameHeight || Math.floor(image.naturalHeight / rows);
      setComputedFrameSize({ w, h });
      setCurrentFrame(0);
    };
    // Reinitialisr la frame a 0 quand on change de sprite sheet (idle -> attack -> hurt)
    setCurrentFrame(0);
  }, [spriteSheet, cols, rows, frameWidth, frameHeight]);

  // totalFrames explicite, ou cols x rows par defaut
  const effectiveTotalFrames = totalFrames || (cols * rows);

  useEffect(() => {
    if (!imageRef.current || !canvasRef.current) return;
    if (!imageRef.current.complete) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const fw = computedFrameSize.w;
    const fh = computedFrameSize.h;
    if (!fw || !fh) return;

    // Calculer la position de la frame dans la sprite sheet
    const col = currentFrame % cols;
    const row = Math.floor(currentFrame / cols);

    // Effacer le canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dessiner la frame actuelle
    try {
      ctx.drawImage(
        imageRef.current,
        col * fw,      // source X
        row * fh,      // source Y
        fw,            // source largeur
        fh,            // source hauteur
        0,             // destination X
        0,             // destination Y
        canvas.width,  // destination largeur
        canvas.height  // destination hauteur
      );
    } catch (error) {
      console.error('Erreur lors du dessin de la frame:', error);
    }
  }, [currentFrame, computedFrameSize, cols, rows]);

  useEffect(() => {
    const animate = () => {
      setCurrentFrame(prev => {
        const nextFrame = prev + 1;
        if (nextFrame >= effectiveTotalFrames) {
          if (loop) {
            return 0;
          } else {
            if (onAnimationEnd) onAnimationEnd();
            return prev; // Rester sur la derniere frame
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
  }, [effectiveTotalFrames, frameDuration, loop, onAnimationEnd]);

  return (
    <canvas
      ref={canvasRef}
      width={200}  // Taille d'affichage a l'ecran
      height={115} // frameHeight calcule : 1000x690 / 5cols x 6rows = 200x115
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

// ========== FLEEING GOBLIN COMBAT COMPONENT ==========
// Même système que MultiPlayerCombat, mais simplifié :
//   - Gobelin Fuyard : 1 PdV, initiative 10, N'ATTAQUE PAS, pas de sprite "hurt"
//   - Si gobelin > initiative survivant → flee (animation inversée), pas de récompense
//   - Si survivant ≥ initiative gobelin → survivant attaque, gobelin tombe (fainted), relique obtenue
const FleeingGoblinCombat = ({ event, playerId, sessionId, onClose }) => {
  const goblinData   = event.goblin;
  const survivorData = event.survivor;
  const survivorWins = survivorData.initiative >= goblinData.initiative;

  // ── État du combat ───────────────────────────────────────────────────────────
  const [combatants, setCombatants]           = useState([]);
  const [survivorAnim, setSurvivorAnim]       = useState('idle'); // 'idle' | 'attack'
  const [goblinAnim,   setGoblinAnim]         = useState('idle'); // 'idle' | 'flee' | 'fainted'
  const [survivorLeft, setSurvivorLeft]       = useState('10%'); // position pour animer l'avance
  const [damageIndicators, setDamageIndicators] = useState({});
  const [initiativeIndicators, setInitiativeIndicators] = useState({});
  const [combatLog,   setCombatLog]           = useState([]);
  const [combatOver,  setCombatOver]          = useState(false);
  const [canClose,    setCanClose]            = useState(false);
  const [resultMessage, setResultMessage]     = useState('');

  // ── Init combattants ──────────────────────────────────────────────────────────
  useEffect(() => {
    const fighters = [
      {
        id: survivorData.id,
        name: survivorData.name,
        survivorClass: survivorData.survivorClass || survivorData.name, // classe pour les sprites
        type: 'survivor',
        hp: survivorData.hp,
        maxHp: survivorData.maxHp,
        initiative: survivorData.initiative,
        alive: true,
      },
      {
        id: 'fleeing_goblin',
        name: 'Gobelin Fuyard',
        type: 'fleeing_goblin',
        hp: goblinData.hp,
        maxHp: goblinData.maxHp,
        initiative: goblinData.initiative,
        alive: true,
      },
    ];
    fighters.sort((a, b) => b.initiative - a.initiative);
    setCombatants(fighters);

    setCombatLog([
      `⚔️ Un Gobelin Fuyard surgit !`,
      `📊 Initiatives — ${survivorData.name} : ${survivorData.initiative} | Gobelin : ${goblinData.initiative}`,
    ]);

    setInitiativeIndicators({ [survivorData.id]: survivorData.initiative, fleeing_goblin: goblinData.initiative });
    setTimeout(() => setInitiativeIndicators({}), 2000);
  }, [event]);

  // ── Simulation du combat ─────────────────────────────────────────────────────
  useEffect(() => {
    if (combatants.length === 0) return;
    let mounted = true;

    const runCombat = async () => {
      await new Promise(r => setTimeout(r, 800)); // pause intro
      if (!mounted) return;

      if (!survivorWins) {
        // ── CAS : Gobelin fuit ───────────────────────────────────────────────
        setGoblinAnim('flee');
        setCombatLog(prev => [...prev,
          `💨 Le Gobelin Fuyard est plus rapide (${goblinData.initiative} > ${survivorData.initiative}) et prend la fuite !`
        ]);
        await new Promise(r => setTimeout(r, 2200)); // durée animation flee (20 frames × 100ms + marge)
        if (!mounted) return;
        setGoblinAnim('idle');
        setResultMessage('💨 Le Gobelin Fuyard vous a échappé… Pas de récompense.');

      } else {
        // ── CAS : Survivant attaque ──────────────────────────────────────────
        setCombatLog(prev => [...prev,
          `⚔️ ${survivorData.name} a l'initiative (${survivorData.initiative} ≥ ${goblinData.initiative}) et charge !`
        ]);

        // 1. Avance du survivant
        setSurvivorAnim('attack');
        setSurvivorLeft('30%');
        await new Promise(r => setTimeout(r, 1700)); // 30 frames × ~50ms + marge
        if (!mounted) return;

        // 2. Impact + dégâts
        const damage = goblinData.hp; // 1 PdV → mort immédiate
        setDamageIndicators({ fleeing_goblin: { damage, timestamp: Date.now() } });
        setTimeout(() => setDamageIndicators({}), 1500);

        setCombatants(prev => prev.map(f =>
          f.id === 'fleeing_goblin' ? { ...f, hp: 0, alive: false } : f
        ));

        // 3. Retour survivant + gobelin fainted
        setSurvivorLeft('10%');
        setSurvivorAnim('idle');
        setGoblinAnim('fainted');

        setCombatLog(prev => [...prev,
          `💥 ${survivorData.name} assène ${damage} dégât(s) au Gobelin Fuyard (0/${goblinData.maxHp} PV) !`
        ]);
        await new Promise(r => setTimeout(r, 3200)); // 30 frames × 100ms + marge
        if (!mounted) return;

        setCombatLog(prev => [...prev, `🎁 Vous obtenez la Relique Sphérique !`]);
        setResultMessage('🎁 Vous avez vaincu le Gobelin Fuyard ! Relique Sphérique obtenue !');
      }

      // ── Résoudre côté backend ─────────────────────────────────────────────
      setCombatOver(true);
      try {
        await axios.post(`${API}/game/${sessionId}/resolve_fleeing_goblin_combat`, {
          survivor_id: survivorData.id,
          result: survivorWins ? 'survivor_win' : 'goblin_fled',
        });
      } catch (err) {
        console.error('Erreur résolution gobelin fuyard:', err);
      }
      if (!mounted) return;
      await new Promise(r => setTimeout(r, 1500));
      setCanClose(true);
    };

    runCombat();
    return () => { mounted = false; };
  }, [combatants.length]);

  // ── Paramètres spritesheets ───────────────────────────────────────────────────
  // Règle : frameWidth = 1000÷5 = 200 | frameHeight = hauteur÷rows = toujours 115
  // GobelinFuyard :  idle 1000×690 (5×6, 30f) | flee 1000×460 (5×4, 20f) | fainted 1000×690 (5×6, 30f)
  // Survivant      : idle 1000×690 (5×6, 30f) | attack 1000×690 (5×6, 30f)

  const survivorClass = survivorData.survivorClass || survivorData.name;

  const SURVIVOR_PARAMS = {
    idle:   { spriteSheet: `/fight/${survivorClass}_idle.webp`,   cols: 5, rows: 6, totalFrames: 30, frameDuration: 100, loop: true  },
    attack: { spriteSheet: `/fight/${survivorClass}_attack.webp`, cols: 5, rows: 6, totalFrames: 30, frameDuration: 50,  loop: false },
  };
  const GOBLIN_PARAMS = {
    idle:    { spriteSheet: '/fight/GobelinFuyard_idle.webp',    cols: 5, rows: 6, totalFrames: 30, frameDuration: 100, loop: true  },
    flee:    { spriteSheet: '/fight/GobelinFuyard_flee.webp',    cols: 5, rows: 4, totalFrames: 20, frameDuration: 100, loop: false },
    fainted: { spriteSheet: '/fight/GobelinFuyard_fainted.webp', cols: 5, rows: 6, totalFrames: 30, frameDuration: 100, loop: false },
  };

  const sp = SURVIVOR_PARAMS[survivorAnim] || SURVIVOR_PARAMS.idle;
  const gp = GOBLIN_PARAMS[goblinAnim]     || GOBLIN_PARAMS.idle;

  const survivorF = combatants.find(c => c.id === survivorData.id);
  const goblinF   = combatants.find(c => c.id === 'fleeing_goblin');

  return (
    <div
      className="game-over-overlay"
      style={{ zIndex: 3000, cursor: canClose ? 'pointer' : 'default' }}
      onClick={() => canClose && onClose && onClose()}
      data-testid="fleeing-goblin-combat"
    >
      <div style={{
        position: 'relative',
        width: '90%',
        maxWidth: '1000px',
        height: '75vh',
        backgroundImage: 'url(/fight/Ground.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        borderRadius: '12px',
        border: '4px solid #d4af37',
        overflow: 'hidden',
      }}>

        {/* ── Survivant (gauche) ─────────────────────────────────────────── */}
        <div style={{
          position: 'absolute',
          left: survivorLeft,
          bottom: '20%',
          opacity: survivorF?.alive !== false ? 1 : 0.35,
          transition: 'left 0.4s ease-out',
        }}>
          <SpriteSheetAnimator
            key={`survivor-${survivorAnim}`}
            spriteSheet={sp.spriteSheet}
            frameWidth={200}
            frameHeight={115}
            cols={sp.cols}
            rows={sp.rows}
            totalFrames={sp.totalFrames}
            frameDuration={sp.frameDuration}
            loop={sp.loop}
          />
          {initiativeIndicators[survivorData.id] !== undefined && (
            <div
              data-testid={`initiative-indicator-${survivorData.id}`}
              style={{
                position: 'absolute',
                top: '-40px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: '#3b82f6',
                fontSize: '1.8rem',
                fontWeight: 'bold',
                textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                pointerEvents: 'none',
                animation: 'initiativeFadeUp 2s ease-out forwards',
                zIndex: 10,
              }}
            >
              🎲 {survivorData.initiative}
            </div>
          )}
          {/* Barre de vie */}
          <div style={{ width: '200px', height: '12px', backgroundColor: '#333', borderRadius: '6px', overflow: 'hidden', marginTop: '5px', border: '2px solid #d4af37' }}>
            <div style={{ width: `${((survivorF?.hp ?? 0) / (survivorF?.maxHp ?? 1)) * 100}%`, height: '100%', backgroundColor: '#10b981', transition: 'width 0.3s' }} />
          </div>
          <div style={{ color: '#fff', textAlign: 'center', fontSize: '13px', fontWeight: 'bold', textShadow: '2px 2px 4px #000' }}>
            {survivorData.name} ({survivorF?.hp ?? 0}/{survivorF?.maxHp ?? 0}) — Init: {survivorData.initiative}
          </div>
        </div>

        {/* ── Gobelin Fuyard (droite) ────────────────────────────────────── */}
        <div style={{
          position: 'absolute',
          right: '10%',
          bottom: '20%',
          opacity: goblinF?.alive !== false ? 1 : 0.35,
          // En mode "flee" → court vers la droite (sans miroir)
          // Sinon → fait face au survivant (miroir)
          transform: goblinAnim === 'flee' ? 'scaleX(1)' : 'scaleX(-1)',
          transition: 'opacity 0.3s',
        }}>
          <SpriteSheetAnimator
            key={`goblin-${goblinAnim}`}
            spriteSheet={gp.spriteSheet}
            frameWidth={200}
            frameHeight={115}
            cols={gp.cols}
            rows={gp.rows}
            totalFrames={gp.totalFrames}
            frameDuration={gp.frameDuration}
            loop={gp.loop}
          />
          {/* Indicateur de dégâts (re-miroir pour être lisible malgré le scaleX(-1)) */}
          {damageIndicators['fleeing_goblin'] && (
            <div style={{
              position: 'absolute', top: '-30px', left: '50%',
              transform: 'translateX(-50%) scaleX(-1)',
              fontSize: '28px', fontWeight: 'bold', color: '#ff0000',
              textShadow: '2px 2px 4px #000, -1px -1px 2px #fff',
              animation: 'floatUpMirrored 1.5s ease-out',
              pointerEvents: 'none', zIndex: 1000,
            }}>
              -{damageIndicators['fleeing_goblin'].damage}
            </div>
          )}
          {initiativeIndicators['fleeing_goblin'] !== undefined && (
            <div
              data-testid="initiative-indicator-fleeing_goblin"
              style={{
                position: 'absolute',
                top: '-40px',
                left: '50%',
                transform: 'translateX(-50%) scaleX(-1)',
                color: '#3b82f6',
                fontSize: '1.8rem',
                fontWeight: 'bold',
                textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                pointerEvents: 'none',
                animation: 'initiativeFadeUp 2s ease-out forwards',
                zIndex: 10,
              }}
            >
              🎲 {goblinData.initiative}
            </div>
          )}
          {/* Barre de vie (re-miroir) */}
          <div style={{ width: '200px', height: '12px', backgroundColor: '#333', borderRadius: '6px', overflow: 'hidden', marginTop: '5px', border: '2px solid #d4af37', transform: 'scaleX(-1)' }}>
            <div style={{ width: `${((goblinF?.hp ?? 0) / (goblinF?.maxHp ?? 1)) * 100}%`, height: '100%', backgroundColor: '#ef4444', transition: 'width 0.3s' }} />
          </div>
          <div style={{ color: '#fff', textAlign: 'center', fontSize: '13px', fontWeight: 'bold', textShadow: '2px 2px 4px #000', transform: 'scaleX(-1)' }}>
            Gobelin Fuyard ({goblinF?.hp ?? 0}/{goblinF?.maxHp ?? 0}) — Init: {goblinData.initiative}
          </div>
        </div>

        {/* ── Combat log ────────────────────────────────────────────────── */}
        <div style={{
          position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)',
          width: '80%', maxHeight: '140px',
          backgroundColor: 'rgba(0,0,0,0.82)', borderRadius: '8px',
          padding: '10px', overflowY: 'auto', border: '2px solid #d4af37',
        }}>
          {combatLog.map((entry, idx) => (
            <div key={idx} style={{ color: '#e8dcc4', fontSize: '12px', marginBottom: '3px' }}>{entry}</div>
          ))}
        </div>

        {/* ── Résultat ──────────────────────────────────────────────────── */}
        {combatOver && resultMessage && (
          <div style={{
            position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0,0,0,0.9)', padding: '16px 32px', borderRadius: '12px',
            border: `3px solid ${survivorWins ? '#10b981' : '#f59e0b'}`,
          }}>
            <div style={{ color: survivorWins ? '#10b981' : '#f59e0b', fontSize: '20px', fontWeight: 'bold', textAlign: 'center' }}>
              {resultMessage}
            </div>
          </div>
        )}

        {/* ── Bouton fermer ─────────────────────────────────────────────── */}
        {canClose && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#d4af37', fontSize: '18px', fontWeight: 'bold', textAlign: 'center',
            backgroundColor: 'rgba(0,0,0,0.8)', padding: '15px 30px',
            borderRadius: '8px', border: '2px solid #d4af37', cursor: 'pointer',
          }}
          onClick={(e) => { e.stopPropagation(); if (onClose) onClose(); }}
          >
            Cliquez pour fermer
          </div>
        )}
      </div>
    </div>
  );
};

// 🐢 Marque les combattants qui bénéficient de la réduction de dégâts.
// Le porteur doit avoir STRICTEMENT la plus basse initiative parmi TOUS les combattants.
const applyAmuletteTortueBonus = (fighters) => {
  const recipients = [];
  if (!fighters || fighters.length < 2) return recipients;

  const minInit = Math.min(...fighters.map(f => f.initiative));
  fighters.forEach(f => {
    if (!f.has_amulette_tortue) return;
    const isStrictlyLowest =
      f.initiative === minInit &&
      fighters.every(o => o === f || o.initiative > f.initiative);
    if (isStrictlyLowest) {
      f.amulette_tortue_active = true;
      recipients.push(f);
    }
  });
  return recipients;
};

// 🐢 Applique -25% sur le dégât reçu si la cible bénéficie de l'amulette.
// Math.round pour un arrondi équilibré, min 1 pour ne jamais annuler un coup.
const reduceDamageIfTurtle = (target, rawDamage) => {
  if (!target || !target.amulette_tortue_active || rawDamage <= 0) return rawDamage;
  return Math.max(1, Math.round(rawDamage * 0.75));
};

// 🧅 Marque les combattants survivants qui bénéficient du bonus de dégâts.
// Le porteur doit avoir l'amulette ET il doit y avoir au moins 2 aventuriers dans le combat.
const applyAmuletteOignonBonus = (fighters) => {
  const recipients = [];
  if (!fighters || fighters.length === 0) return recipients;

  const survivors = fighters.filter(f => f.type === 'survivor');
  if (survivors.length < 2) return recipients;

  survivors.forEach(f => {
    if (!f.has_amulette_oignon) return;
    f.amulette_oignon_active = true;
    recipients.push(f);
  });
  return recipients;
};

// 🧅 Applique +50% sur les dégâts infligés si l'attaquant bénéficie de l'amulette.
// Math.round pour un arrondi équilibré, min 1 pour ne jamais annuler un coup.
const amplifyDamageIfOnion = (attacker, rawDamage) => {
  if (!attacker || !attacker.amulette_oignon_active || rawDamage <= 0) return rawDamage;
  return Math.max(1, Math.round(rawDamage * 1.5));
};

// 🍀 Amulette Chanceuse — flag les porteurs comme actifs en combat (le malus est appliqué
// au moment où ils SUBISSENT des dégâts, via amplifyDamageTakenIfClover).
const applyAmuletteTrefleMalus = (fighters) => {
  const recipients = [];
  if (!fighters || fighters.length === 0) return recipients;
  fighters.forEach(f => {
    if (f.type !== 'survivor' || !f.has_amulette_trefle) return;
    f.amulette_trefle_active = true;
    recipients.push(f);
  });
  return recipients;
};

// 🍀 Applique +50% sur les dégâts SUBIS si la cible porte l'amulette chanceuse.
// Math.round pour un arrondi équilibré, min 1 pour ne jamais annuler un coup.
const amplifyDamageTakenIfClover = (target, rawDamage) => {
  if (!target || !target.amulette_trefle_active || rawDamage <= 0) return rawDamage;
  return Math.max(1, Math.round(rawDamage * 1.5));
};

// 🏴 Foulard Rankyr — flag les porteurs comme actifs en début de combat.
// Le bonus reste actif tant que le porteur n'a subi aucun dégât durant CE combat.
const applyFoulardRankyrBonus = (fighters) => {
  const recipients = [];
  if (!fighters || fighters.length === 0) return recipients;
  fighters.forEach(f => {
    if (f.type !== 'survivor' || !f.has_foulard_rankyr) return;
    f.foulard_rankyr_active = true;
    recipients.push(f);
  });
  return recipients;
};

// 🏴 Applique +50% sur les dégâts infligés si l'attaquant bénéficie du foulard
// (c'est-à-dire tant qu'il n'a pas encore subi de dégâts dans ce combat).
// Math.round pour un arrondi équilibré, min 1 pour ne jamais annuler un coup.
const amplifyDamageIfFoulard = (attacker, rawDamage) => {
  if (!attacker || !attacker.foulard_rankyr_active || rawDamage <= 0) return rawDamage;
  return Math.max(1, Math.round(rawDamage * 1.5));
};

// 🏴 Désactive le bonus du Foulard Rankyr dès que son porteur subit des dégâts.
// À appeler chaque fois qu'un combattant ENCAISSE des dégâts (damage > 0).
const breakFoulardRankyrIfHit = (target, damageTaken) => {
  if (!target || target.type !== 'survivor' || !target.foulard_rankyr_active) return;
  if (damageTaken > 0) {
    target.foulard_rankyr_active = false;
  }
};

// 🥥 Amulette Coco de Bouchou — +75% sur les dégâts infligés si le porteur est
// actuellement sous 30% de ses PV max. Réévalué à chaque attaque (pas de flag figé :
// si le porteur est soigné au-dessus du seuil, le bonus cesse de s'appliquer).
// Math.round pour un arrondi équilibré, min 1 pour ne jamais annuler un coup.
const amplifyDamageIfCoco = (attacker, rawDamage) => {
  if (!attacker || !attacker.has_amulette_coco || rawDamage <= 0) return rawDamage;
  const maxHp = attacker.maxHp || 1;
  const hpRatio = attacker.hp / maxHp;
  if (hpRatio >= 0.3) return rawDamage;
  return Math.max(1, Math.round(rawDamage * 1.75));
};

// 🎯 Bandana de Ranja — flag les porteurs ayant l'initiative STRICTEMENT la plus
// haute du combat (tous types de combattants confondus : aventuriers, gobelins,
// mimic, cristal...). Le bonus, une fois posé, dure pour tout le reste du combat
// (jamais retiré, contrairement au Foulard Rankyr).
const applyBandanaRanjaBonus = (fighters) => {
  const recipients = [];
  if (!fighters || fighters.length < 2) return recipients;

  const maxInit = Math.max(...fighters.map(f => f.initiative));
  fighters.forEach(f => {
    if (f.type !== 'survivor' || !f.has_bandana_ranja) return;
    const isStrictlyHighest =
      f.initiative === maxInit &&
      fighters.every(o => o === f || o.initiative < f.initiative);
    if (isStrictlyHighest) {
      f.bandana_ranja_active = true;
      recipients.push(f);
    }
  });
  return recipients;
};

// 🎯 Applique +50% sur les dégâts infligés si l'attaquant bénéficie du Bandana
// de Ranja (effet figé pour tout le combat, posé une seule fois en début de combat).
// Math.round pour un arrondi équilibré, min 1 pour ne jamais annuler un coup.
const amplifyDamageIfRanja = (attacker, rawDamage) => {
  if (!attacker || !attacker.bandana_ranja_active || rawDamage <= 0) return rawDamage;
  return Math.max(1, Math.round(rawDamage * 1.5));
};

// 🌸 Bonnet Croblow — flag les porteurs comme actifs en début de combat.
// À chaque attaque du porteur, 10% des dégâts infligés sont convertis en soin
// pour TOUS les aventuriers vivants du combat.
const applyBonnetCroblowBonus = (fighters) => {
  const recipients = [];
  if (!fighters || fighters.length === 0) return recipients;
  fighters.forEach(f => {
    if (f.type !== 'survivor' || !f.has_bonnet_croblow) return;
    f.bonnet_croblow_active = true;
    recipients.push(f);
  });
  return recipients;
};

// 🌸 Calcule le soin à distribuer à tous les aventuriers vivants quand
// l'attaquant porteur du Bonnet Croblow inflige des dégâts.
// Retourne 0 si l'attaquant ne porte pas le bonnet ou si les dégâts sont nuls.
const healAmountIfCroblow = (attacker, damageDone) => {
  if (!attacker || !attacker.bonnet_croblow_active || damageDone <= 0) return 0;
  return Math.max(1, Math.round(damageDone * 0.1));
};

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
  const [initiativeIndicators, setInitiativeIndicators] = useState({});

  // Initialiser les combattants avec initiative
  useEffect(() => {
    const fighters = [];
    
    // Ajouter les aventuriers
    event.survivors.forEach((survivor, idx) => {
      // NEW: récupérer les bonus individuels de cet aventurier
      const initiativeBonus = survivor.initiative_bonus || 0;
      let damageBonus = survivor.damage_bonus || 0;
      const baseInitiative = Math.floor((hashCode(survivor.id + event.attacker_id + (event.combat_id || event.turn || Date.now())) % 20) + 1);

      // NEW: Toxine incapacitante — réduction de 50% des dégâts si le survivant est empoisonné
      let poisonDamageMalus = false;
      if (event.toxine_incapacitante_active && (survivor.poisoned_countdown || 0) > 0) {
        poisonDamageMalus = true;
      }

      fighters.push({
        id: survivor.id,
        name: survivor.name,
        class: survivor.class,
        type: 'survivor',
        hp: survivor.hp,
        maxHp: survivor.max_hp || survivor.hp, // NEW: utilise max_hp pour la barre de vie
        initiative: baseInitiative + initiativeBonus, // NEW: + bonus d'initiative individuel
        damageBonus: damageBonus, // NEW: stocké sur le combattant pour le calcul des dégâts
        poisonDamageMalus: poisonDamageMalus, // NEW: toxine incapacitante malus
        position: idx, // Position 0-3
        alive: true,
        currentAnimation: 'idle',
        has_amulette_tortue: !!survivor.has_amulette_tortue,   // 🐢 NEW
        has_amulette_oignon: !!survivor.has_amulette_oignon,   // 🧅 NEW
        has_amulette_trefle: !!survivor.has_amulette_trefle,   // 🍀 NEW
        has_foulard_rankyr: !!survivor.has_foulard_rankyr,     // 🏴 NEW
        has_amulette_coco: !!survivor.has_amulette_coco,       // 🥥 NEW
        has_bandana_ranja: !!survivor.has_bandana_ranja,       // 🎯 NEW
        has_bonnet_croblow: !!survivor.has_bonnet_croblow,     // 🌸 NEW
      });
    });
    
    // Ajouter les ennemis (gobelins OU mimic selon combat_type)
    const isMimic = event.combat_type === 'mimic';
    const enemyCount = isMimic ? 1 : event.num_goblins;
    for (let i = 0; i < enemyCount; i++) {
      fighters.push({
        id: isMimic ? 'mimic' : `goblin_${i}`,
        name: isMimic ? 'Mimic' : `Gobelin ${i + 1}`,
        class: isMimic ? 'Mimic' : 'Goblin',
        type: isMimic ? 'mimic' : 'goblin',
        hp: isMimic ? event.mimic_hp : event.goblin_hp,
        maxHp: isMimic ? event.mimic_hp : event.goblin_hp,
        initiative: Math.floor((hashCode((isMimic ? 'mimic' : `goblin_${i}`) + event.attacker_id + (event.combat_id || event.turn || Date.now())) % 20) + 1) + (isMimic ? 0 : (event.goblin_initiative_bonus || 0)),
        position: i, // Position 0-3
        alive: true,
        currentAnimation: 'idle'
      });
    }
    
    // Trier par initiative (du plus haut au plus bas)
    fighters.sort((a, b) => b.initiative - a.initiative);

    // 🍀 Amulette Chanceuse : applique le malus -50% HP AVANT toute autre logique
    const cloverRecipients = applyAmuletteTrefleMalus(fighters);
    // 🐢 Amulette Tortue : flag les bénéficiaires
    const amuletteRecipients = applyAmuletteTortueBonus(fighters);
    // 🧅 Amulette Oignon : flag les bénéficiaires
    const onionRecipients = applyAmuletteOignonBonus(fighters);
    // 🏴 Foulard Rankyr : flag les bénéficiaires (actif tant qu'aucun dégât subi)
    const foulardRecipients = applyFoulardRankyrBonus(fighters);
    // 🎯 Bandana de Ranja : flag le/les porteur(s) avec l'initiative strictement la plus haute
    const ranjaRecipients = applyBandanaRanjaBonus(fighters);
    // 🌸 Bonnet Croblow : flag les porteurs (soin 10% dégâts infligés)
    const croblowRecipients = applyBonnetCroblowBonus(fighters);

    setCombatants(fighters);
    
    const initLog = [`⚔️ Combat commencé ! Ordre d'initiative :`];
    fighters.forEach(f => {
      initLog.push(`${f.name} (${f.initiative})`);
    });
    amuletteRecipients.forEach(f => {
      initLog.push(`🐢 ${f.name} a la plus basse initiative — Amulette Tortue active : dégâts reçus -25% !`);
    });
    onionRecipients.forEach(f => {
      initLog.push(`🧅 ${f.name} — Amulette Oignon active : dégâts infligés +50% !`);
    });
    cloverRecipients.forEach(f => {
      initLog.push(`🍀 ${f.name} — Amulette Chanceuse active : dégâts subis +50% pour ce combat !`);
    });
    foulardRecipients.forEach(f => {
      initLog.push(`🏴 ${f.name} — Foulard Rankyr actif : dégâts infligés +50% tant qu'aucun dégât n'est subi !`);
    });
    ranjaRecipients.forEach(f => {
      initLog.push(`🎯 ${f.name} a la plus haute initiative — Bandana de Ranja actif : dégâts infligés +50% pour tout le combat !`);
    });
    fighters.filter(f => f.type === 'survivor' && f.has_amulette_coco).forEach(f => {
      initLog.push(`🥥 ${f.name} porte l'Amulette Coco de Bouchou : dégâts infligés +75% sous 30% de PV !`);
    });
    croblowRecipients.forEach(f => {
      initLog.push(`🌸 ${f.name} — Bonnet Croblow actif : 10% des dégâts infligés soignent tous les aventuriers !`);
    });
    setCombatLog(initLog);

    const initiatives = {};
    fighters.forEach(f => { initiatives[f.id] = f.initiative; });
    setInitiativeIndicators(initiatives);
    setTimeout(() => setInitiativeIndicators({}), 2000);
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
        const aliveGoblins = fighters.filter(f => (f.type === 'goblin' || f.type === 'mimic') && f.alive);
        
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
              if (event.combat_type === 'mimic') {
                await axios.post(`${API}/game/${sessionId}/resolve_mimic_combat`, {
                  survivors_results: survivorsResults,
                  mimic_defeated: aliveGoblins.length === 0, // ici aliveGoblins contient le mimic
                  combat_log: combatLog
                });
              } else {
                await axios.post(`${API}/game/${sessionId}/resolve_multiplayer_combat`, {
                  attacker_id: event.attacker_id,
                  survivors_results: survivorsResults,
                  goblins_defeated: goblinsDefeated,
                  combat_log: combatLog
                });
              }
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
        const targets = fighters.filter(f => {
          if (!f.alive) return false;
          if (attacker.type === 'survivor') return f.type === 'goblin' || f.type === 'mimic';
          return f.type === 'survivor';
        });
        
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
        // GOBLIN ROULETTE: si l'attaquant est un gobelin, on ajoute le bonus de dégâts de la roulette
        const bonusDamage = (attacker.type === 'survivor' && attacker.damageBonus)
          ? attacker.damageBonus
          : (attacker.type === 'goblin' ? (event.goblin_damage_bonus || 0) : 0);
        let damage = baseDamage + bonusDamage;
        // NEW: Toxine incapacitante — dégâts réduits de moitié (arrondi supérieur)
        if (attacker.type === 'survivor' && attacker.poisonDamageMalus) {
          damage = Math.ceil(damage / 2);
        }
        // 🧅 Amulette Oignon — +50% si l'attaquant survivant est éligible (plusieurs aventuriers)
        const rawDamageBeforeOnion = damage;
        if (attacker.type === 'survivor') {
          damage = amplifyDamageIfOnion(attacker, damage);
        }
        // 🏴 Foulard Rankyr — +50% si l'attaquant n'a pas encore subi de dégâts ce combat
        const rawDamageBeforeFoulard = damage;
        if (attacker.type === 'survivor') {
          damage = amplifyDamageIfFoulard(attacker, damage);
        }
        // 🥥 Amulette Coco de Bouchou — +75% si l'attaquant est sous 30% de ses PV max
        const rawDamageBeforeCoco = damage;
        if (attacker.type === 'survivor') {
          damage = amplifyDamageIfCoco(attacker, damage);
        }
        // 🎯 Bandana de Ranja — +50% si l'attaquant a la plus haute initiative (figé tout le combat)
        const rawDamageBeforeRanja = damage;
        if (attacker.type === 'survivor') {
          damage = amplifyDamageIfRanja(attacker, damage);
        }
        // 🐢 Amulette Tortue — réduction de 25% si la cible est un survivant éligible
        const rawDamageForTurtle = damage;
        if (target.type === 'survivor') {
          damage = reduceDamageIfTurtle(target, damage);
        }
        // 🍀 Amulette Chanceuse — +50% sur les dégâts subis par la cible
        const rawDamageBeforeClover = damage;
        if (target.type === 'survivor') {
          damage = amplifyDamageTakenIfClover(target, damage);
        }
        target.hp = Math.max(0, target.hp - damage);
        
        if (target.hp <= 0) {
          target.alive = false;
        }

        // 🏴 La cible vient de subir des dégâts : son Foulard Rankyr (si actif) se désactive
        const targetFoulardWasActive = target.type === 'survivor' && target.foulard_rankyr_active;
        breakFoulardRankyrIfHit(target, damage);

        // 🌸 Bonnet Croblow — soin 10% des dégâts infligés pour tous les aventuriers vivants
        if (attacker.type === 'survivor') {
          const croblowHeal = healAmountIfCroblow(attacker, damage);
          if (croblowHeal > 0) {
            const healedNames = [];
            fighters.filter(f => f.type === 'survivor' && f.alive).forEach(f => {
              const before = f.hp;
              f.hp = Math.min(f.maxHp, f.hp + croblowHeal);
              if (f.hp > before) healedNames.push(f.name);
              setDamageIndicators(prev => ({ ...prev, [f.id + '_heal']: { heal: croblowHeal, timestamp: Date.now() } }));
              setTimeout(() => {
                setDamageIndicators(prev => { const n = { ...prev }; delete n[f.id + '_heal']; return n; });
              }, 1500);
            });
            if (healedNames.length > 0) {
              setCombatLog(prev => [...prev, `🌸 ${attacker.name} soigne l'équipe de +${croblowHeal} PV (Bonnet Croblow) ! [${healedNames.join(', ')}]`]);
            }
          }
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
        let logEntry;
        if (target.type === 'survivor' && damage > rawDamageBeforeClover) {
          logEntry = `🍀 ${attacker.name} inflige ${damage} dégâts à ${target.name} (🍀 +50%, ${rawDamageBeforeClover}→${damage}) ! (${target.hp}/${target.maxHp} HP)`;
        } else if (target.type === 'survivor' && damage < rawDamageForTurtle) {
          logEntry = `🩸 ${attacker.name} inflige ${damage} dégâts à ${target.name} (🐢 -25%, ${rawDamageForTurtle}→${damage}) ! (${target.hp}/${target.maxHp} HP)`;
        } else if (attacker.type === 'survivor' && attacker.has_amulette_coco && damage > rawDamageBeforeCoco) {
          logEntry = `🥥 ${attacker.name} inflige ${damage} dégâts à ${target.name} (🥥 +75%, ${rawDamageBeforeCoco}→${damage}) ! (${target.hp}/${target.maxHp} HP)`;
        } else if (attacker.type === 'survivor' && attacker.bandana_ranja_active && damage > rawDamageBeforeRanja) {
          logEntry = `🎯 ${attacker.name} inflige ${damage} dégâts à ${target.name} (🎯 +50%, ${rawDamageBeforeRanja}→${damage}) ! (${target.hp}/${target.maxHp} HP)`;
        } else if (attacker.type === 'survivor' && attacker.foulard_rankyr_active && damage > rawDamageBeforeFoulard) {
          logEntry = `🏴 ${attacker.name} inflige ${damage} dégâts à ${target.name} (🏴 +50%, ${rawDamageBeforeFoulard}→${damage}) ! (${target.hp}/${target.maxHp} HP)`;
        } else if (attacker.type === 'survivor' && attacker.amulette_oignon_active && damage > rawDamageBeforeOnion) {
          logEntry = `🧅 ${attacker.name} inflige ${damage} dégâts à ${target.name} (🧅 +50%, ${rawDamageBeforeOnion}→${damage}) ! (${target.hp}/${target.maxHp} HP)`;
        } else {
          logEntry = `${attacker.name} attaque ${target.name} : ${damage} dégâts ! (${target.hp}/${target.maxHp} HP)`;
        }
        setCombatLog(prev => [...prev, logEntry]);
        // 🏴 Le Foulard Rankyr de la cible vient de se rompre : message dédié
        if (damage > 0 && targetFoulardWasActive && !target.foulard_rankyr_active) {
          setCombatLog(prev => [...prev, `🏴 ${target.name} a subi des dégâts — l'effet du Foulard Rankyr est rompu pour ce combat.`]);
        }
        
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
    if (combatant.type === 'mimic') {
      return `/fight/Mimic_${animationType}.webp`;
    }
    if (combatant.type === 'goblin') {
      return `/fight/Goblin_${animationType}.webp`;
    }
    return `/fight/${combatant.class}_${animationType}.webp`;
  };

  // Fonction pour obtenir les paramètres de sprite sheet (UNIFORMISÉS)
  const getSpriteParams = (combatant, animationType) => {
    if (combatant.type === 'mimic') {
      switch (animationType) {
        case 'idle':    return { cols: 5, rows: 6, totalFrames: 30 };
        case 'attack':  return { cols: 5, rows: 4, totalFrames: 20 };
        case 'hurt':    return { cols: 5, rows: 2, totalFrames: 10 };
        case 'fainted': return { cols: 5, rows: 4, totalFrames: 20 };
        default:        return { cols: 5, rows: 6, totalFrames: 30 };
      }
    }
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
        {/* GOBLIN ROULETTE: bannière "Gobelin Renforcé" si le killer a boosté ses stats */}
        {event.combat_type !== 'mimic' &&
         ((event.goblin_hp || 6) > 6 || (event.goblin_damage_bonus || 0) > 0 || (event.goblin_initiative_bonus || 0) > 0) && (
          <div style={{
            position: 'absolute',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '2px solid #ef4444',
            borderRadius: '8px',
            padding: '0.5rem 1rem',
            zIndex: 20,
          }} data-testid="goblin-reinforced-banner">
            <div style={{ color: '#ef4444', fontWeight: 'bold', marginBottom: '0.25rem', textAlign: 'center' }}>
              ⚡ Gobelin Renforcé
            </div>
            <div style={{ display: 'flex', gap: '1.5rem', color: '#e8dcc4', fontSize: '0.9rem' }}>
              <span>❤️ {event.goblin_hp || 6} PV</span>
              <span>🗡️ {1 + (event.goblin_damage_bonus || 0)}-{6 + (event.goblin_damage_bonus || 0)} dégâts</span>
              <span>⚡ +{event.goblin_initiative_bonus || 0} initiative</span>
            </div>
          </div>
        )}

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
                cols={spriteParams.cols}
                rows={spriteParams.rows}
                frameDuration={animationType === 'attack' ? 33 : animationType === 'hurt' ? 80 : animationType === 'fainted' ? 100 : 100}
                loop={animationType === 'idle'}
              />

              {/* 🐢 Amulette Tortue active : effet visuel "buff" qui fade vers le haut */}
              {combatant.amulette_tortue_active && (
                <img
                  src={ITEM_SPRITES.amulette_tortue}
                  alt="Amulette Tortue active"
                  className="amulette-tortue-buff"
                  data-testid={`amulette-tortue-buff-${combatant.id}`}
                />
              )}

              {/* 🧅 Amulette Oignon active : effet visuel "buff" qui fade vers le haut */}
              {combatant.amulette_oignon_active && (
                <img
                  src={ITEM_SPRITES.amulette_oignon}
                  alt="Amulette Oignon active"
                  className="amulette-oignon-buff"
                  data-testid={`amulette-oignon-buff-${combatant.id}`}
                />
              )}

              {/* 🍀 Amulette Chanceuse active : effet visuel "buff" qui fade vers le haut */}
              {combatant.amulette_trefle_active && (
                <img
                  src={ITEM_SPRITES.amulette_trefle}
                  alt="Amulette Chanceuse active"
                  className="amulette-trefle-buff"
                  data-testid={`amulette-trefle-buff-${combatant.id}`}
                />
              )}

              {/* 🏴 Foulard Rankyr actif : effet visuel "buff" qui fade vers le haut */}
              {combatant.foulard_rankyr_active && (
                <img
                  src={ITEM_SPRITES.foulard_rankyr}
                  alt="Foulard Rankyr actif"
                  className="amulette-oignon-buff"
                  data-testid={`foulard-rankyr-buff-${combatant.id}`}
                />
              )}

              {/* 🥥 Amulette Coco active : sous 30% PV, effet visuel "buff" qui fade vers le haut */}
              {combatant.type === 'survivor' && combatant.has_amulette_coco && (combatant.hp / (combatant.maxHp || 1)) < 0.3 && (
                <img
                  src={ITEM_SPRITES.amulette_coco}
                  alt="Amulette Coco active"
                  className="amulette-oignon-buff"
                  data-testid={`amulette-coco-buff-${combatant.id}`}
                />
              )}

              {/* 🎯 Bandana de Ranja actif : effet visuel "buff" qui fade vers le haut */}
              {combatant.bandana_ranja_active && (
                <img
                  src={ITEM_SPRITES.bandana_ranja}
                  alt="Bandana de Ranja actif"
                  className="amulette-oignon-buff"
                  data-testid={`bandana-ranja-buff-${combatant.id}`}
                />
              )}

              {/* 🌸 Bonnet Croblow actif : effet visuel "buff" qui fade vers le haut */}
              {combatant.bonnet_croblow_active && (
                <img
                  src={ITEM_SPRITES.bonnet_croblow}
                  alt="Bonnet Croblow actif"
                  className="amulette-oignon-buff"
                  data-testid={`bonnet-croblow-buff-${combatant.id}`}
                />
              )}

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
              {/* 🌸 Indicateur de soin Bonnet Croblow (vert) */}
              {damageIndicators[combatant.id + '_heal'] && (
                <div style={{
                  position: 'absolute',
                  top: '-55px',
                  left: '50%',
                  transform: 'translateX(-50%) scaleX(-1)',
                  fontSize: '22px',
                  fontWeight: 'bold',
                  color: '#22c55e',
                  textShadow: '2px 2px 4px #000',
                  animation: 'floatUp 1.5s ease-out',
                  pointerEvents: 'none',
                  zIndex: 1001
                }}>
                  +{damageIndicators[combatant.id + '_heal'].heal} 🌸
                </div>
              )}
              {initiativeIndicators[combatant.id] !== undefined && (
                <div
                  data-testid={`initiative-indicator-${combatant.id}`}
                  style={{
                    position: 'absolute',
                    top: '-40px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    color: '#3b82f6',
                    fontSize: '1.8rem',
                    fontWeight: 'bold',
                    textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                    pointerEvents: 'none',
                    animation: 'initiativeFadeUp 2s ease-out forwards',
                    zIndex: 10,
                  }}
                >
                  🎲 {combatant.initiative}
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
        {combatants.filter(c => c.type === 'goblin' || c.type === 'mimic').map((combatant, idx) => {
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
                cols={spriteParams.cols}
                rows={spriteParams.rows}
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
              {initiativeIndicators[combatant.id] !== undefined && (
                <div
                  data-testid={`initiative-indicator-${combatant.id}`}
                  style={{
                    position: 'absolute',
                    top: '-40px',
                    left: '50%',
                    transform: 'translateX(-50%) scaleX(-1)',
                    color: '#3b82f6',
                    fontSize: '1.8rem',
                    fontWeight: 'bold',
                    textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                    pointerEvents: 'none',
                    animation: 'initiativeFadeUp 2s ease-out forwards',
                    zIndex: 10,
                  }}
                >
                  🎲 {combatant.initiative}
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

// ========== MIMIC COMBAT COMPONENT ==========
// ========== COMBAT HELP WINDOW COMPONENTS ==========

const CombatHelpWaitingOverlay = ({ data, participants, players, playerId, onExpire }) => {
  const [timeLeft, setTimeLeft] = useState(10);

  useEffect(() => {
    const update = () => {
      const remaining = Math.max(0, data.expires_at - Date.now() / 1000);
      setTimeLeft(remaining);
      if (remaining <= 0) {
        // Laisser une petite marge pour que le backend ait fini d'envoyer le combat
        setTimeout(() => onExpire && onExpire(), 500);
      }
    };
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [data.expires_at, onExpire]);

  return (
    <div
      data-testid="combat-help-waiting-overlay"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#1a1208', border: '3px solid #d4af37', borderRadius: 16,
        padding: '2rem 3rem', maxWidth: 600, textAlign: 'center', color: '#fff',
      }}>
        <h2 style={{ color: '#d4af37', fontSize: '1.8rem', marginBottom: '1rem' }}>
          {data.combat_type === "crystal" ? "💎 Assaut sur le Cristal — En attente" : "💰 Combat Mimic — En attente"}
        </h2>
        <p style={{ fontSize: '1.1rem', marginBottom: '1.5rem' }}>
          Vos alliés peuvent vous rejoindre dans <strong>{data.room}</strong>...
        </p>

        <div style={{
          fontSize: '3rem', fontWeight: 'bold', color: '#ff7a18',
          margin: '1rem 0',
        }}>
          {timeLeft.toFixed(1)}s
        </div>
        <div style={{
          width: '100%', height: 8, background: '#333', borderRadius: 4,
          overflow: 'hidden', marginBottom: '1.5rem',
        }}>
          <div style={{
            width: `${(timeLeft / 10) * 100}%`, height: '100%',
            background: 'linear-gradient(90deg, #ff7a18, #ffd166)',
            transition: 'width 0.1s linear',
          }} />
        </div>

        <h3 style={{ color: '#ffd166', marginBottom: '0.5rem' }}>Participants</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'center' }}>
          {participants.map(pid => {
            const p = players[pid];
            const isMe = pid === playerId;
            const displayName = p?.name || pid;
            return (
              <div key={pid} style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                background: '#2a1f17', padding: '0.5rem 1rem', borderRadius: 8,
                border: isMe ? '2px solid #d4af37' : '1px solid #555',
              }}>
                {p?.avatar && <img src={p.avatar} alt={displayName} style={{ width: 32, height: 32, borderRadius: '50%' }} />}
                <span>👤 {displayName} {isMe ? '(vous)' : '(a rejoint !)'}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const CombatHelpAvailablePopup = ({ data, ws, onClose }) => {
  const [timeLeft, setTimeLeft] = useState(10);

  useEffect(() => {
    const update = () => {
      const remaining = Math.max(0, data.expires_at - Date.now() / 1000);
      setTimeLeft(remaining);
      if (remaining <= 0) onClose();
    };
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [data.expires_at, onClose]);

  const handleJoin = () => {
    if (ws?.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "action",
        action: { type: "join_combat", attacker_id: data.attacker_id },
      }));
    }
  };

  return (
    <div
      onClick={onClose}
      data-testid="combat-help-available-popup"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a1208', border: '2px solid #d4af37', borderRadius: 12,
          padding: '1.5rem 2rem', maxWidth: 420, color: '#fff', textAlign: 'center',
        }}
      >
        <h3 style={{ color: '#d4af37', marginBottom: '0.8rem' }}>
          {data.combat_type === "crystal"
            ? `💎 ${data.attacker_name} attaque le Cristal dans ${data.room} !`
            : `⚔️ ${data.attacker_name} combat un Mimic dans ${data.room} !`}
        </h3>
        <p style={{ marginBottom: '0.8rem', fontSize: '0.95rem', color: '#ccc' }}>
          {data.combat_type === "crystal"
            ? (data.crystal_hp != null
                ? `Rejoignez l'assaut pour aider votre allié. (${data.crystal_hp}/${data.crystal_max_hp} HP)`
                : `Rejoignez l'assaut pour aider votre allié.`)
            : "Rejoignez le combat pour aider votre allié."}
        </p>
        <div style={{ fontWeight: 'bold', fontSize: '1.4rem', color: '#ff7a18', marginBottom: '0.4rem' }}>
          {timeLeft.toFixed(1)}s
        </div>
        <div style={{ width: '100%', height: 6, background: '#333', borderRadius: 3, overflow: 'hidden', marginBottom: '1rem' }}>
          <div style={{
            width: `${(timeLeft / 10) * 100}%`, height: '100%',
            background: 'linear-gradient(90deg, #ff7a18, #ffd166)',
            transition: 'width 0.1s linear',
          }} />
        </div>
        <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center' }}>
          <Button
            data-testid="combat-help-join-btn"
            onClick={handleJoin}
            style={{ background: '#10b981', color: '#fff', fontWeight: 'bold', padding: '0.6rem 1.5rem' }}
          >
            Rejoindre
          </Button>
          <Button
            data-testid="combat-help-ignore-btn"
            onClick={onClose}
            style={{ background: '#dc2626', color: '#fff', padding: '0.6rem 1.5rem' }}
          >
            Ignorer
          </Button>
        </div>
      </div>
    </div>
  );
};

const MimicCombat = ({ event, playerId, sessionId, onClose }) => {
  // Rétro-compatibilité : si pas de survivors_data (ancien format 1v1), on en crée un
  const survivorsData = event.survivors_data || [{
    survivor_id: event.survivor_id,
    survivor_name: event.survivor_name,
    survivor_class: event.survivor_class,
    survivor_hp: event.survivor_hp,
    survivor_max_hp: event.survivor_hp,
    survivor_gold: event.survivor_gold,
    initiative_bonus: event.initiative_bonus || 0,
    damage_bonus: 0,
    eboulement_perturbation_active: event.eboulement_perturbation_active || false,
    has_amulette_tortue: !!(event.survivors?.[0]?.has_amulette_tortue),   // 🐢 NEW
    has_amulette_oignon: !!(event.survivors?.[0]?.has_amulette_oignon),   // 🧅 NEW
    has_amulette_trefle: !!(event.survivors?.[0]?.has_amulette_trefle),   // 🍀 NEW
    has_foulard_rankyr: !!(event.survivors?.[0]?.has_foulard_rankyr),     // 🏴 NEW
    has_amulette_coco: !!(event.survivors?.[0]?.has_amulette_coco),       // 🥥 NEW
    has_bandana_ranja: !!(event.survivors?.[0]?.has_bandana_ranja),       // 🎯 NEW
    has_bonnet_croblow: !!(event.survivors?.[0]?.has_bonnet_croblow),     // 🌸 NEW
  }];
  const participants = event.participants || [event.survivor_id];
  // Seul le premier participant (A) exécute la simulation et envoie le résultat
  const isSimulator = participants[0] === playerId;

  // On garde les states de l'ancien format pour le rendu sprite (1er survivant)
  const primarySurvivor = survivorsData[0];
  const [survivorHP, setSurvivorHP] = useState(primarySurvivor.survivor_hp);
  const [survivorGold, setSurvivorGold] = useState(primarySurvivor.survivor_gold);
  const [mimicHP, setMimicHP] = useState(event.mimic_hp);
  const [combatLog, setCombatLog] = useState([]);
  const [combatOver, setCombatOver] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [animatingEntity, setAnimatingEntity] = useState(null);
  const [totalDamageTaken, setTotalDamageTaken] = useState(0);
  const [totalGoldStolen, setTotalGoldStolen] = useState(0);
  const [mimicDefeated, setMimicDefeated] = useState(false);
  const [damageIndicator, setDamageIndicator] = useState(null);
  const [initiativeIndicators, setInitiativeIndicators] = useState({});
  // 🐢 Effet visuel "buff" Amulette Tortue (rendu indépendant des mutations de closure)
  const [amuletteBuffActive, setAmuletteBuffActive] = useState(false);
  // 🧅 Effet visuel "buff" Amulette Oignon
  const [onionBuffActive, setOnionBuffActive] = useState(false);
  // 🍀 Effet visuel "malus" Amulette Chanceuse
  const [cloverBuffActive, setCloverBuffActive] = useState(false);
  // 🏴 Effet visuel "buff" Foulard Rankyr
  const [foulardBuffActive, setFoulardBuffActive] = useState(false);
  // 🎯 Effet visuel "buff" Bandana de Ranja
  const [ranjaBuffActive, setRanjaBuffActive] = useState(false);
  // 🌸 Effet visuel "buff" Bonnet Croblow
  const [croblowBuffActive, setCroblowBuffActive] = useState(false);

  const getSurvivorSpriteSheet = (animationType) => {
    return `/fight/${primarySurvivor.survivor_class}_${animationType}.webp`;
  };

  const getMimicSpriteSheet = (animationType) => {
    return `/fight/Mimic_${animationType}.webp`;
  };

  const getSpriteParams = (entityType, animationType) => {
    if (entityType === 'mimic') {
      switch (animationType) {
        case 'idle': return { cols: 5, rows: 6, totalFrames: 30 };
        case 'attack': return { cols: 5, rows: 4, totalFrames: 20 };
        case 'hurt': return { cols: 5, rows: 2, totalFrames: 10 };
        case 'fainted': return { cols: 5, rows: 4, totalFrames: 20 };
        default: return { cols: 5, rows: 6, totalFrames: 30 };
      }
    } else {
      switch (animationType) {
        case 'idle': return { cols: 5, rows: 6, totalFrames: 30 };
        case 'attack': return { cols: 5, rows: 6, totalFrames: 30 };
        case 'hurt': return { cols: 5, rows: 2, totalFrames: 10 };
        default: return { cols: 5, rows: 6, totalFrames: 30 };
      }
    }
  };

  useEffect(() => {
    let mounted = true;

    const runCombat = async () => {
      let currentSurvivorHP = primarySurvivor.survivor_hp;
      let currentMimicHP = event.mimic_hp;
      let currentGold = primarySurvivor.survivor_gold;
      let goldStolen = 0;
      let damageTaken = 0;

      const initiativeBonus = primarySurvivor.initiative_bonus || 0;
      const survivorInitiative = Math.floor(Math.random() * 20) + 1 + initiativeBonus;
      const mimicInitiative = Math.floor(Math.random() * 20) + 1;

      // 🐢 Active le flag si init strictement plus basse
      if (primarySurvivor.has_amulette_tortue && survivorInitiative < mimicInitiative) {
        primarySurvivor.amulette_tortue_active = true;
        setAmuletteBuffActive(true);
      }
      // 🧅 Active le flag si plusieurs aventuriers participent au combat
      if (primarySurvivor.has_amulette_oignon && participants.length >= 2) {
        primarySurvivor.amulette_oignon_active = true;
        setOnionBuffActive(true);
      }
      // 🍀 Active le flag si le porteur a l'amulette (toujours actif en combat)
      if (primarySurvivor.has_amulette_trefle) {
        primarySurvivor.amulette_trefle_active = true;
        setCloverBuffActive(true);
      }
      // 🏴 Active le flag si le porteur a le foulard (toujours actif tant qu'aucun dégât subi)
      if (primarySurvivor.has_foulard_rankyr) {
        primarySurvivor.foulard_rankyr_active = true;
        setFoulardBuffActive(true);
      }
      // 🎯 Active le flag si init strictement plus haute (figé pour tout le combat)
      if (primarySurvivor.has_bandana_ranja && survivorInitiative > mimicInitiative) {
        primarySurvivor.bandana_ranja_active = true;
        setRanjaBuffActive(true);
      }
      // 🌸 Active le Bonnet Croblow (toujours actif en combat dès que porté)
      if (primarySurvivor.has_bonnet_croblow) {
        primarySurvivor.bonnet_croblow_active = true;
        setCroblowBuffActive(true);
      }

      const log = [`⚔️ Combat contre le Mimic !`];
      if (primarySurvivor.eboulement_perturbation_active) {
        log.push(`⛰️ Perturbation active : initiative -15, dégâts reçus ×2 !`);
      }
      if (participants.length > 1) {
        log.push(`👥 ${participants.length} aventuriers participent au combat !`);
      }
      log.push(`Initiative : ${primarySurvivor.survivor_class} (${survivorInitiative}) vs Mimic (${mimicInitiative})`);
      if (primarySurvivor.amulette_tortue_active) {
        log.push(`🐢 Amulette Tortue active : dégâts reçus -25% pour ce combat !`);
      }
      if (primarySurvivor.amulette_oignon_active) {
        log.push(`🧅 Amulette Oignon active : dégâts infligés +50% pour ce combat !`);
      }
      if (primarySurvivor.amulette_trefle_active) {
        log.push(`🍀 Amulette Chanceuse active : dégâts subis +50% pour ce combat !`);
      }
      if (primarySurvivor.foulard_rankyr_active) {
        log.push(`🏴 Foulard Rankyr actif : dégâts infligés +50% tant qu'aucun dégât n'est subi !`);
      }
      if (primarySurvivor.bandana_ranja_active) {
        log.push(`🎯 Bandana de Ranja actif : dégâts infligés +50% pour tout le combat !`);
      }
      if (primarySurvivor.bonnet_croblow_active) {
        log.push(`🌸 Bonnet Croblow actif : 10% des dégâts infligés soignent tous les aventuriers !`);
      }
      setCombatLog([...log]);

      setInitiativeIndicators({ [primarySurvivor.survivor_id]: survivorInitiative, mimic: mimicInitiative });
      setTimeout(() => setInitiativeIndicators({}), 2000);

      await new Promise(resolve => setTimeout(resolve, 1500));

      const survivorFirst = survivorInitiative >= mimicInitiative;

      while (mounted && currentSurvivorHP > 0 && currentMimicHP > 0) {
        if (survivorFirst || currentMimicHP > 0) {
          setAnimatingEntity('survivor_attack');
          await new Promise(resolve => setTimeout(resolve, 600));

          // Bonus de dégâts : +1d6 par participant supplémentaire
          const extraDamage = (participants.length - 1) * (Math.floor(Math.random() * 6) + 1);
          let damage = Math.floor(Math.random() * 6) + 1 + extraDamage;
          // 🧅 Amulette Oignon — +50% si éligible
          const rawDamageBeforeOnion = damage;
          damage = amplifyDamageIfOnion(primarySurvivor, damage);
          // 🏴 Foulard Rankyr — +50% si éligible (aucun dégât subi ce combat)
          const rawDamageBeforeFoulard = damage;
          damage = amplifyDamageIfFoulard(primarySurvivor, damage);
          // 🥥 Amulette Coco de Bouchou — +75% si le survivant est sous 30% de ses PV max
          const rawDamageBeforeCoco = damage;
          damage = amplifyDamageIfCoco(
            { hp: currentSurvivorHP, maxHp: primarySurvivor.survivor_max_hp, has_amulette_coco: primarySurvivor.has_amulette_coco },
            damage
          );
          // 🎯 Bandana de Ranja — +50% si éligible (initiative la plus haute, figé tout le combat)
          const rawDamageBeforeRanja = damage;
          damage = amplifyDamageIfRanja(primarySurvivor, damage);
          currentMimicHP = Math.max(0, currentMimicHP - damage);
          setMimicHP(currentMimicHP);

          // 🌸 Bonnet Croblow — soin 10% des dégâts infligés pour le(s) aventurier(s)
          const croblowHealMimic = healAmountIfCroblow(primarySurvivor, damage);
          if (croblowHealMimic > 0) {
            const beforeHeal = currentSurvivorHP;
            currentSurvivorHP = Math.min(primarySurvivor.survivor_max_hp, currentSurvivorHP + croblowHealMimic);
            setSurvivorHP(currentSurvivorHP);
            if (currentSurvivorHP > beforeHeal) {
              log.push(`🌸 Bonnet Croblow : +${croblowHealMimic} PV pour ${primarySurvivor.survivor_class} !`);
              setDamageIndicator({ type: 'croblow_heal', value: croblowHealMimic });
              setTimeout(() => setDamageIndicator(null), 1500);
            }
          }

          setAnimatingEntity('mimic_hurt');
          setDamageIndicator({ type: 'damage', value: damage });
          setTimeout(() => setDamageIndicator(null), 1500);

          if (damage > rawDamageBeforeCoco) {
            log.push(`🥥 ${primarySurvivor.survivor_class} attaque : ${damage} dégâts (🥥 +75%, ${rawDamageBeforeCoco}→${damage}) !`);
          } else if (damage > rawDamageBeforeRanja) {
            log.push(`🎯 ${primarySurvivor.survivor_class} attaque : ${damage} dégâts (🎯 +50%, ${rawDamageBeforeRanja}→${damage}) !`);
          } else if (damage > rawDamageBeforeFoulard) {
            log.push(`🏴 ${primarySurvivor.survivor_class} attaque : ${damage} dégâts (🏴 +50%, ${rawDamageBeforeFoulard}→${damage}) !`);
          } else if (damage > rawDamageBeforeOnion) {
            log.push(`⚔️ ${primarySurvivor.survivor_class} attaque : ${damage} dégâts (🧅 +50%, ${rawDamageBeforeOnion}→${damage}) !`);
          } else {
            log.push(`⚔️ ${primarySurvivor.survivor_class} attaque : ${damage} dégâts !`);
          }
          setCombatLog([...log]);

          await new Promise(resolve => setTimeout(resolve, 800));
          setAnimatingEntity(null);

          if (currentMimicHP <= 0) break;
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (currentMimicHP > 0 && currentSurvivorHP > 0) {
          setAnimatingEntity('mimic_attack');
          await new Promise(resolve => setTimeout(resolve, 600));

          const rawMimicDamage = Math.floor(Math.random() * 6) + 1;
          const afterTurtle = reduceDamageIfTurtle(primarySurvivor, rawMimicDamage);
          // 🍀 Amulette Chanceuse — +50% sur les dégâts subis
          const damage = amplifyDamageTakenIfClover(primarySurvivor, afterTurtle);
          currentSurvivorHP = Math.max(0, currentSurvivorHP - damage);
          damageTaken += damage;
          setSurvivorHP(currentSurvivorHP);
          setTotalDamageTaken(damageTaken);

          // 🏴 Le survivant vient de subir des dégâts : son Foulard Rankyr (si actif) se rompt
          if (damage > 0 && primarySurvivor.foulard_rankyr_active) {
            breakFoulardRankyrIfHit(primarySurvivor, damage);
            setFoulardBuffActive(false);
            log.push(`🏴 ${primarySurvivor.survivor_class} a subi des dégâts — l'effet du Foulard Rankyr est rompu pour ce combat.`);
          }

          // 🥥 Le survivant vient de passer sous le seuil de 30% PV : message dédié
          const hpRatioBefore = (currentSurvivorHP + damage) / (primarySurvivor.survivor_max_hp || 1);
          const hpRatioAfter = currentSurvivorHP / (primarySurvivor.survivor_max_hp || 1);
          if (primarySurvivor.has_amulette_coco && hpRatioBefore >= 0.3 && hpRatioAfter < 0.3 && currentSurvivorHP > 0) {
            log.push(`🥥 ${primarySurvivor.survivor_class} passe sous 30% PV — l'Amulette Coco de Bouchou augmente ses dégâts infligés de 75% !`);
          }

          const goldToSteal = Math.floor(currentGold * 0.5);
          currentGold = Math.max(0, currentGold - goldToSteal);
          goldStolen += goldToSteal;
          setSurvivorGold(currentGold);
          setTotalGoldStolen(goldStolen);

          setAnimatingEntity('survivor_hurt');
          setDamageIndicator({ type: 'both', damage: damage, gold: goldToSteal });
          setTimeout(() => setDamageIndicator(null), 1500);

          if (damage > afterTurtle) {
            log.push(`💰 Le Mimic attaque : ${damage} dégâts (🍀 +50%, ${afterTurtle}→${damage}) et vole ${goldToSteal}💰 !`);
          } else if (damage < rawMimicDamage) {
            log.push(`💰 Le Mimic attaque : ${damage} dégâts (🐢 -25%, ${rawMimicDamage}→${damage}) et vole ${goldToSteal}💰 !`);
          } else {
            log.push(`💰 Le Mimic attaque : ${damage} dégâts et vole ${goldToSteal}💰 !`);
          }
          setCombatLog([...log]);

          await new Promise(resolve => setTimeout(resolve, 800));
          setAnimatingEntity(null);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      setCombatOver(true);

      if (currentMimicHP <= 0) {
        setMimicDefeated(true);
        setAnimatingEntity('mimic_fainted');
        log.push(`🎉 Victoire ! Le Mimic est vaincu !`);
      } else {
        setMimicDefeated(false);
        log.push(`💀 Défaite ! Vous avez été vaincu par le Mimic...`);
      }

      setCombatLog([...log]);

      // Seul le premier participant (isSimulator) envoie le résultat au serveur
      if (isSimulator) {
        try {
          // Format multi-participants
          const survivors_results = survivorsData.map(s => ({
            id: s.survivor_id,
            damage_dealt: s.survivor_id === primarySurvivor.survivor_id ? damageTaken : 0,
            gold_stolen: s.survivor_id === primarySurvivor.survivor_id ? goldStolen : 0,
            eliminated: s.survivor_id === primarySurvivor.survivor_id ? currentSurvivorHP <= 0 : false,
          }));
          await axios.post(`${API}/game/${sessionId}/resolve_mimic_combat`, {
            survivors_results,
            mimic_defeated: currentMimicHP <= 0,
            combat_log: log,
          });
        } catch (error) {
          console.error("Erreur lors de la résolution du combat Mimic:", error);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      setCanClose(true);
    };

    runCombat();
    return () => { mounted = false; };
  }, [event, sessionId]);

  return (
    <div
      className="game-over-overlay"
      style={{ zIndex: 3000, cursor: canClose ? "pointer" : "default" }}
      onClick={() => canClose && onClose && onClose()}
      data-testid="mimic-combat"
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
        {/* Survivant (à gauche) */}
        <div style={{
          position: 'absolute',
          left: animatingEntity === 'survivor_attack' ? '30%' : '10%',
          bottom: '35%',
          transition: 'all 0.4s ease-out'
        }}>
          <SpriteSheetAnimator
            spriteSheet={getSurvivorSpriteSheet(
              animatingEntity === 'survivor_attack' ? 'attack' :
              animatingEntity === 'survivor_hurt' ? 'hurt' : 'idle'
            )}
            cols={getSpriteParams('survivor',
              animatingEntity === 'survivor_attack' ? 'attack' :
              animatingEntity === 'survivor_hurt' ? 'hurt' : 'idle'
            ).cols}
            rows={getSpriteParams('survivor',
              animatingEntity === 'survivor_attack' ? 'attack' :
              animatingEntity === 'survivor_hurt' ? 'hurt' : 'idle'
            ).rows}
            frameDuration={animatingEntity === 'survivor_attack' ? 50 : animatingEntity === 'survivor_hurt' ? 80 : 100}
            loop={!animatingEntity || animatingEntity.includes('idle')}
          />
          {/* 🐢 Amulette Tortue active : effet visuel "buff" qui fade vers le haut */}
          {amuletteBuffActive && (
            <img
              src={ITEM_SPRITES.amulette_tortue}
              alt="Amulette Tortue active"
              className="amulette-tortue-buff"
              data-testid={`amulette-tortue-buff-${primarySurvivor.survivor_id}`}
            />
          )}
          {/* 🧅 Amulette Oignon active : effet visuel "buff" qui fade vers le haut */}
          {onionBuffActive && (
            <img
              src={ITEM_SPRITES.amulette_oignon}
              alt="Amulette Oignon active"
              className="amulette-oignon-buff"
              data-testid={`amulette-oignon-buff-${primarySurvivor.survivor_id}`}
            />
          )}
          {/* 🍀 Amulette Chanceuse active : effet visuel "buff" qui fade vers le haut */}
          {cloverBuffActive && (
            <img
              src={ITEM_SPRITES.amulette_trefle}
              alt="Amulette Chanceuse active"
              className="amulette-trefle-buff"
              data-testid={`amulette-trefle-buff-${primarySurvivor.survivor_id}`}
            />
          )}
          {/* 🏴 Foulard Rankyr actif : effet visuel "buff" qui fade vers le haut */}
          {foulardBuffActive && (
            <img
              src={ITEM_SPRITES.foulard_rankyr}
              alt="Foulard Rankyr actif"
              className="amulette-oignon-buff"
              data-testid={`foulard-rankyr-buff-${primarySurvivor.survivor_id}`}
            />
          )}
          {/* 🥥 Amulette Coco active : sous 30% PV, effet visuel "buff" qui fade vers le haut */}
          {primarySurvivor.has_amulette_coco && (survivorHP / (primarySurvivor.survivor_max_hp || 1)) < 0.3 && (
            <img
              src={ITEM_SPRITES.amulette_coco}
              alt="Amulette Coco active"
              className="amulette-oignon-buff"
              data-testid={`amulette-coco-buff-${primarySurvivor.survivor_id}`}
            />
          )}
          {/* 🎯 Bandana de Ranja actif : effet visuel "buff" qui fade vers le haut */}
          {ranjaBuffActive && (
            <img
              src={ITEM_SPRITES.bandana_ranja}
              alt="Bandana de Ranja actif"
              className="amulette-oignon-buff"
              data-testid={`bandana-ranja-buff-${primarySurvivor.survivor_id}`}
            />
          )}
          {/* 🌸 Bonnet Croblow actif : effet visuel "buff" qui fade vers le haut */}
          {croblowBuffActive && (
            <img
              src={ITEM_SPRITES.bonnet_croblow}
              alt="Bonnet Croblow actif"
              className="amulette-oignon-buff"
              data-testid={`bonnet-croblow-buff-${primarySurvivor.survivor_id}`}
            />
          )}
          {damageIndicator && animatingEntity === 'survivor_hurt' && (
            <div style={{ position: 'absolute', top: '-40px', left: '50%', transform: 'translateX(-50%)' }}>
              {damageIndicator.type === 'both' && (
                <>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ff0000', textShadow: '2px 2px 4px #000', animation: 'floatUp 1.5s ease-out' }}>
                    -{damageIndicator.damage}
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FFD700', textShadow: '2px 2px 4px #000', animation: 'floatUp 1.5s ease-out', marginTop: '-10px' }}>
                    -{damageIndicator.gold}💰
                  </div>
                </>
              )}
            </div>
          )}
          {/* 🌸 Indicateur de soin Bonnet Croblow (vert) */}
          {damageIndicator && damageIndicator.type === 'croblow_heal' && (
            <div style={{ position: 'absolute', top: '-65px', left: '50%', transform: 'translateX(-50%)',
                          fontSize: '22px', fontWeight: 'bold', color: '#22c55e',
                          textShadow: '2px 2px 4px #000', animation: 'floatUp 1.5s ease-out',
                          pointerEvents: 'none', zIndex: 1001 }}>
              +{damageIndicator.value} 🌸
            </div>
          )}
          {initiativeIndicators[primarySurvivor.survivor_id] !== undefined && (
            <div
              data-testid={`initiative-indicator-${primarySurvivor.survivor_id}`}
              style={{
                position: 'absolute',
                top: '-40px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: '#3b82f6',
                fontSize: '1.8rem',
                fontWeight: 'bold',
                textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                pointerEvents: 'none',
                animation: 'initiativeFadeUp 2s ease-out forwards',
                zIndex: 10,
              }}
            >
              🎲 {initiativeIndicators[primarySurvivor.survivor_id]}
            </div>
          )}
          <div style={{ width: '200px', height: '12px', backgroundColor: '#333', borderRadius: '6px', overflow: 'hidden', marginTop: '5px', border: '2px solid #d4af37' }}>
            <div style={{ width: `${(survivorHP / primarySurvivor.survivor_hp) * 100}%`, height: '100%', backgroundColor: survivorHP > primarySurvivor.survivor_hp * 0.3 ? '#10b981' : '#ef4444', transition: 'width 0.3s' }} />
          </div>
          <div style={{ color: '#fff', textAlign: 'center', fontSize: '14px', fontWeight: 'bold', textShadow: '2px 2px 4px #000' }}>
            {primarySurvivor.survivor_class} ({survivorHP}/{primarySurvivor.survivor_hp})
            {participants.length > 1 && <span style={{ color: '#ffd166', marginLeft: 6 }}>+{participants.length - 1} allié(s)</span>}
          </div>
          <div style={{ color: '#FFD700', textAlign: 'center', fontSize: '14px', fontWeight: 'bold', textShadow: '2px 2px 4px #000' }}>
            💰 {survivorGold}
          </div>
        </div>

        {/* Mimic (à droite) */}
        <div style={{
          position: 'absolute',
          right: animatingEntity === 'mimic_attack' ? '30%' : '10%',
          bottom: '35%',
          transition: 'all 0.4s ease-out',
          opacity: mimicHP <= 0 && animatingEntity === 'mimic_fainted' ? 0.5 : 1
        }}>
          {/* Wrapper qui flippe UNIQUEMENT le sprite, pas les enfants
              (barre de vie, texte, indicateur de dégâts). Ainsi les dégâts
              ne sont plus affichés en miroir. */}
          <div style={{ transform: 'scaleX(-1)' }}>
            <SpriteSheetAnimator
              spriteSheet={getMimicSpriteSheet(
                animatingEntity === 'mimic_fainted' ? 'fainted' :
                animatingEntity === 'mimic_attack' ? 'attack' :
                animatingEntity === 'mimic_hurt' ? 'hurt' : 'idle'
              )}
              cols={getSpriteParams('mimic',
                animatingEntity === 'mimic_fainted' ? 'fainted' :
                animatingEntity === 'mimic_attack' ? 'attack' :
                animatingEntity === 'mimic_hurt' ? 'hurt' : 'idle'
              ).cols}
              rows={getSpriteParams('mimic',
                animatingEntity === 'mimic_fainted' ? 'fainted' :
                animatingEntity === 'mimic_attack' ? 'attack' :
                animatingEntity === 'mimic_hurt' ? 'hurt' : 'idle'
              ).rows}
              frameDuration={animatingEntity === 'mimic_attack' ? 50 : animatingEntity === 'mimic_hurt' ? 80 : 100}
              loop={!animatingEntity || animatingEntity === 'idle' || animatingEntity === 'mimic_fainted'}
            />
          </div>
          {damageIndicator && damageIndicator.type === 'damage' && (
            <div style={{ position: 'absolute', top: '-30px', left: '50%', transform: 'translateX(-50%)', fontSize: '28px', fontWeight: 'bold', color: '#ff0000', textShadow: '2px 2px 4px #000', animation: 'floatUp 1.5s ease-out' }}>
              -{damageIndicator.value}
            </div>
          )}
          {initiativeIndicators['mimic'] !== undefined && (
            <div
              data-testid="initiative-indicator-mimic"
              style={{
                position: 'absolute',
                top: '-40px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: '#3b82f6',
                fontSize: '1.8rem',
                fontWeight: 'bold',
                textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                pointerEvents: 'none',
                animation: 'initiativeFadeUp 2s ease-out forwards',
                zIndex: 10,
              }}
            >
              🎲 {initiativeIndicators['mimic']}
            </div>
          )}
          <div style={{ width: '200px', height: '12px', backgroundColor: '#333', borderRadius: '6px', overflow: 'hidden', marginTop: '5px', border: '2px solid #d4af37' }}>
            <div style={{ width: `${(mimicHP / event.mimic_hp) * 100}%`, height: '100%', backgroundColor: mimicHP > event.mimic_hp * 0.3 ? '#ef4444' : '#991b1b', transition: 'width 0.3s' }} />
          </div>
          <div style={{ color: '#fff', textAlign: 'center', fontSize: '14px', fontWeight: 'bold', textShadow: '2px 2px 4px #000' }}>
            Mimic ({mimicHP}/{event.mimic_hp})
          </div>
        </div>

        {/* Combat Log */}
        <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', width: '80%', maxHeight: '150px', backgroundColor: 'rgba(0, 0, 0, 0.8)', borderRadius: '8px', padding: '10px', overflowY: 'auto', border: '2px solid #d4af37' }}>
          {combatLog.map((entry, idx) => (
            <div key={idx} style={{ color: '#e8dcc4', fontSize: '12px', marginBottom: '3px' }}>{entry}</div>
          ))}
        </div>

        {/* Message de fin */}
        {combatOver && (
          <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(0, 0, 0, 0.9)', padding: '20px 40px', borderRadius: '12px', border: '3px solid #d4af37' }}>
            <div style={{ color: mimicDefeated ? '#10b981' : '#ef4444', fontSize: '24px', fontWeight: 'bold', textAlign: 'center' }}>
              {mimicDefeated ? '🎉 VICTOIRE !' : '💀 DÉFAITE !'}
            </div>
            <div style={{ color: '#FFD700', fontSize: '16px', textAlign: 'center', marginTop: '10px' }}>
              Or volé : {totalGoldStolen}💰
            </div>
          </div>
        )}

        {canClose && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#d4af37', fontSize: '18px', fontWeight: 'bold', textAlign: 'center', backgroundColor: 'rgba(0, 0, 0, 0.8)', padding: '15px 30px', borderRadius: '8px', border: '2px solid #d4af37' }}>
            Cliquez pour fermer
          </div>
        )}
      </div>
    </div>
  );
};

// ========== CRYSTAL COMBAT COMPONENT ==========
// Cloned from MultiPlayerCombat: same SpriteSheetAnimator, same deterministic
// loop, same UI. Différences :
//   - 1 single Crystal (30 HP) vs N survivors
//   - Crystal attack is AOE : 3 dégâts à TOUS les survivants dans le même tour
//   - Sprite sheets /fight/Cristal_{idle,attack,hurt,fainted}.webp
//   - Resolution endpoint : /api/game/:id/resolve_crystal_combat
const CrystalCombat = ({ event, playerId, sessionId, onClose, wsRef }) => {
  const isSurvivor = event.survivors.some(s => s.id === playerId);
  const isSimulator = isSurvivor && event.survivors[0].id === playerId;

  const [combatants, setCombatants] = useState([]);
  const [combatLog, setCombatLog] = useState([]);
  const [combatOver, setCombatOver] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [animatingEntity, setAnimatingEntity] = useState(null);
  const [damageIndicators, setDamageIndicators] = useState({});
  const [initiativeIndicators, setInitiativeIndicators] = useState({});

  // --- init combattants (initiative déterministe via combat_id) ---
  useEffect(() => {
    const fighters = [];
    event.survivors.forEach((survivor, idx) => {
      const baseInitiative = Math.floor(
        (hashCode(survivor.id + 'crystal' + (event.combat_id || event.turn || Date.now())) % 20) + 1
      );
      // NEW: Toxine incapacitante malus
      const poisonDamageMalus = !!(event.toxine_incapacitante_active && (survivor.poisoned_countdown || 0) > 0);
      fighters.push({
        id: survivor.id, name: survivor.name, class: survivor.class,
        type: 'survivor',
        hp: survivor.hp, maxHp: survivor.max_hp || survivor.hp,
        initiative: baseInitiative + (survivor.initiative_bonus || 0),
        damageBonus: survivor.damage_bonus || 0,
        poisonDamageMalus: poisonDamageMalus,
        position: idx, alive: true, currentAnimation: 'idle',
        has_amulette_tortue: !!survivor.has_amulette_tortue,   // 🐢 NEW
        has_amulette_oignon: !!survivor.has_amulette_oignon,   // 🧅 NEW
        has_amulette_trefle: !!survivor.has_amulette_trefle,   // 🍀 NEW
        has_foulard_rankyr: !!survivor.has_foulard_rankyr,     // 🏴 NEW
        has_amulette_coco: !!survivor.has_amulette_coco,       // 🥥 NEW
        has_bandana_ranja: !!survivor.has_bandana_ranja,       // 🎯 NEW
        has_bonnet_croblow: !!survivor.has_bonnet_croblow,     // 🌸 NEW
      });
    });
    const crystalInitiative = Math.floor(
      (hashCode('crystal_' + (event.combat_id || event.turn || Date.now())) % 20) + 1
    );
    fighters.push({
      id: 'crystal', name: 'Le Cristal', class: 'Cristal', type: 'crystal',
      hp: event.crystal_hp, maxHp: event.crystal_max_hp || event.crystal_hp,  // NEW: max envoyé par le backend
      initiative: crystalInitiative, position: 0, alive: true, currentAnimation: 'idle',
    });
    fighters.sort((a, b) => b.initiative - a.initiative);

    // 🍀 Amulette Chanceuse : applique le malus -50% HP AVANT toute autre logique
    const cloverRecipientsCrystal = applyAmuletteTrefleMalus(fighters);
    // 🐢 Amulette Tortue : flag les bénéficiaires
    const amuletteRecipientsCrystal = applyAmuletteTortueBonus(fighters);
    // 🧅 Amulette Oignon : flag les bénéficiaires
    const onionRecipientsCrystal = applyAmuletteOignonBonus(fighters);
    // 🏴 Foulard Rankyr : flag les bénéficiaires (actif tant qu'aucun dégât subi)
    const foulardRecipientsCrystal = applyFoulardRankyrBonus(fighters);
    // 🎯 Bandana de Ranja : flag le/les porteur(s) avec l'initiative strictement la plus haute
    const ranjaRecipientsCrystal = applyBandanaRanjaBonus(fighters);
    // 🌸 Bonnet Croblow : flag les porteurs (soin 10% dégâts infligés)
    const croblowRecipientsCrystal = applyBonnetCroblowBonus(fighters);

    setCombatants(fighters);
    const initLog = [`💎 Combat contre le Cristal ! Ordre d'initiative :`];
    fighters.forEach(f => initLog.push(`${f.name} (${f.initiative})`));
    amuletteRecipientsCrystal.forEach(f => {
      initLog.push(`🐢 ${f.name} a la plus basse initiative — Amulette Tortue active : dégâts reçus -25% !`);
    });
    onionRecipientsCrystal.forEach(f => {
      initLog.push(`🧅 ${f.name} — Amulette Oignon active : dégâts infligés +50% !`);
    });
    cloverRecipientsCrystal.forEach(f => {
      initLog.push(`🍀 ${f.name} — Amulette Chanceuse active : dégâts subis +50% pour ce combat !`);
    });
    foulardRecipientsCrystal.forEach(f => {
      initLog.push(`🏴 ${f.name} — Foulard Rankyr actif : dégâts infligés +50% tant qu'aucun dégât n'est subi !`);
    });
    ranjaRecipientsCrystal.forEach(f => {
      initLog.push(`🎯 ${f.name} a la plus haute initiative — Bandana de Ranja actif : dégâts infligés +50% pour tout le combat !`);
    });
    fighters.filter(f => f.type === 'survivor' && f.has_amulette_coco).forEach(f => {
      initLog.push(`🥥 ${f.name} porte l'Amulette Coco de Bouchou : dégâts infligés +75% sous 30% de PV !`);
    });
    croblowRecipientsCrystal.forEach(f => {
      initLog.push(`🌸 ${f.name} — Bonnet Croblow actif : 10% des dégâts infligés soignent tous les aventuriers !`);
    });
    setCombatLog(initLog);

    const initiatives = {};
    fighters.forEach(f => { initiatives[f.id] = f.initiative; });
    setInitiativeIndicators(initiatives);
    setTimeout(() => setInitiativeIndicators({}), 2000);
  }, [event]);

  // --- boucle simulation déterministe ---
  useEffect(() => {
    if (combatants.length === 0) return;
    let mounted = true;
    let turnIndex = 0;
    let fighters = [...combatants];
    const combatSeed = hashCode(
      event.combat_id || ('crystal' + event.survivors.map(s => s.id).join('') + event.turn)
    );
    const rng = new SeededRandom(combatSeed);
    for (let i = 0; i < 10; i++) rng.next();

    const runCombat = async () => {
      while (mounted) {
        const aliveSurvivors = fighters.filter(f => f.type === 'survivor' && f.alive);
        const crystal = fighters.find(f => f.type === 'crystal');

        if (aliveSurvivors.length === 0 || !crystal.alive) {
          setCombatOver(true);
          const survivorsResults = event.survivors.map(survivor => {
            const fighter = fighters.find(f => f.id === survivor.id);
            return {
              id: survivor.id,
              damage_dealt: Math.max(0, survivor.hp - (fighter?.hp || 0)),
              eliminated: !fighter || !fighter.alive,
            };
          });
          if (isSimulator) {
            try {
              await axios.post(`${API}/game/${sessionId}/resolve_crystal_combat`, {
                survivors_results: survivorsResults,
                crystal_defeated: !crystal.alive,
                crystal_hp_remaining: Math.max(0, crystal.hp),  // NEW: HP restants du cristal
                combat_log: combatLog,
              });
            } catch (error) {
              console.error("Erreur lors de la résolution du combat Cristal:", error);
            }
          }
          await new Promise(resolve => setTimeout(resolve, 2500));
          setCanClose(true);
          break;
        }

        const attacker = fighters[turnIndex % fighters.length];
        if (!attacker.alive) { turnIndex++; continue; }

        if (attacker.type === 'survivor') {
          // Survivant attaque le cristal
          setAnimatingEntity({ id: attacker.id, type: 'attack' });
          await new Promise(resolve => setTimeout(resolve, 1700));
          const damage = rng.nextInt(1, 6) + (attacker.damageBonus || 0);
          // NEW: Toxine incapacitante — dégâts réduits de moitié (arrondi supérieur)
          let finalDamage = attacker.poisonDamageMalus ? Math.ceil(damage / 2) : damage;
          // 🧅 Amulette Oignon — +50% si éligible
          const rawDamageBeforeOnion = finalDamage;
          finalDamage = amplifyDamageIfOnion(attacker, finalDamage);
          // 🏴 Foulard Rankyr — +50% si éligible (aucun dégât subi ce combat)
          const rawDamageBeforeFoulard = finalDamage;
          finalDamage = amplifyDamageIfFoulard(attacker, finalDamage);
          // 🥥 Amulette Coco de Bouchou — +75% si l'attaquant est sous 30% de ses PV max
          const rawDamageBeforeCoco = finalDamage;
          finalDamage = amplifyDamageIfCoco(attacker, finalDamage);
          // 🎯 Bandana de Ranja — +50% si l'attaquant a la plus haute initiative (figé tout le combat)
          const rawDamageBeforeRanja = finalDamage;
          finalDamage = amplifyDamageIfRanja(attacker, finalDamage);
          crystal.hp = Math.max(0, crystal.hp - finalDamage);
          if (crystal.hp <= 0) crystal.alive = false;

          // 🌸 Bonnet Croblow — soin 10% des dégâts infligés pour tous les aventuriers vivants
          const croblowHealCrystal = healAmountIfCroblow(attacker, finalDamage);
          if (croblowHealCrystal > 0) {
            const healedNamesCrystal = [];
            fighters.filter(f => f.type === 'survivor' && f.alive).forEach(f => {
              const before = f.hp;
              f.hp = Math.min(f.maxHp, f.hp + croblowHealCrystal);
              if (f.hp > before) healedNamesCrystal.push(f.name);
              setDamageIndicators(prev => ({ ...prev, [f.id + '_heal']: { heal: croblowHealCrystal, timestamp: Date.now() } }));
              setTimeout(() => {
                setDamageIndicators(prev => { const n = { ...prev }; delete n[f.id + '_heal']; return n; });
              }, 1500);
            });
            if (healedNamesCrystal.length > 0) {
              setCombatLog(prev => [...prev, `🌸 ${attacker.name} soigne l'équipe de +${croblowHealCrystal} PV (Bonnet Croblow) ! [${healedNamesCrystal.join(', ')}]`]);
            }
          }

          setDamageIndicators(prev => ({ ...prev, [crystal.id]: { damage: finalDamage, timestamp: Date.now() } }));
          setTimeout(() => setDamageIndicators(prev => {
            const n = { ...prev }; delete n[crystal.id]; return n;
          }), 1500);

          setAnimatingEntity({ id: crystal.id, type: 'hurt' });
          await new Promise(resolve => setTimeout(resolve, 1000));
          setAnimatingEntity(null);

          const onionTag = finalDamage > rawDamageBeforeOnion ? ` (🧅 +50%, ${rawDamageBeforeOnion}→${finalDamage})` : '';
          const foulardTag = finalDamage > rawDamageBeforeFoulard ? ` (🏴 +50%, ${rawDamageBeforeFoulard}→${finalDamage})` : '';
          const cocoTag = finalDamage > rawDamageBeforeCoco ? ` (🥥 +75%, ${rawDamageBeforeCoco}→${finalDamage})` : '';
          const ranjaTag = finalDamage > rawDamageBeforeRanja ? ` (🎯 +50%, ${rawDamageBeforeRanja}→${finalDamage})` : '';
          setCombatLog(prev => [...prev, `${attacker.name} attaque ${crystal.name} : ${finalDamage} dégâts${attacker.poisonDamageMalus ? ' (Toxine -50%)' : ''}${foulardTag}${ranjaTag}${cocoTag}${onionTag} ! (${crystal.hp}/${crystal.maxHp} PV)`]);
          setCombatants([...fighters]);
          await new Promise(resolve => setTimeout(resolve, 1500));
        } else {
          // Cristal attaque AOE
          setAnimatingEntity({ id: 'crystal', type: 'attack' });
          await new Promise(resolve => setTimeout(resolve, 1700));

          const rawCrystalDamage = event.crystal_damage || 3;
          const hitNames = [];
          aliveSurvivors.forEach(s => {
            const afterTurtle = reduceDamageIfTurtle(s, rawCrystalDamage);          // 🐢
            const effectiveDamage = amplifyDamageTakenIfClover(s, afterTurtle);     // 🍀
            s.hp = Math.max(0, s.hp - effectiveDamage);
            if (s.hp <= 0) s.alive = false;
            // 🏴 Le survivant vient de subir des dégâts AOE : son Foulard Rankyr se rompt
            const sFoulardWasActive = s.foulard_rankyr_active;
            breakFoulardRankyrIfHit(s, effectiveDamage);
            let tag = '';
            if (effectiveDamage > afterTurtle) tag = ` (🍀 ${effectiveDamage})`;
            else if (effectiveDamage < rawCrystalDamage) tag = ` (🐢 ${effectiveDamage})`;
            if (effectiveDamage > 0 && sFoulardWasActive && !s.foulard_rankyr_active) tag += ` (🏴 rompu)`;
            hitNames.push(s.name + tag);
            setDamageIndicators(prev => ({ ...prev, [s.id]: { damage: effectiveDamage, timestamp: Date.now() } }));
          });
          setTimeout(() => setDamageIndicators(prev => {
            const n = { ...prev }; aliveSurvivors.forEach(s => delete n[s.id]); return n;
          }), 1500);

          // hurt synchronisé sur tous les survivants
          setAnimatingEntity({ id: '__aoe__', type: 'aoe_hurt' });
          await new Promise(resolve => setTimeout(resolve, 1000));
          setAnimatingEntity(null);

          setCombatLog(prev => [...prev, `💥 ${crystal.name} frappe TOUS les survivants (${hitNames.join(', ')}) : ${rawCrystalDamage} dégâts AOE !`]);
          setCombatants([...fighters]);
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        turnIndex++;
      }
    };

    runCombat();
    return () => { mounted = false; };
    // eslint-disable-next-line
  }, [combatants.length, sessionId, event]);
  
  const getSpriteSheet = (combatant, animationType) =>
    combatant.type === 'crystal'
      ? `/fight/Cristal_${animationType}.webp`
      : `/fight/${combatant.class}_${animationType}.webp`;

  const getSpriteParams = (combatant, animationType) => {
    if (combatant.type === 'crystal') {
      switch (animationType) {
        case 'idle':    return { cols: 5, rows: 6, totalFrames: 30 };
        case 'attack':  return { cols: 5, rows: 6, totalFrames: 30 };
        case 'hurt':    return { cols: 5, rows: 2, totalFrames: 10 };
        case 'fainted': return { cols: 5, rows: 6, totalFrames: 30 };
        default:        return { cols: 5, rows: 6, totalFrames: 30 };
      }
    }
    switch (animationType) {
      case 'idle':    return { cols: 5, rows: 6, totalFrames: 30 };
      case 'attack':  return { cols: 5, rows: 6, totalFrames: 30 };
      case 'hurt':    return { cols: 5, rows: 2, totalFrames: 10 };
      case 'fainted': return { cols: 5, rows: 4, totalFrames: 20 };
      default:        return { cols: 5, rows: 6, totalFrames: 30 };
    }
  };

  const getPosition = (combatant) => {
    const positions = [
      { bottom: '15%', top: 'auto' }, { bottom: '35%', top: 'auto' },
      { bottom: '55%', top: 'auto' }, { bottom: '75%', top: 'auto' },
    ];
    return positions[combatant.position] || positions[0];
  };
  const aoeHurt = animatingEntity && animatingEntity.type === 'aoe_hurt';

  return (
    <div className="game-over-overlay"
         style={{ zIndex: 3000, cursor: (canClose || combatOver) ? "pointer" : "default" }}
         onClick={() => (canClose || combatOver) && onClose && onClose()}
         data-testid="crystal-combat">
      <div style={{
        position: 'relative', width: '90%', maxWidth: '1200px', height: '80vh',
        backgroundImage: 'url(/fight/Ground.jpg)', backgroundSize: 'cover', backgroundPosition: 'center',
        borderRadius: '12px', border: '4px solid #5fa8ff', overflow: 'hidden',
      }}>
        {/* Survivants (à gauche) — rendu identique à MultiPlayerCombat, avec hurt AOE synchronisé */}
        {combatants.filter(c => c.type === 'survivor').map((combatant) => {
          const isAttackingNow = animatingEntity?.id === combatant.id && animatingEntity.type === 'attack';
          const isHurtNow = combatant.alive && aoeHurt;
          const animationType = !combatant.alive ? 'fainted'
            : (isAttackingNow ? 'attack' : (isHurtNow ? 'hurt' : 'idle'));
          const spriteParams = getSpriteParams(combatant, animationType);
          return (
            <div key={combatant.id}
                 style={{ position: 'absolute', left: isAttackingNow ? '30%' : '10%',
                          ...getPosition(combatant), opacity: combatant.alive ? 1 : 0.3,
                          transition: 'all 0.4s ease-out' }}
                 data-testid={`crystal-combat-survivor-${combatant.id}`}>
              <SpriteSheetAnimator
                spriteSheet={getSpriteSheet(combatant, animationType)}
                cols={spriteParams.cols} rows={spriteParams.rows}
                frameDuration={animationType === 'attack' ? 33 : animationType === 'hurt' ? 80 : 100}
                loop={animationType === 'idle'} />
              {/* 🐢 Amulette Tortue active : effet visuel "buff" qui fade vers le haut */}
              {combatant.amulette_tortue_active && (
                <img
                  src={ITEM_SPRITES.amulette_tortue}
                  alt="Amulette Tortue active"
                  className="amulette-tortue-buff"
                  data-testid={`amulette-tortue-buff-${combatant.id}`}
                />
              )}
              {/* 🧅 Amulette Oignon active : effet visuel "buff" qui fade vers le haut */}
              {combatant.amulette_oignon_active && (
                <img
                  src={ITEM_SPRITES.amulette_oignon}
                  alt="Amulette Oignon active"
                  className="amulette-oignon-buff"
                  data-testid={`amulette-oignon-buff-${combatant.id}`}
                />
              )}
              {/* 🍀 Amulette Chanceuse active : effet visuel "buff" qui fade vers le haut */}
              {combatant.amulette_trefle_active && (
                <img
                  src={ITEM_SPRITES.amulette_trefle}
                  alt="Amulette Chanceuse active"
                  className="amulette-trefle-buff"
                  data-testid={`amulette-trefle-buff-${combatant.id}`}
                />
              )}
              {/* 🏴 Foulard Rankyr actif : effet visuel "buff" qui fade vers le haut */}
              {combatant.foulard_rankyr_active && (
                <img
                  src={ITEM_SPRITES.foulard_rankyr}
                  alt="Foulard Rankyr actif"
                  className="amulette-oignon-buff"
                  data-testid={`foulard-rankyr-buff-${combatant.id}`}
                />
              )}
              {/* 🥥 Amulette Coco active : sous 30% PV, effet visuel "buff" qui fade vers le haut */}
              {combatant.type === 'survivor' && combatant.has_amulette_coco && (combatant.hp / (combatant.maxHp || 1)) < 0.3 && (
                <img
                  src={ITEM_SPRITES.amulette_coco}
                  alt="Amulette Coco active"
                  className="amulette-oignon-buff"
                  data-testid={`amulette-coco-buff-${combatant.id}`}
                />
              )}
              {/* 🎯 Bandana de Ranja actif : effet visuel "buff" qui fade vers le haut */}
              {combatant.bandana_ranja_active && (
                <img
                  src={ITEM_SPRITES.bandana_ranja}
                  alt="Bandana de Ranja actif"
                  className="amulette-oignon-buff"
                  data-testid={`bandana-ranja-buff-${combatant.id}`}
                />
              )}
              {/* 🌸 Bonnet Croblow actif : effet visuel "buff" qui fade vers le haut */}
              {combatant.bonnet_croblow_active && (
                <img
                  src={ITEM_SPRITES.bonnet_croblow}
                  alt="Bonnet Croblow actif"
                  className="amulette-oignon-buff"
                  data-testid={`bonnet-croblow-buff-${combatant.id}`}
                />
              )}
              {damageIndicators[combatant.id] && (
                <div style={{ position: 'absolute', top: '-30px', left: '50%',
                              transform: 'translateX(-50%)', fontSize: '28px', fontWeight: 'bold',
                              color: '#ff0000', textShadow: '2px 2px 4px #000, -1px -1px 2px #fff',
                              animation: 'floatUp 1.5s ease-out', pointerEvents: 'none', zIndex: 1000 }}>
                  -{damageIndicators[combatant.id].damage}
                </div>
              )}
              {/* 🌸 Indicateur de soin Bonnet Croblow (vert) */}
              {damageIndicators[combatant.id + '_heal'] && (
                <div style={{ position: 'absolute', top: '-55px', left: '50%',
                              transform: 'translateX(-50%)', fontSize: '22px', fontWeight: 'bold',
                              color: '#22c55e', textShadow: '2px 2px 4px #000',
                              animation: 'floatUp 1.5s ease-out', pointerEvents: 'none', zIndex: 1001 }}>
                  +{damageIndicators[combatant.id + '_heal'].heal} 🌸
                </div>
              )}
              {initiativeIndicators[combatant.id] !== undefined && (
                <div
                  data-testid={`initiative-indicator-${combatant.id}`}
                  style={{
                    position: 'absolute',
                    top: '-40px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    color: '#3b82f6',
                    fontSize: '1.8rem',
                    fontWeight: 'bold',
                    textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                    pointerEvents: 'none',
                    animation: 'initiativeFadeUp 2s ease-out forwards',
                    zIndex: 10,
                  }}
                >
                  🎲 {combatant.initiative}
                </div>
              )}
              <div style={{ width: '200px', height: '12px', backgroundColor: '#333',
                            borderRadius: '6px', overflow: 'hidden', marginTop: '5px',
                            border: '2px solid #5fa8ff' }}>
                <div style={{ width: `${(combatant.hp / combatant.maxHp) * 100}%`, height: '100%',
                              backgroundColor: combatant.hp > combatant.maxHp * 0.3 ? '#10b981' : '#ef4444',
                              transition: 'width 0.3s' }} />
              </div>
              <div style={{ color: '#fff', textAlign: 'center', fontSize: '14px',
                            fontWeight: 'bold', textShadow: '2px 2px 4px #000' }}>
                {combatant.name} ({combatant.hp}/{combatant.maxHp})
              </div>
            </div>
          );
        })}

        {/* Cristal (à droite, miroir) */}
        {combatants.filter(c => c.type === 'crystal').map((combatant) => {
          const isAttackingNow = animatingEntity?.id === combatant.id && animatingEntity.type === 'attack';
          const isHurtNow = animatingEntity?.id === combatant.id && animatingEntity.type === 'hurt';
          const animationType = !combatant.alive ? 'fainted'
            : (isAttackingNow ? 'attack' : (isHurtNow ? 'hurt' : 'idle'));
          const spriteParams = getSpriteParams(combatant, animationType);
          return (
            <div key={combatant.id}
                 style={{ position: 'absolute', right: isAttackingNow ? '30%' : '10%',
                          bottom: '35%', opacity: combatant.alive ? 1 : 0.4,
                          transition: 'all 0.4s ease-out', transform: 'scaleX(-1)' }}
                 data-testid="crystal-combat-crystal">
              <SpriteSheetAnimator
                spriteSheet={getSpriteSheet(combatant, animationType)}
                cols={spriteParams.cols} rows={spriteParams.rows}
                frameDuration={animationType === 'attack' ? 50 : animationType === 'hurt' ? 80 : 100}
                loop={animationType === 'idle'} />
              {damageIndicators[combatant.id] && (
                <div style={{ position: 'absolute', top: '-30px', left: '50%',
                              transform: 'translateX(-50%) scaleX(-1)', fontSize: '28px',
                              fontWeight: 'bold', color: '#ff0000',
                              textShadow: '2px 2px 4px #000, -1px -1px 2px #fff',
                              animation: 'floatUpMirrored 1.5s ease-out',
                              pointerEvents: 'none', zIndex: 1000 }}>
                  -{damageIndicators[combatant.id].damage}
                </div>
              )}
              {initiativeIndicators[combatant.id] !== undefined && (
                <div
                  data-testid={`initiative-indicator-${combatant.id}`}
                  style={{
                    position: 'absolute',
                    top: '-40px',
                    left: '50%',
                    transform: 'translateX(-50%) scaleX(-1)',
                    color: '#3b82f6',
                    fontSize: '1.8rem',
                    fontWeight: 'bold',
                    textShadow: '0 0 8px rgba(59,130,246,0.9), 0 2px 4px rgba(0,0,0,0.8)',
                    pointerEvents: 'none',
                    animation: 'initiativeFadeUp 2s ease-out forwards',
                    zIndex: 10,
                  }}
                >
                  🎲 {combatant.initiative}
                </div>
              )}
              <div style={{ width: '200px', height: '12px', backgroundColor: '#333',
                            borderRadius: '6px', overflow: 'hidden', marginTop: '5px',
                            border: '2px solid #5fa8ff', transform: 'scaleX(-1)' }}>
                <div style={{ width: `${(combatant.hp / combatant.maxHp) * 100}%`, height: '100%',
                              backgroundColor: combatant.hp > combatant.maxHp * 0.3 ? '#9fd0ff' : '#5fa8ff',
                              transition: 'width 0.3s' }} />
              </div>
              <div style={{ color: '#fff', textAlign: 'center', fontSize: '14px',
                            fontWeight: 'bold', textShadow: '2px 2px 4px #000',
                            transform: 'scaleX(-1)' }}>
                {combatant.name} ({combatant.hp}/{combatant.maxHp})
              </div>
            </div>
          );
        })}

        {/* Log */}
        <div style={{ position: 'absolute', bottom: '10px', left: '50%',
                      transform: 'translateX(-50%)', width: '80%', maxHeight: '150px',
                      backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: '8px',
                      padding: '10px', overflowY: 'auto', border: '2px solid #5fa8ff' }}>
          {combatLog.map((entry, idx) => (
            <div key={idx} style={{ color: '#e8dcc4', fontSize: '12px', marginBottom: '3px' }}>{entry}</div>
          ))}
        </div>

        {combatOver && (
          <div style={{ position: 'absolute', top: '20px', left: '50%',
                        transform: 'translateX(-50%)', backgroundColor: 'rgba(0,0,0,0.9)',
                        padding: '20px 40px', borderRadius: '12px', border: '3px solid #5fa8ff' }}>
            <div style={{ color: '#9fd0ff', fontSize: '24px', fontWeight: 'bold', textAlign: 'center' }}>
              💎 COMBAT TERMINÉ !
            </div>
          </div>
        )}

        {(canClose || combatOver) && (
          <div style={{ position: 'absolute', top: '50%', left: '50%',
                        transform: 'translate(-50%, -50%)', color: '#9fd0ff',
                        fontSize: '18px', fontWeight: 'bold', textAlign: 'center',
                        backgroundColor: 'rgba(0,0,0,0.8)', padding: '15px 30px',
                        borderRadius: '8px', border: '2px solid #5fa8ff', cursor: 'pointer' }}
               onClick={(e) => { e.stopPropagation(); if (onClose) onClose(); }}>
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
  const hasCursedItem = inventory.some(slot => slot && (slot.cursed || slot.cursed_display));
  
  return (
    <button
      onClick={onClick}
      data-testid="inventory-hud-button"
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        backgroundColor: hasCursedItem ? 'rgba(30, 10, 50, 0.97)' : 'rgba(42, 31, 23, 0.95)',
        border: hasCursedItem ? '2px solid #7c3aed' : '2px solid #d4af37',
        borderRadius: '8px',
        padding: '12px 20px',
        color: hasCursedItem ? '#c4b5fd' : '#d4af37',
        fontSize: '18px',
        fontWeight: 'bold',
        cursor: 'pointer',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'all 0.2s ease',
        boxShadow: hasCursedItem ? '0 0 12px 3px rgba(124,58,237,0.5)' : '0 4px 12px rgba(0, 0, 0, 0.5)',
        animation: hasCursedItem ? 'cursedPulse 1.5s ease-in-out infinite' : 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.05)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {hasCursedItem ? '🔮' : '🎒'} {filledSlots}/9{hasCursedItem ? ' ⚠️' : ''}
    </button>
  );
};

// ========== ITEM INFO MODAL COMPONENT ==========
const ItemInfoModal = ({ item, onClose, player, sessionId }) => {
  // 🥛 Confirmation pour boire le Lait LEW alors qu'on est déjà au max de PV
  const [askConfirmFullHp, setAskConfirmFullHp] = useState(false);

  if (!item) return null;
  const sprite = item.type === 'weapon_equipped' ? item.sprite : ITEM_SPRITES[item.type];
  const name = item.type === 'weapon_equipped' ? item.name : (ITEM_NAMES[item.type] || item.type);
  const description = item.type === 'weapon_equipped' ? item.description : getItemDescription(item.type);

  // 🥛 Utilise le Lait LEW via POST /game/{session_id}/use_item (endpoint existant côté backend)
  const handleUseLaitLew = async () => {
    try {
      const response = await axios.post(`${API}/game/${sessionId}/use_item`, {
        player_id: player.id,
        slot_index: item._slotIndex,
      });
      if (response.data?.status === 'success') {
        toast.success('🥛 Lait LEW bu ! Régénération en cours (4 PV / tour, 3 tours).');
      }
      setAskConfirmFullHp(false);
      onClose();
    } catch (e) {
      const errorMsg = e.response?.data?.detail || "Erreur lors de l'utilisation du Lait LEW";
      toast.error(errorMsg);
      setAskConfirmFullHp(false);
    }
  };

  return (
    <div
      data-testid="item-info-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 10001,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        data-testid="item-info-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          background: 'linear-gradient(180deg, #2a1f17 0%, #1a1208 100%)',
          border: '3px solid #d4af37',
          borderRadius: 14,
          boxShadow: '0 0 30px rgba(212, 175, 55, 0.5)',
          padding: '2rem 1.8rem 1.5rem',
          maxWidth: 380,
          width: '100%',
          color: '#f5e6c8',
          textAlign: 'center',
          fontFamily: 'inherit',
        }}
      >
        {/* Bouton fermeture */}
        <button
          data-testid="item-info-close-btn"
          onClick={onClose}
          aria-label="Fermer"
          style={{
            position: 'absolute', top: 8, right: 10,
            background: 'transparent', border: 'none',
            color: '#d4af37', fontSize: '1.5rem', fontWeight: 'bold',
            cursor: 'pointer', lineHeight: 1,
          }}
        >
          ❌
        </button>

        {/* Sprite */}
        {sprite && (
          <div style={{
            display: 'flex', justifyContent: 'center', marginBottom: '1rem',
          }}>
            <img
              src={sprite}
              alt={name}
              style={{
                width: 96, height: 96, objectFit: 'contain',
                imageRendering: 'pixelated',
                filter: 'drop-shadow(0 0 8px rgba(212,175,55,0.4))',
              }}
            />
          </div>
        )}

        {/* Nom */}
        <h3 style={{
          color: '#d4af37',
          fontSize: '1.3rem',
          margin: '0 0 0.8rem 0',
          letterSpacing: '0.5px',
        }}>
          {name}
        </h3>

        {/* Séparateur */}
        <div style={{
          height: 1,
          background: 'linear-gradient(90deg, transparent, #d4af37, transparent)',
          margin: '0.5rem 0 1rem',
        }} />

        {/* Description */}
        <p style={{
          fontSize: '0.95rem',
          lineHeight: 1.5,
          color: '#e8d5a3',
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {description}
        </p>

        {/* 🥛 Bouton "Utiliser" pour le Lait LEW (déclenche /use_item côté backend) */}
        {item.type === 'lait_lew' && !item.equipped && player && sessionId && !askConfirmFullHp && (
          <button
            data-testid="item-use-lait-lew-btn"
            onClick={() => {
              const hp = player?.hp ?? 0;
              const maxHp = player?.max_hp ?? hp;
              if (hp >= maxHp) {
                // PV au max → demande confirmation au joueur
                setAskConfirmFullHp(true);
              } else {
                handleUseLaitLew();
              }
            }}
            style={{
              marginTop: '1rem',
              backgroundColor: '#10b981', color: '#fff', fontWeight: 'bold',
              padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
            }}
          >
            🥛 Utiliser
          </button>
        )}

        {/* 🥛 Confirmation : utiliser le Lait LEW alors que les PV sont au max */}
        {item.type === 'lait_lew' && askConfirmFullHp && (
          <div
            data-testid="lait-lew-full-hp-confirm"
            style={{
              marginTop: '1rem',
              padding: '12px',
              backgroundColor: 'rgba(212, 175, 55, 0.12)',
              border: '2px solid #d4af37',
              borderRadius: '8px',
              color: '#f5e6c8',
            }}
          >
            <p style={{ margin: '0 0 12px 0', fontSize: '0.95rem', lineHeight: 1.4 }}>
              Vous avez déjà tous vos PDV, souhaitez-vous l'utiliser quand même ?
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                data-testid="lait-lew-full-hp-confirm-yes"
                onClick={handleUseLaitLew}
                style={{
                  backgroundColor: '#10b981', color: '#fff', fontWeight: 'bold',
                  padding: '8px 22px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                }}
              >
                Oui
              </button>
              <button
                data-testid="lait-lew-full-hp-confirm-no"
                onClick={() => setAskConfirmFullHp(false)}
                style={{
                  backgroundColor: '#374151', color: '#fff', fontWeight: 'bold',
                  padding: '8px 22px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                }}
              >
                Non
              </button>
            </div>
          </div>
        )}

        {/* Bonus de forge (arme équipée) */}
        {item.type === 'weapon_equipped' && item.weapon_bonuses && item.weapon_bonuses.length > 0 && (
          <div data-testid="item-info-weapon-bonuses" style={{ marginTop: '0.8rem' }}>
            <h4 style={{ color: '#d4af37', marginBottom: '0.4rem' }}>Bonus de forge :</h4>
            <ul style={{ listStyle: 'none', padding: 0, color: '#9fffb5' }}>
              {item.weapon_bonuses.map((b, i) => {
                const RUNE_FALLBACK = {
                  rune_dommage: '+2 dégâts',
                  rune_vitalite: '+8 vitalité',
                  rune_initiative: '+3 initiative',
                };

                // Priorité : label fourni > construction "stat +value" > fallback par rune_type
                const display =
                  b.label ||
                  (b.stat && b.value !== undefined ? `+${b.value} ${b.stat}` : null) ||
                  RUNE_FALLBACK[b.rune_type] ||
                  b.rune_type ||
                  'Bonus inconnu';

                return <li key={i}>✓ {display}</li>;
              })}
            </ul>
          </div>
        )}
        {item.type === 'weapon_equipped' && (
          <p style={{ color: '#fbbf24', fontStyle: 'italic', marginTop: '0.8rem' }}>
            🔒 Cette arme est liée à votre classe et ne peut pas être déséquipée.
          </p>
        )}

        {/* Bouton Équiper (babiole / familier) */}
        {(item.tag === 'babiole' || item.tag === 'familier') && !item.equipped && player && sessionId && (
          <button
            data-testid="item-equip-btn"
            onClick={async () => {
              try {
                await axios.post(`${API}/game/${sessionId}/equip_item`, {
                  player_id: player.id,
                  slot_index: item._slotIndex,
                  slot_type: item.tag,
                });
                toast.success(`${item.name || item.type} équipé(e) !`);
                onClose();
              } catch (e) {
                const errorMsg = e.response?.data?.detail;
                if (errorMsg && typeof errorMsg === 'string') {
                  toast.error(errorMsg);
                } else {
                  toast.error("Erreur lors de l'équipement");
                }
              }
            }}
            style={{
              marginTop: '1rem',
              backgroundColor: '#10b981', color: '#fff', fontWeight: 'bold',
              padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
            }}
          >
            ⚔️ Équiper
          </button>
        )}

        {/* Bouton Déséquiper (babiole / familier équipé) */}
        {(item.tag === 'babiole' || item.tag === 'familier') && item.equipped && player && sessionId && (
          <button
            data-testid="item-unequip-btn"
            onClick={async () => {
              try {
                await axios.post(`${API}/game/${sessionId}/unequip_item`, {
                  player_id: player.id,
                  slot_index: item._slotIndex,
                  slot_type: item.tag,
                });
                toast.success(`${item.name || item.type} déséquipé(e) !`);
                onClose();
              } catch (e) {
                const errorMsg = e.response?.data?.detail;
                if (errorMsg && typeof errorMsg === 'string') {
                  toast.error(errorMsg);
                } else {
                  toast.error("Erreur lors du déséquipement");
                }
              }
            }}
            style={{
              marginTop: '1rem',
              backgroundColor: '#ef4444', color: '#fff', fontWeight: 'bold',
              padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
            }}
          >
            🗑️ Déséquiper
          </button>
        )}
      </div>
    </div>
  );
};

// NEW: Equipment grid (weapon / babiole / familier)
const CLASS_TO_WEAPON_SLUG = {
  Assassin: 'assassin', Barbare: 'barbare', Barde: 'barde',
  Elfe: 'elfe', Guerrier: 'knight', Mage: 'mage'
};

const EQUIPMENT_SLOT_CONDITIONS = ['weapon', 'babiole', 'familier'];
const EQUIPMENT_SLOT_LABELS = {
  weapon: 'Arme',
  babiole: 'Babiole',
  familier: 'Familier',
};

// Positions en % depuis inventory_equipement.png (730x1440, ~3 slots verticaux)
const EQUIPMENT_SLOT_POSITIONS = [
  { top: '10%',  left: '20%', width: '60%', height: '22%' },  // slot weapon
  { top: '39%',  left: '20%', width: '60%', height: '22%' },  // slot babiole
  { top: '68%',  left: '20%', width: '60%', height: '22%' },  // slot familier
];

const EquipmentGrid = ({ player, sessionId, onInspect }) => {
  const equipment = player.equipment || {};
  const weaponBonuses = player.weapon_bonuses || [];
  const weaponSlug = CLASS_TO_WEAPON_SLUG[player.character_class] || 'mage';
  const weaponSrc = `/items/Weapon_${weaponSlug}.png`;
  const weaponName = `Arme du ${player.character_class || 'Aventurier'}`;
  const weaponPlusLevel = weaponBonuses.length;

  const weaponItem = {
    type: 'weapon_equipped',
    sprite: weaponSrc,
    name: weaponPlusLevel > 0 ? `${weaponName} +${weaponPlusLevel}` : weaponName,
    description: `Arme de classe ${player.character_class}.`,
    weapon_bonuses: weaponBonuses,
    locked: true,
  };

  return (
    <div
      data-testid="equipment-grid"
      style={{
        position: 'relative',
        width: 'min(35vw, 80vh, 300px)',
        aspectRatio: '730 / 1440',
        backgroundImage: 'url(/inventory/inventory_equipement.png)',
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      }}
    >
      {EQUIPMENT_SLOT_CONDITIONS.map((cond, idx) => {
        const pos = EQUIPMENT_SLOT_POSITIONS[idx];
        const isWeaponSlot = cond === 'weapon';
        // NEW: pour les babioles/familiers équipés, on marque explicitement
        // `equipped: true` (et un _slotIndex factice, ignoré par /unequip_item)
        // afin que la modale d'inspection affiche bien le bouton "Déséquiper".
        const equippedItem = isWeaponSlot
          ? weaponItem
          : (equipment[cond] ? { ...equipment[cond], equipped: true, _slotIndex: -1 } : null);

        return (
          <div
            key={cond}
            data-testid={`equipment-slot-${cond}`}
            onClick={() => equippedItem && onInspect(equippedItem)}
            title={equippedItem ? equippedItem.name || EQUIPMENT_SLOT_LABELS[cond] : `Slot ${EQUIPMENT_SLOT_LABELS[cond]} vide`}
            style={{
              position: 'absolute',
              top: pos.top, left: pos.left,
              width: pos.width, height: pos.height,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: equippedItem ? 'pointer' : 'default',
            }}
          >
            {equippedItem ? (
              <>
                <img
                  src={equippedItem.sprite || ITEM_SPRITES[equippedItem.type] || '/inventory/placeholder.png'}
                  alt={equippedItem.name || cond}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))', pointerEvents: 'none' }}
                />
                {isWeaponSlot && weaponPlusLevel > 0 && (
                  <div style={{
                    position: 'absolute', bottom: '4px', right: '8px',
                    color: '#fbbf24', fontWeight: 'bold', fontSize: '1.1rem',
                    textShadow: '0 0 4px #000, 0 0 8px #000',
                  }}>+{weaponPlusLevel}</div>
                )}
                {isWeaponSlot && (
                  <div style={{
                    position: 'absolute', top: '2px', right: '6px',
                    color: '#fbbf24', fontSize: '0.9rem', textShadow: '0 0 4px #000',
                  }}>🔒</div>
                )}
              </>
            ) : (
              <div style={{
                color: 'rgba(212, 175, 55, 0.5)', fontSize: '0.85rem',
                fontStyle: 'italic', textAlign: 'center',
              }}>
                {EQUIPMENT_SLOT_LABELS[cond]}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ========== STATS PANEL (version embarquée, sans overlay) ==========
// Même logique que StatsModal mais rendue en-ligne à côté de l'inventaire.
const StatsPanel = ({ player }) => {
  if (!player || player.role !== "survivor") return null;

  const inventory = player.inventory || [];
  let damageBonus = 0;
  let healthBonus = 0;
  let initiativeBonus = 0;

  inventory.forEach(item => {
    if (item && item.type === 'rune_dommage')    damageBonus     += 2;
    if (item && item.type === 'rune_vitalite')   healthBonus     += 8;
    if (item && item.type === 'rune_initiative') initiativeBonus += 3;
  });

  // Bonus permanents (forge) déjà stockés sur le joueur
  damageBonus     += player.damage_bonus     || 0;
  initiativeBonus += player.initiative_bonus || 0;
  healthBonus     += Math.max(0, (player.max_hp || 36) - 36);

  const baseHealth = 36;
  const DAMAGE_MIN = 1, DAMAGE_MAX = 6;
  const INIT_MIN   = 1, INIT_MAX   = 20;

  const totalDamage     = `${DAMAGE_MIN + damageBonus} à ${DAMAGE_MAX + damageBonus}`;
  const totalHealth     = baseHealth + healthBonus;
  const totalInitiative = `${INIT_MIN + initiativeBonus} à ${INIT_MAX + initiativeBonus}`;

  const currentHP = player.hp || baseHealth;
  const maxHP     = totalHealth;

  const rowStyle = {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    padding: '14px',
    borderRadius: '8px',
    border: '1px solid rgba(212, 175, 55, 0.2)',
  };
  const rowHeaderStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '6px',
  };
  const labelStyle = { color: '#d4af37', fontSize: '1rem', fontWeight: 'bold' };
  const valueStyle = { color: '#e8dcc4', fontSize: '1.1rem', fontWeight: 'bold' };
  const bonusStyle = { color: '#10b981', fontSize: '0.85rem' };

  return (
    <div
      data-testid="stats-panel"
      style={{
        width: 'min(28vw, 80vh, 320px)',
        backgroundColor: '#2a1f17',
        border: '3px solid #d4af37',
        borderRadius: 12,
        padding: '18px',
        color: '#f5e6c8',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        boxShadow: '0 0 20px rgba(212, 175, 55, 0.25)',
      }}
    >
      {/* En-tête */}
      <div style={{ textAlign: 'center', paddingBottom: '10px', borderBottom: '2px solid rgba(212, 175, 55, 0.3)' }}>
        <div style={{ color: '#d4af37', fontSize: '1.3rem', fontWeight: 'bold' }}>⚔️ Caractéristiques</div>
        <div style={{ color: '#e8dcc4', fontSize: '1.05rem', marginTop: 4 }}>{player.name}</div>
        <div style={{ color: '#b8956a', fontSize: '0.95rem' }}>{player.character_class}</div>
      </div>

      {/* Vitalité */}
      <div style={rowStyle}>
        <div style={rowHeaderStyle}>
          <span style={labelStyle}>❤️ Vitalité</span>
          <span style={valueStyle}>{currentHP}/{maxHP}</span>
        </div>
        {healthBonus > 0 && <div style={bonusStyle}>+{healthBonus} PV (Runes de vitalité)</div>}
      </div>

      {/* Dégâts */}
      <div style={rowStyle}>
        <div style={rowHeaderStyle}>
          <span style={labelStyle}>⚔️ Dégâts de base</span>
          <span style={valueStyle}>{totalDamage}</span>
        </div>
        {damageBonus > 0 && <div style={bonusStyle}>+{damageBonus} dégâts (Runes de dommage)</div>}
      </div>

      {/* Initiative */}
      <div style={rowStyle}>
        <div style={rowHeaderStyle}>
          <span style={labelStyle}>⚡ Initiative</span>
          <span style={valueStyle}>{totalInitiative}</span>
        </div>
        {initiativeBonus > 0 && <div style={bonusStyle}>+{initiativeBonus} initiative (Runes d'initiative)</div>}
      </div>

      {/* Or */}
      <div style={rowStyle}>
        <div style={rowHeaderStyle}>
          <span style={labelStyle}>💰 Or</span>
          <span style={valueStyle}>{player.gold || 0}</span>
        </div>
      </div>
    </div>
  );
};

// ========== INVENTORY MODAL COMPONENT ==========
const InventoryModal = ({ player, onClose, sessionId }) => {
  const [deleteMode, setDeleteMode] = useState(false);
  const [pendingDeleteSlot, setPendingDeleteSlot] = useState(null); // {index, item}
  const [inspectedItem, setInspectedItem] = useState(null);

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

  const handleSlotClick = (index, item) => {
    if (!item) return;

    // If in delete mode, select this item for confirmation
    if (deleteMode) {
      setPendingDeleteSlot({ index, item });
      return;
    }

    // Clic direct sur le slot ouvre le popup d'infos (remplace le bouton "i")
    setInspectedItem({ ...item, _slotIndex: index });
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
        zIndex: 3100,
      }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '20px',
          maxWidth: '95vw',
        }}
      >
        {/* === GRILLE INVENTAIRE (existante) === */}
        <div
          style={{
            position: 'relative',
            width: 'min(70vw, 80vh, 600px)',
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
          const isCursed = item && (item.cursed || item.cursed_display);
          const isRealCursed = item && item.cursed;
          return (
            <div
              key={index}
              className={`inventory-slot${isCursed ? ' cursed-slot' : ''}`}
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
                  : (isCursed ? '2px solid #7c3aed' : (isHighlighted ? '2px dashed #fca5a5' : 'none')),
                outlineOffset: '-2px',
                borderRadius: '8px',
                animation: isCursed
                  ? 'cursedPulse 1.5s ease-in-out infinite'
                  : (isHighlighted && !isSelectedForDeletion ? 'pulse 1.2s ease-in-out infinite' : 'none'),
              }}
              title={isCursed ? (isRealCursed ? `⚠️ MAUDIT — ${ITEM_NAMES[item.type] || item.type}` : `⚠️ Peut-être maudit — ${ITEM_NAMES[item.type] || item.type}`) : (item ? ITEM_NAMES[item.type] || item.type : '')}
            >
              {item && (
                <>
                  <img
                    src={ITEM_SPRITES[item.type] || '/inventory/placeholder.png'}
                    alt={ITEM_NAMES[item.type] || item.type}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      filter: isCursed
                        ? 'drop-shadow(0 0 8px #7c3aed) drop-shadow(0 0 16px #a855f7) sepia(0.3) hue-rotate(240deg)'
                        : 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5))',
                      pointerEvents: 'none',
                    }}
                  />
                  {isCursed && (
                    <div style={{
                      position: 'absolute',
                      top: '-6px',
                      right: '-6px',
                      fontSize: '14px',
                      lineHeight: 1,
                      pointerEvents: 'none',
                      animation: 'cursedSkullBob 1s ease-in-out infinite',
                    }}>💀</div>
                  )}
                </>
              )}
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
        {/* fermeture grille inventaire existante */}

        {/* === GRILLE ÉQUIPEMENT === */}
        <EquipmentGrid player={player} sessionId={sessionId} onInspect={setInspectedItem} />

        {/* === NEW: PANNEAU CARACTÉRISTIQUES (à droite de l'équipement) === */}
        <StatsPanel player={player} />
      {/* fin wrapper flex */}
      </div>

      {inspectedItem && (
        <ItemInfoModal
          item={inspectedItem}
          onClose={() => setInspectedItem(null)}
          player={player}
          sessionId={sessionId}
        />
      )}
    </div>
  );
};

// ========== RUNE PICKUP MODAL COMPONENT ==========
const RunePickupModal = ({ event, playerId, sessionId, onOpenInventory, player }) => {
  if (!event || event.type !== 'rune_found') return null;
  
  const runeType = event.rune_type;
  // Recalculate live from actual inventory so freeing a slot immediately unlocks the button
  const inventory = player?.inventory || [];
  const inventoryFull = inventory.filter(Boolean).length >= 9;
  
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
              onClick={inventoryFull ? onOpenInventory : handlePickup}
              style={{
                backgroundColor: inventoryFull ? '#b45309' : '#10b981',
                color: '#fff',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              {inventoryFull ? '🎒 Gérer l\'inventaire' : '🎒 Ramasser'}
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

// ========== LAIT LEW PICKUP MODAL COMPONENT ==========
const LaitLewPickupModal = ({ event, playerId, sessionId, onOpenInventory, player }) => {
  if (!event || event.type !== 'lait_lew_found') return null;

  const inventory = player?.inventory || [];
  const inventoryFull = inventory.filter(Boolean).length >= 9;

  const handlePickup = async () => {
    try {
      const response = await axios.post(`${API}/game/${sessionId}/pickup_lait_lew`, {
        player_id: playerId,
      });
      if (response.data.status === 'success') {
        toast.success(`🥛 ${ITEM_NAMES.lait_lew} ajouté à l'inventaire !`);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.detail || 'Erreur lors du ramassage';
      if (errorMsg === 'Inventaire plein') {
        toast.error('❌ Inventaire plein !');
      } else {
        toast.error(errorMsg);
      }
    }
  };

  const handleDismiss = async () => {
    try {
      await axios.post(`${API}/game/${sessionId}/dismiss_lait_lew`, {
        player_id: playerId,
      });
    } catch (error) {
      console.error('Error dismissing Lait LEW:', error);
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
            🥛 Vous avez trouvé un objet mystérieux !
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <img
              src={ITEM_SPRITES.lait_lew}
              alt={ITEM_NAMES.lait_lew}
              style={{
                width: '150px',
                height: '150px',
                objectFit: 'contain',
                margin: '0 auto',
                filter: 'drop-shadow(0 4px 8px rgba(212, 175, 55, 0.5))',
              }}
            />
            <h3 style={{ color: '#e8dcc4', marginTop: '16px', fontSize: '1.4rem' }}>
              {ITEM_NAMES.lait_lew}
            </h3>
            <p style={{ color: '#bdb097', marginTop: '8px', fontSize: '0.95rem', fontStyle: 'italic' }}>
              4 PV restaurés par tour, durant 3 tours.
            </p>
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
              onClick={inventoryFull ? onOpenInventory : handlePickup}
              style={{
                backgroundColor: inventoryFull ? '#b45309' : '#10b981',
                color: '#fff',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              {inventoryFull ? "🎒 Gérer l'inventaire" : '🎒 Ramasser'}
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

// ========== PIERRE QUETE PICKUP MODAL COMPONENT ==========
const PierreQueteModal = ({ event, playerId, sessionId, targetRoom, onOpenInventory, player }) => {
  if (!event || event.type !== 'pierre_quete_found') return null;

  const inventory = player?.inventory || [];
  const inventoryFull = inventory.filter(Boolean).length >= 9;

  const handlePickup = async () => {
    try {
      const response = await axios.post(`${API}/game/${sessionId}/pickup_pierre_quete`, {
        player_id: playerId,
      });
      if (response.data.status === 'success') {
        toast.success('✨ Pierre d\'observation ajoutée à l\'inventaire !');
      }
    } catch (error) {
      const errorMsg = error.response?.data?.detail || 'Erreur lors du ramassage';
      if (errorMsg === 'Inventaire plein') {
        toast.error('❌ Inventaire plein !');
      } else {
        toast.error(errorMsg);
      }
    }
  };

  const handleDismiss = async () => {
    try {
      await axios.post(`${API}/game/${sessionId}/dismiss_pierre_quete`, {
        player_id: playerId,
      });
    } catch (error) {
      console.error('Error dismissing pierre quete:', error);
    }
  };

  return (
    <div
      className="game-over-overlay"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
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
          backgroundColor: '#1a1a2e',
          borderColor: '#d4af37',
          border: '3px solid #d4af37',
        }}
      >
        <CardHeader>
          <CardTitle style={{ color: '#d4af37', textAlign: 'center', fontSize: '1.8rem' }}>
            ✨ Vous avez trouvé la pierre d'observation !
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <img
              src="/items/Pierre_Quete.png"
              alt="Pierre d'observation"
              style={{
                width: '150px',
                height: '150px',
                objectFit: 'contain',
                margin: '0 auto',
                filter: 'drop-shadow(0 4px 12px rgba(212, 175, 55, 0.6))',
              }}
            />
            <h3 style={{ color: '#e8dcc4', marginTop: '12px', fontSize: '1.3rem' }}>
              Pierre d'observation
            </h3>
            <p style={{ color: '#a0aec0', fontSize: '0.95rem', margin: '8px 0 0' }}>
              La Pierre d'observation révèle la position de son porteur aux Orcs.
              {targetRoom && (
                <span style={{ display: 'block', marginTop: '6px', color: '#f6c90e', fontWeight: 'bold' }}>
                  Vous devez la jeter à {targetRoom}.
                </span>
              )}
            </p>
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
              onClick={inventoryFull ? onOpenInventory : handlePickup}
              data-testid="pierre-quete-pickup-btn"
              style={{
                backgroundColor: inventoryFull ? '#b45309' : '#10b981',
                color: '#fff',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              {inventoryFull ? '🎒 Gérer l\'inventaire' : '🎒 Ramasser'}
            </Button>
            <Button
              onClick={handleDismiss}
              data-testid="pierre-quete-dismiss-btn"
              style={{
                backgroundColor: '#ef4444',
                color: '#fff',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: 'bold',
              }}
            >
              ✖ Ignorer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ========== TROPHY PICKUP MODAL COMPONENT (Chaussons / Couronne / Culotte) ==========
const TrophyModal = ({ event, playerId, sessionId, onOpenInventory, player }) => {
  if (!event || event.type !== 'trophy_found') return null;

  const trophyType = event.trophy_type;
  const inventory = player?.inventory || [];
  const inventoryFull = inventory.filter(Boolean).length >= 9;
  const trophyName = ITEM_NAMES[trophyType] || 'Trophée';
  const trophySprite = ITEM_SPRITES[trophyType];
  const trophyDescription = TROPHY_DESCRIPTIONS[trophyType] || '';

  const handlePickup = async () => {
    try {
      const response = await axios.post(`${API}/game/${sessionId}/pickup_trophy`, {
        player_id: playerId,
      });
      if (response.data.status === 'success') {
        toast.success(`🏆 ${trophyName} ajouté à l'inventaire !`);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.detail || 'Erreur lors du ramassage';
      if (errorMsg === 'Inventaire plein') {
        toast.error('❌ Inventaire plein !');
      } else {
        toast.error(errorMsg);
      }
    }
  };

  const handleDismiss = async () => {
    try {
      await axios.post(`${API}/game/${sessionId}/dismiss_trophy`, {
        player_id: playerId,
      });
    } catch (error) {
      console.error('Error dismissing trophy:', error);
    }
  };

  return (
    <div
      className="game-over-overlay"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
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
          backgroundColor: '#1a1a2e',
          borderColor: '#d4af37',
          border: '3px solid #d4af37',
        }}
      >
        <CardHeader>
          <CardTitle style={{ color: '#d4af37', textAlign: 'center', fontSize: '1.8rem' }}>
            🏆 Vous avez trouvé un trophée !
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <img
              src={trophySprite}
              alt={trophyName}
              style={{
                width: '150px',
                height: '150px',
                objectFit: 'contain',
                margin: '0 auto',
                filter: 'drop-shadow(0 4px 12px rgba(212, 175, 55, 0.6))',
              }}
            />
            <h3 style={{ color: '#e8dcc4', marginTop: '12px', fontSize: '1.3rem' }}>
              {trophyName}
            </h3>
            <p style={{ color: '#a0aec0', fontSize: '0.95rem', margin: '8px 0 0', fontStyle: 'italic' }}>
              {trophyDescription}
            </p>
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
              onClick={inventoryFull ? onOpenInventory : handlePickup}
              data-testid="trophy-pickup-btn"
              style={{
                backgroundColor: inventoryFull ? '#b45309' : '#10b981',
                color: '#fff',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              {inventoryFull ? '🎒 Gérer l\'inventaire' : '🎒 Ramasser'}
            </Button>
            <Button
              onClick={handleDismiss}
              data-testid="trophy-dismiss-btn"
              style={{
                backgroundColor: '#ef4444',
                color: '#fff',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: 'bold',
              }}
            >
              ✖ Ignorer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// ========== AMULETTE PICKUP MODAL COMPONENT ==========
const AmulettePickupModal = ({ event, playerId, sessionId, onOpenInventory, player }) => {
  if (!event || (event.type !== 'amulette_tortue_found' && event.type !== 'amulette_oignon_found' && event.type !== 'amulette_trefle_found' && event.type !== 'foulard_rankyr_found' && event.type !== 'amulette_coco_found' && event.type !== 'bandana_ranja_found' && event.type !== 'bonnet_croblow_found')) return null;

  const amuletteType =
    event.type === 'amulette_oignon_found' ? 'amulette_oignon' :
    event.type === 'amulette_trefle_found' ? 'amulette_trefle' :
    event.type === 'foulard_rankyr_found' ? 'foulard_rankyr' :
    event.type === 'amulette_coco_found' ? 'amulette_coco' :
    event.type === 'bandana_ranja_found' ? 'bandana_ranja' :
    event.type === 'bonnet_croblow_found' ? 'bonnet_croblow' :
    'amulette_tortue';
  const pickupEndpoint =
    amuletteType === 'amulette_oignon' ? 'pickup_amulette_oignon' :
    amuletteType === 'amulette_trefle' ? 'pickup_amulette_trefle' :
    amuletteType === 'foulard_rankyr' ? 'pickup_foulard_rankyr' :
    amuletteType === 'amulette_coco' ? 'pickup_amulette_coco' :
    amuletteType === 'bandana_ranja' ? 'pickup_bandana_ranja' :
    amuletteType === 'bonnet_croblow' ? 'pickup_bonnet_croblow' :
    'pickup_amulette';
  // Recalculate live from actual inventory so freeing a slot immediately unlocks the button
  const inventory = player?.inventory || [];
  const inventoryFull = inventory.filter(Boolean).length >= 9;
  
  const handlePickup = async () => {
    try {
      const response = await axios.post(`${API}/game/${sessionId}/${pickupEndpoint}`, {
        player_id: playerId
      });
      
      if (response.data.status === 'success') {
        toast.success(`✨ ${ITEM_NAMES[amuletteType]} ajoutée à l'inventaire !`);
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
      await axios.post(`${API}/game/${sessionId}/dismiss_amulette`, {
        player_id: playerId
      });
    } catch (error) {
      console.error("Error dismissing amulette:", error);
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
          maxWidth: '600px',
          backgroundColor: '#2a1f17',
          borderColor: '#d4af37',
          border: '3px solid #d4af37',
        }}
      >
        <CardHeader>
          <CardTitle style={{ color: '#d4af37', textAlign: 'center', fontSize: '1.8rem' }}>
            ✨ Vous avez trouvé une amulette !
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <img
              src={ITEM_SPRITES[amuletteType]}
              alt={ITEM_NAMES[amuletteType]}
              style={{
                width: '150px',
                height: '150px',
                objectFit: 'contain',
                margin: '0 auto',
                filter: 'drop-shadow(0 4px 8px rgba(212, 175, 55, 0.5))',
              }}
            />
            <h3 style={{ color: '#e8dcc4', marginTop: '16px', fontSize: '1.4rem' }}>
              {ITEM_NAMES[amuletteType]}
            </h3>
            
            {/* Description */}
            <p style={{ color: '#b8a488', fontSize: '1rem', marginTop: '12px', fontStyle: 'italic' }}>
              {amuletteType === 'amulette_oignon'
                ? "L'oignon fait la force !"
                : amuletteType === 'amulette_trefle'
                ? "Vous aurez de la chance dans votre malheur."
                : amuletteType === 'foulard_rankyr'
                ? "Ce foulard appartenait autrefois à un trésorier tenu de la comptabilité de son royaume."
                : amuletteType === 'amulette_coco'
                ? "Cette amulette appartenait autrefois à un aventurier globetrotteur qui l'a confectionnée à partir de morceaux de coco trouvés sur différentes îles."
                : amuletteType === 'bandana_ranja'
                ? "Son porteur n'a jamais réellement porté de bandana de sa vie, ce qui vous donne l'occasion d'enfin porter quelque chose de neuf."
                : amuletteType === 'bonnet_croblow'
                ? "Amoureux de la nature, Croblow a porté ce bonnet sur lequel quelques fleurs trouvent miraculeusement encore racine."
                : "Être lent n'est pas forcément un vilain défaut. Vous saurez en tirer profit pour cette fois !"}
            </p>
            
            {/* Effet */}
            <div style={{
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '2px solid #10b981',
              borderRadius: '8px',
              padding: '12px',
              marginTop: '16px',
              color: '#10b981',
              textAlign: 'left',
              fontSize: '0.95rem'
            }}>
              <strong>Effet :</strong> {amuletteType === 'amulette_oignon'
                ? "Vous infligez 50% de dégats supplémentaires si vous êtes plusieurs aventuriers dans le combat."
                : amuletteType === 'amulette_trefle'
                ? "Vous obtenez 50% d'or en plus en explorant une pièce, mais vous subissez 50% de dégâts supplémentaires en combat."
                : amuletteType === 'foulard_rankyr'
                ? "Dans un combat, vous infligez 50% de dégâts supplémentaires tant que vous n'avez pas subi de dégâts. L'effet se réinitialise à chaque nouveau combat."
                : amuletteType === 'amulette_coco'
                ? "En combat, lorsque vos PV passent sous 30% de vos PV max, vos dégâts infligés sont augmentés de 75%."
                : amuletteType === 'bandana_ranja'
                ? "Si vous avez la plus haute initiative en combat (aventuriers compris), vos dégâts infligés sont augmentés de 50% pour le reste du combat."
                : amuletteType === 'bonnet_croblow'
                ? "Dans un combat, vous vous soignez vous et vos alliés à hauteur de 10% des dégâts que vous infligez. L'effet se réinitialise à chaque nouveau combat."
                : "vous réduisez de 25% tous dégâts reçus si vous avez l'initiative la plus basse durant le combat."}
            </div>
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
              onClick={inventoryFull ? onOpenInventory : handlePickup}
              style={{
                backgroundColor: inventoryFull ? '#b45309' : '#10b981',
                color: '#fff',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              {inventoryFull ? '🎒 Gérer l\'inventaire' : '🎒 Ramasser'}
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

const GoblinStatChoiceModal = ({ gameState, playerId, sessionId }) => {
  const player = gameState?.players?.[playerId];
  const pendingEvent = gameState?.pending_events?.[playerId];

  if (!player || player.role !== 'killer') return null;
  if (!pendingEvent || pendingEvent.type !== 'goblin_roulette_choice') return null;

  const goblinStats = player.goblin_stats || {
    damage: 0,
    hp: 0,
    initiative: 0,
    multipliers: { damage: 1, hp: 1, initiative: 1 },
  };

  const handleChooseStat = async (statChosen) => {
    try {
      await axios.post(`${API}/game/${sessionId}/goblin_choose_stat`, {
        player_id: playerId,
        stat_chosen: statChosen,
      });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erreur lors du choix");
    }
  };

  return (
    <div
      className="game-over-overlay"
      style={{ zIndex: 3500 }}
      data-testid="goblin-stat-choice-modal"
    >
      <Card style={{ maxWidth: '700px', backgroundColor: '#1a0f0a', border: '3px solid #ff6b35' }}>
        <CardHeader>
          <CardTitle style={{ color: '#ff6b35', textAlign: 'center', fontSize: '2rem' }}>
            👹 Renforcez votre Gobelin !
          </CardTitle>
        </CardHeader>

        <CardContent>
          <p style={{ color: '#e8dcc4', textAlign: 'center', marginBottom: '2rem', fontSize: '1.1rem' }}>
            Choisissez une statistique à améliorer. Plus vous négligez une stat, plus son multiplicateur augmente !
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            {/* BOUTON DÉGÂTS */}
            <button
              onClick={() => handleChooseStat('damage')}
              data-testid="goblin-stat-damage-btn"
              style={{
                background: 'linear-gradient(180deg, #ef4444 0%, #991b1b 100%)',
                border: '3px solid #fca5a5',
                borderRadius: '12px',
                padding: '1.5rem 1rem',
                color: '#fff',
                cursor: 'pointer',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🗡️</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Dégâts</div>
              <div style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                Actuel : +{goblinStats.damage} / 15
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '0.5rem', color: '#fcd34d' }}>
                x{goblinStats.multipliers.damage}
              </div>
            </button>

            {/* BOUTON VITALITÉ */}
            <button
              onClick={() => handleChooseStat('hp')}
              data-testid="goblin-stat-hp-btn"
              style={{
                background: 'linear-gradient(180deg, #ec4899 0%, #9f1239 100%)',
                border: '3px solid #f9a8d4',
                borderRadius: '12px',
                padding: '1.5rem 1rem',
                color: '#fff',
                cursor: 'pointer',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>❤️</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Vitalité</div>
              <div style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                Actuel : +{goblinStats.hp} / 24
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '0.5rem', color: '#fcd34d' }}>
                x{goblinStats.multipliers.hp}
              </div>
            </button>

            {/* BOUTON INITIATIVE */}
            <button
              onClick={() => handleChooseStat('initiative')}
              data-testid="goblin-stat-initiative-btn"
              style={{
                background: 'linear-gradient(180deg, #f59e0b 0%, #b45309 100%)',
                border: '3px solid #fde68a',
                borderRadius: '12px',
                padding: '1.5rem 1rem',
                color: '#fff',
                cursor: 'pointer',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚡</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Initiative</div>
              <div style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                Actuel : +{goblinStats.initiative} / 15
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '0.5rem', color: '#fcd34d' }}>
                x{goblinStats.multipliers.initiative}
              </div>
            </button>
          </div>

          <p style={{ color: '#9ca3af', textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', fontStyle: 'italic' }}>
            💡 Le multiplicateur augmente de x1 → x2 → x3 pour chaque tour où la stat n'est pas choisie
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

const GoblinRouletteModal = ({ gameState, playerId, sessionId }) => {
  const player = gameState?.players?.[playerId];
  const pendingEvent = gameState?.pending_events?.[playerId];

  const statChosen = pendingEvent?.stat_chosen;
  const multiplier = pendingEvent?.multiplier || 1;

  // ===== Config (défilement fluide, vitesse constante) =====
  const SPIN_SPEED_MS = 150;                           // ⚡ +25% vitesse (était 200 ms)
  const SLOT_WIDTH = 110;                              // largeur d'un slot
  const VISIBLE_SLOTS = 5;                              // 5 valeurs visibles
  const CENTER_OFFSET = Math.floor(VISIBLE_SLOTS / 2);  // = 2

  // States (hooks toujours appelés avant tout return conditionnel)
  const [tick, setTick] = useState(0);
  const [isSpinning, setIsSpinning] = useState(true);
  const [stopped, setStopped] = useState(false);
  const [showParticles, setShowParticles] = useState(false);

  const isActive =
    player && player.role === 'killer' &&
    pendingEvent && pendingEvent.type === 'goblin_roulette_active';

  // Bande de base, puis bande très longue (60 répétitions) pour défilement continu
  const baseSequence = useMemo(
    () => GOBLIN_ROULETTE_SEQUENCE.map((val) => val * multiplier),
    [multiplier]
  );
  const strip = useMemo(() => {
    const out = [];
    for (let i = 0; i < 60; i++) out.push(...baseSequence);
    return out;
  }, [baseSequence]);

  const centerIndex = (tick + CENTER_OFFSET) % strip.length;
  const currentValue = strip[centerIndex];

  const getValueColor = (value) => {
    const baseValue = value / multiplier;
    if (multiplier === 3) {
      if (baseValue === 3) return '#ef4444';
      if (baseValue === 2) return '#8b5cf6';
      return '#06b6d4';
    } else if (multiplier === 2) {
      if (baseValue === 3) return '#8b5cf6';
      if (baseValue === 2) return '#3b82f6';
      return '#10b981';
    } else {
      if (baseValue === 3) return '#f59e0b';
      if (baseValue === 2) return '#3b82f6';
      return '#10b981';
    }
  };

  const handleStop = async () => {
    if (!isSpinning || stopped) return;

    setStopped(true);
    setIsSpinning(false);
    setShowParticles(true);

    const valueObtained = currentValue;

    try {
      const response = await axios.post(`${API}/game/${sessionId}/goblin_stop_roulette`, {
        player_id: playerId,
        stat_chosen: statChosen,
        value_obtained: valueObtained,
      });

      const gained = response.data.gained;
      const total = response.data.total;

      setTimeout(() => {
        toast.success(`✨ +${gained} ${getStatLabel(statChosen)} ! Total : ${total}`, {
          duration: 4000,
          icon: getStatIcon(statChosen),
        });
      }, 700);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erreur");
    }
  };

  // Tick à intervalle FIXE 150 ms (vitesse constante)
  useEffect(() => {
    if (!isActive || !isSpinning) return;

    const timer = setTimeout(() => {
      setTick((prev) => {
        const next = prev + 1;
        if (next >= strip.length - VISIBLE_SLOTS - 1) return next % baseSequence.length;
        return next;
      });
    }, SPIN_SPEED_MS);

    return () => clearTimeout(timer);
  }, [tick, isActive, isSpinning, strip.length, baseSequence.length]);

  // Gestion de la touche SPACE
  useEffect(() => {
    if (!isActive) return;
    const handleKeyPress = (e) => {
      if (e.code === 'Space' && isSpinning) {
        e.preventDefault();
        handleStop();
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isActive, isSpinning, tick]);

  if (!isActive) return null;

  const translateX = -tick * SLOT_WIDTH;
  const particles = Array.from({ length: 14 }, (_, i) => i);

  return (
    <div className="game-over-overlay" style={{ zIndex: 3500 }} data-testid="goblin-roulette-modal">
      <Card style={{ maxWidth: '600px', backgroundColor: '#1a0f0a', border: '3px solid #ff6b35' }}>
        <CardHeader>
          <CardTitle style={{ color: '#ff6b35', textAlign: 'center', fontSize: '1.8rem' }}>
            🎰 Roulette {getStatLabel(statChosen)} (x{multiplier})
          </CardTitle>
        </CardHeader>

        <CardContent>
          {/* Triangle indicateur central */}
          <div className="goblin-roulette-pointer">
            <div className="goblin-roulette-triangle" />
          </div>

          {/* Viewport 5 slots avec fade sur les bords */}
          <div
            className={`goblin-roulette-viewport ${stopped ? 'goblin-roulette-shake' : ''}`}
            style={{ width: `${VISIBLE_SLOTS * SLOT_WIDTH}px`, margin: '0 auto 1.5rem' }}
          >
            {/* Halo central qui se contracte puis explose */}
            <div
              className={`goblin-roulette-spotlight ${stopped ? 'goblin-roulette-spotlight-burst' : ''}`}
              style={{ width: `${SLOT_WIDTH}px` }}
            />

            {/* Particules radiales */}
            {showParticles && particles.map((i) => (
              <span
                key={i}
                className="goblin-roulette-particle"
                style={{
                  '--angle': `${(i / particles.length) * 360}deg`,
                  '--burst-color': getValueColor(currentValue),
                  animationDelay: `${i * 15}ms`,
                }}
              />
            ))}

            {/* Bande défilante : translateX + transition linear 200ms */}
            <div
              className="goblin-roulette-strip"
              style={{
                transform: `translateX(${translateX}px)`,
                transition: isSpinning
                  ? `transform ${SPIN_SPEED_MS}ms linear`
                  : `transform ${SPIN_SPEED_MS}ms cubic-bezier(0.2, 0.85, 0.25, 1)`,
              }}
            >
              {strip.map((val, i) => {
                const isCenter = i === centerIndex;
                return (
                  <div
                    key={i}
                    className={`goblin-roulette-slot ${isCenter && stopped ? 'goblin-roulette-slot-winner' : ''}`}
                    style={{ width: `${SLOT_WIDTH}px`, color: getValueColor(val) }}
                  >
                    +{val}
                  </div>
                );
              })}
            </div>
          </div>

          {isSpinning ? (
            <Button
              onClick={handleStop}
              style={{
                width: '100%',
                padding: '1.5rem',
                fontSize: '1.5rem',
                fontWeight: 'bold',
                backgroundColor: '#ef4444',
                color: '#fff',
                border: '3px solid #fca5a5',
                cursor: 'pointer',
                animation: 'goblinPulse 1s infinite',
              }}
              data-testid="goblin-roulette-stop-btn"
            >
              ⏸️ ARRÊTER (SPACE)
            </Button>
          ) : (
            <div style={{ textAlign: 'center', padding: '1.5rem', fontSize: '1.2rem', color: '#10b981' }}>
              ✅ Bonus appliqué !
            </div>
          )}

          <p style={{ color: '#9ca3af', textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem', fontStyle: 'italic' }}>
            💡 Visez le +{Math.max(...baseSequence)} mais attention : il est entouré de +{Math.min(...baseSequence)} !
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

const Home = () => {
  // Step: "menu" = create/join choice, "configure" = player setup
  const [step, setStep] = useState("menu");
  const [mode, setMode] = useState(null); // "create" or "join"
  const [showNamePrompt, setShowNamePrompt] = useState(false); // Pour l'écran de demande de pseudo
  const [tempJoinName, setTempJoinName] = useState(""); // Nom temporaire avant validation
  
  const [playerName, setPlayerName] = useState("");
  const [selectedRole, setSelectedRole] = useState("survivor");
  const [selectedAvatar, setSelectedAvatar] = useState(SURVIVOR_AVATARS[0]);
  const [conspiracyMode, setConspiracyMode] = useState(false);
  const [joinSessionId, setJoinSessionId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [createdSessionId, setCreatedSessionId] = useState(null);
  const [showJoinInput, setShowJoinInput] = useState(false);
  // True when the user comes back from the lobby to change their role/class.
  // In that case the configure form must still expose role + avatar selection
  // even though the mode is "join".
  const [isUpdatingPlayer, setIsUpdatingPlayer] = useState(false);
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
      setIsUpdatingPlayer(true);
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

  // Step 1: Join → validate session exists, then show name prompt screen
  const handleJoinClick = async () => {
    if (!joinSessionId.trim()) {
      toast.error("Veuillez entrer un code de session");
      return;
    }
    
    // Vérifier que la session existe
    try {
      await axios.get(`${API}/game/${joinSessionId}/state`);
      // Session valide, afficher l'écran de saisie du pseudo
      setShowNamePrompt(true);
    } catch (error) {
      toast.error("Session introuvable. Vérifiez le code.");
    }
  };

  // Nouvelle fonction pour confirmer le pseudo et rejoindre
  const confirmJoinWithName = async () => {
    if (!tempJoinName.trim()) {
      toast.error("Veuillez entrer un pseudo");
      return;
    }
    
    setIsJoining(true);
    try {
      // Rejoindre sans avatar ni rôle (seront choisis dans le lobby)
      const response = await axios.post(`${API}/game/${joinSessionId}/join`, {
        player_name: tempJoinName.trim()
      });

      const { session_id, player_id } = response.data;
      sessionStorage.setItem('player_id', player_id);
      sessionStorage.setItem('player_name', tempJoinName.trim());
      
      // Réinitialiser et naviguer vers le lobby
      setShowNamePrompt(false);
      setTempJoinName("");
      navigate(`/lobby/${session_id}`);
      toast.success("Bienvenue ! Choisissez votre camp et votre classe.");
    } catch (error) {
      console.error("Error joining game:", error);
      toast.error("Erreur : impossible de rejoindre la partie");
    } finally {
      setIsJoining(false);
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
            player_name: playerName
            // player_avatar et role seront choisis dans le lobby (lobby-first flow)
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

  // ==================== NAME PROMPT SCREEN (for joining) ====================
  if (showNamePrompt) {
    return (
      <div className="home-container" data-testid="join-name-prompt">
        <div className="home-content">
          <h1 className="game-title">VOTRE NOM</h1>

          {/* Session code display */}
          <div style={{
            textAlign: 'center',
            marginBottom: '2rem',
            padding: '1rem',
            background: 'rgba(212, 175, 55, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(212, 175, 55, 0.3)'
          }}>
            <p style={{ color: '#d4af37', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              Rejoindre la session
            </p>
            <p style={{ 
              color: '#fff', 
              fontSize: '1.5rem', 
              fontWeight: 'bold',
              letterSpacing: '0.1em'
            }}>
              {joinSessionId}
            </p>
          </div>

          {/* Name input */}
          <div style={{ marginBottom: '2rem' }}>
            <label htmlFor="join-name-input" style={{
              display: 'block',
              marginBottom: '0.8rem',
              fontSize: '1.1rem',
              color: '#d4af37',
              textAlign: 'center',
              fontFamily: 'MedievalSharp, serif'
            }}>
              Entrez votre pseudo
            </label>
            <input
              id="join-name-input"
              type="text"
              value={tempJoinName}
              onChange={(e) => setTempJoinName(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && tempJoinName.trim() && !isJoining) {
                  confirmJoinWithName();
                }
              }}
              placeholder="Votre pseudo..."
              maxLength={20}
              autoFocus
              style={{
                width: '100%',
                maxWidth: '400px',
                padding: '1rem 1.5rem',
                fontSize: '1.1rem',
                background: 'rgba(30, 20, 10, 0.6)',
                border: '2px solid rgba(212, 175, 55, 0.5)',
                borderRadius: '8px',
                color: '#fff',
                outline: 'none',
                transition: 'all 0.3s ease',
                fontFamily: 'MedievalSharp, serif'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#d4af37';
                e.target.style.boxShadow = '0 0 20px rgba(212, 175, 55, 0.3)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(212, 175, 55, 0.5)';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>

          {/* Buttons */}
          <div style={{ 
            display: 'flex', 
            gap: '1rem', 
            justifyContent: 'center',
            flexWrap: 'wrap'
          }}>
            <Button
              onClick={confirmJoinWithName}
              disabled={!tempJoinName.trim() || isJoining}
              className="menu-button primary"
              style={{
                minWidth: '200px',
                padding: '1rem 2rem',
                fontSize: '1.1rem',
                background: tempJoinName.trim() && !isJoining
                  ? 'linear-gradient(135deg, #d4af37 0%, #aa8929 100%)'
                  : 'rgba(100, 100, 100, 0.3)',
                border: '2px solid',
                borderColor: tempJoinName.trim() && !isJoining ? '#d4af37' : '#555',
                color: tempJoinName.trim() && !isJoining ? '#1a0f0a' : '#666',
                cursor: tempJoinName.trim() && !isJoining ? 'pointer' : 'not-allowed',
                fontWeight: 'bold',
                borderRadius: '8px',
                transition: 'all 0.3s ease',
                textTransform: 'uppercase',
                fontFamily: 'MedievalSharp, serif'
              }}
            >
              {isJoining ? '⏳ Connexion...' : '⚔️ Rejoindre le donjon'}
            </Button>

            <Button
              onClick={() => {
                setShowNamePrompt(false);
                setTempJoinName("");
                setSelectedRole(null);
              }}
              disabled={isJoining}
              className="menu-button secondary"
              style={{
                minWidth: '150px',
                padding: '1rem 2rem',
                fontSize: '1.1rem',
                background: 'rgba(100, 30, 30, 0.5)',
                border: '2px solid rgba(200, 50, 50, 0.5)',
                color: '#ff6b6b',
                cursor: isJoining ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                borderRadius: '8px',
                transition: 'all 0.3s ease',
                textTransform: 'uppercase',
                fontFamily: 'MedievalSharp, serif'
              }}
            >
              ❌ Annuler
            </Button>
          </div>

          {/* Helper text */}
          <p style={{
            marginTop: '2rem',
            fontSize: '0.9rem',
            color: '#999',
            textAlign: 'center'
          }}>
            Vous pourrez choisir votre camp et votre classe dans le lobby
          </p>
        </div>
      </div>
    );
  }

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

            {/* Role + Avatar selection — shown when CREATING a session or
                when an existing player came back from the lobby to update
                their role/class. In a fresh JOIN flow the form only asks for
                the pseudo; the player picks role + class inside the lobby. */}
            {(mode === "create" || isUpdatingPlayer) && (
            <>
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
            </>
            )}

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
        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
          <Button
            data-testid="confirm-config-btn"
            onClick={confirmConfiguration}
            disabled={isCreating || isJoining}
            className="primary-btn"
            style={{ flex: 1, padding: '1rem', fontSize: '1.1em' }}
          >
            {isCreating ? "Création..." : isJoining ? "Connexion..." :
              mode === "create" ? "⚔️ Créer et entrer dans le donjon" : "🚪 Rejoindre le donjon"}
          </Button>
          <Button
            data-testid="cancel-config-btn"
            onClick={() => {
              // Clear any "updating" flags so the home menu shows fresh state
              sessionStorage.removeItem('is_updating_player');
              sessionStorage.removeItem('updating_player_id');
              setIsUpdatingPlayer(false);
              setStep("menu");
              setMode(null);
              setJoinSessionId("");
            }}
            disabled={isCreating || isJoining}
            className="secondary-btn"
            style={{
              flex: '0 0 auto',
              padding: '1rem 1.5rem',
              fontSize: '1.05em',
              background: 'rgba(60, 60, 60, 0.7)',
              border: '2px solid #555',
              color: '#eee'
            }}
          >
            Annuler
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
  // NEW: Lobby-first role/avatar selection state
  const [showRoleAvatarPicker, setShowRoleAvatarPicker] = useState(false);
  const [lobbySelectedRole, setLobbySelectedRole] = useState('survivor');
  const [lobbySelectedAvatar, setLobbySelectedAvatar] = useState(SURVIVOR_AVATARS[0]);

  // NEW: Game settings modal (host only)
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [localRequiredRelics, setLocalRequiredRelics] = useState({
    relique_spherique: true,
    relique_cubique: true,
    relique_triangulaire: true,
  });
  const [localDungeonSize, setLocalDungeonSize] = useState(12);

  const ALL_POWERS = [
    { key: "vision",         label: "👁️ Vision" },
    { key: "secousse",       label: "↩️ Secousse" },
    { key: "piege",          label: "🥶 Blizzard" },
    { key: "toxine",         label: "😷 Toxine" },
    { key: "traque",         label: "🔊 Traque" },
    { key: "barricade",      label: "🔒 Barricade" },
    { key: "rage",           label: "😡 Rage" },
    { key: "mimic",          label: "💰 Mimic" },
    { key: "teleportation",  label: "🌀 Piège de Téléportation" },
    { key: "goliath",        label: "⚔️ Poursuite" },
    { key: "eboulement",     label: "⛰️ Eboulement" },
    { key: "patrouille",     label: "🔍 Espionnage" },
    { key: "malediction",    label: "🔮 Malédiction" },
  ];
  const [localEnabledPowers, setLocalEnabledPowers] = useState(
    Object.fromEntries(ALL_POWERS.map(p => [p.key, true]))
  );

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

  // NEW: Lobby-first — le joueur valide son rôle/avatar depuis la salle d'attente
  const handleSelectRoleAndClass = async () => {
    if (!lobbySelectedAvatar) {
      toast.error("Veuillez choisir un avatar");
      return;
    }
    try {
      await axios.post(`${API}/game/${sessionId}/select_role`, {
        player_id: playerId,
        role: lobbySelectedRole,
        player_avatar: lobbySelectedAvatar.path
      });
      setShowRoleAvatarPicker(false);
      toast.success("Camp choisi !");
      // Le state_update WebSocket mettra à jour l'UI automatiquement
    } catch (error) {
      console.error("Error selecting role:", error);
      toast.error(error.response?.data?.detail || "Erreur lors du choix du rôle");
    }
  };

  const startGame = async () => {
    // Vérification côté client : au moins un pouvoir doit être activé
    const enabledPowers = gameState.enabled_powers;
    if (enabledPowers && enabledPowers.length === 0) {
      toast.error("⚠️ Au moins un pouvoir doit être activé", {
        duration: 4000,
        style: { maxWidth: '400px' }
      });
      return;
    }
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

  // NEW: sync local settings with backend state (must be before any early return)
  useEffect(() => {
    if (gameState?.required_relics) {
      setLocalRequiredRelics(gameState.required_relics);
    }
    if (gameState?.dungeon_size !== undefined) {
      setLocalDungeonSize(gameState.dungeon_size);
    }
    if (gameState?.enabled_powers) {
      setLocalEnabledPowers(
        Object.fromEntries(ALL_POWERS.map(p => [p.key, gameState.enabled_powers.includes(p.key)]))
      );
    }
  }, [gameState?.required_relics, gameState?.dungeon_size, gameState?.enabled_powers]);

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
              {player.avatar
                ? <img src={player.avatar} alt={player.name} style={{ width: '3.5rem', height: '3.5rem', objectFit: 'contain' }} />
                : <span style={{ width: '3.5rem', height: '3.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>❓</span>
              }
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

  {/* NEW: Lobby-first — panneau de sélection de rôle pour le joueur courant */}
  {(() => {
    const currentPlayer = gameState.players[playerId];
    if (!currentPlayer || currentPlayer.role || gameState.conspiracy_mode) return null;
    const survivors = Object.values(gameState.players).filter(p => p.role === "survivor").length;
    const killers = Object.values(gameState.players).filter(p => p.role === "killer").length;
    const suggestion = survivors > killers + 1 ? "💡 Les Orcs ont besoin de renfort !" :
                       killers > survivors + 1 ? "💡 Les Aventuriers ont besoin de renfort !" : null;

    if (!showRoleAvatarPicker) {
      // Ouvrir automatiquement si le joueur n'a pas encore de rôle
      setShowRoleAvatarPicker(true);
      return null;
    }

    const lobbyAvatars = lobbySelectedRole === 'survivor' ? SURVIVOR_AVATARS : KILLER_AVATARS;
    return (
      <div style={{
        marginTop: '1.5rem', padding: '1rem',
        background: 'rgba(30, 20, 10, 0.9)',
        border: '2px solid rgba(212, 175, 55, 0.5)',
        borderRadius: '10px'
      }}>
        <h3 style={{ textAlign: 'center', color: '#d4af37', marginBottom: '0.75rem', fontSize: '1.1em' }}>
          Choisissez votre camp
        </h3>
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
          {['survivor', 'killer'].map(r => (
            <button key={r}
              onClick={() => {
                setLobbySelectedRole(r);
                setLobbySelectedAvatar(r === 'survivor' ? SURVIVOR_AVATARS[0] : KILLER_AVATARS[0]);
              }}
              style={{
                flex: 1, padding: '0.6rem', fontWeight: 'bold', cursor: 'pointer',
                borderRadius: '6px', border: `2px solid ${lobbySelectedRole === r ? '#d4af37' : '#555'}`,
                backgroundColor: lobbySelectedRole === r ? 'rgba(212,175,55,0.2)' : 'rgba(255,255,255,0.05)',
                color: '#fff'
              }}
            >
              {r === 'survivor' ? '🛡️ Aventurier' : '🗡️ Orc'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginBottom: '1rem' }}>
          {lobbyAvatars.map((av, idx) => (
            <button key={idx}
              onClick={() => setLobbySelectedAvatar(av)}
              style={{
                width: '70px', height: '70px', padding: '4px',
                border: `2px solid ${lobbySelectedAvatar?.path === av.path ? '#d4af37' : '#555'}`,
                borderRadius: '8px', background: 'rgba(0,0,0,0.4)', cursor: 'pointer'
              }}
            >
              <img src={av.path} alt={av.class} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </button>
          ))}
        </div>
        {lobbySelectedAvatar && (
          <p style={{ textAlign: 'center', color: '#d4af37', fontSize: '0.9em', marginBottom: '0.75rem' }}>
            <strong>{lobbySelectedAvatar.class}</strong>
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setShowRoleAvatarPicker(false)}
            style={{ flex: 1, padding: '0.6rem', background: 'transparent', color: '#aaa', border: '1px solid #555', borderRadius: '6px', cursor: 'pointer' }}>
            Annuler
          </button>
          <button onClick={handleSelectRoleAndClass}
            style={{ flex: 2, padding: '0.6rem', fontWeight: 'bold', background: '#d32f2f', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
            ✔ Confirmer
          </button>
        </div>
      </div>
    );
  })()}

  {isHost && !gameState.game_started && (
    <div style={{ marginTop: '2rem', textAlign: 'center' }}>
      <button
        data-testid="game-settings-btn"
        className="settings-btn"
        onClick={() => setShowSettingsModal(true)}
      >
        ⚙️ Paramètres de la partie
      </button>
      <button
        onClick={startGame}
        disabled={Object.values(gameState.players).some(p => !p.role)}
        style={{
          display: 'block',
          margin: '0 auto',
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

  {/* Affichage en lecture seule pour les non-hôtes */}
  {!isHost && gameState.required_relics && (
    <div className="settings-readonly">
      <h4>Reliques requises pour ce donjon :</h4>
      <ul>
        <li>{gameState.required_relics.relique_spherique ? "✅" : "❌"} Relique Sphérique</li>
        <li>{gameState.required_relics.relique_cubique ? "✅" : "❌"} Relique Cubique</li>
        <li>{gameState.required_relics.relique_triangulaire ? "✅" : "❌"} Relique Triangulaire</li>
      </ul>
      <p><strong>Taille du donjon :</strong> {gameState.dungeon_size || 12} pièces</p>
      {gameState.enabled_powers && gameState.enabled_powers.length < ALL_POWERS.length && (
        <div>
          <p><strong>Pouvoirs disponibles :</strong></p>
          <ul>
            {ALL_POWERS.map(p => (
              <li key={p.key}>{gameState.enabled_powers.includes(p.key) ? "✅" : "❌"} {p.label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )}

  {/* Modal paramètres de la partie */}
  {showSettingsModal && (
    <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
      <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>⚙️ Paramètres de la partie</h2>
        <p className="modal-subtitle">
          Choisissez les reliques nécessaires pour débloquer le cristal.
          Décocher une relique réduit la difficulté.
        </p>

        <div className="relic-setting">
          <label>
            <input
              type="checkbox"
              data-testid="toggle-relique-spherique"
              checked={localRequiredRelics.relique_spherique}
              onChange={(e) => setLocalRequiredRelics(prev => ({ ...prev, relique_spherique: e.target.checked }))}
            />
            <strong>🔮 Relique Sphérique</strong>
          </label>
          <p className="relic-desc">
            Vaincre le <strong>Gobelin Fuyard</strong> caché dans une salle.
            Initiative ≥ 10 recommandée. Augmentez-la avec des runes à la forge.
          </p>
        </div>

        <div className="relic-setting">
          <label>
            <input
              type="checkbox"
              data-testid="toggle-relique-cubique"
              checked={localRequiredRelics.relique_cubique}
              onChange={(e) => setLocalRequiredRelics(prev => ({ ...prev, relique_cubique: e.target.checked }))}
            />
            <strong>🧊 Relique Cubique</strong>
          </label>
          <p className="relic-desc">
            Trouver la <strong>Pierre d'Observation</strong> et l'apporter à sa salle de destination.
            Attention : la pierre révèle votre position dès qu'elle est en inventaire.
          </p>
        </div>

        <div className="relic-setting">
          <label>
            <input
              type="checkbox"
              data-testid="toggle-relique-triangulaire"
              checked={localRequiredRelics.relique_triangulaire}
              onChange={(e) => setLocalRequiredRelics(prev => ({ ...prev, relique_triangulaire: e.target.checked }))}
            />
            <strong>🔺 Relique Triangulaire</strong>
          </label>
          <p className="relic-desc">
            Achat unique auprès du <strong>Marchand</strong> pour 1000 pièces d'or.
            Revendez des objets précieux pour réunir la somme.
          </p>
        </div>

        {/* Sélecteur taille du donjon */}
        <div className="relic-setting">
          <label htmlFor="dungeon-size-select"><strong>Taille du donjon</strong></label>
          <p className="relic-desc">
            Nombre de pièces disponibles (3 étages). Réduit la taille de la carte.
          </p>
          <select
            id="dungeon-size-select"
            data-testid="dungeon-size-select"
            value={localDungeonSize}
            onChange={(e) => setLocalDungeonSize(Number(e.target.value))}
            style={{ marginTop: '8px', padding: '6px 10px', borderRadius: '6px', width: '100%' }}
          >
            <option value={12}>12 pièces (4 par étage) — par défaut</option>
            <option value={9}>9 pièces (3 par étage)</option>
            <option value={6}>6 pièces (2 par étage)</option>
          </select>
        </div>

        {/* Sélecteur pouvoirs disponibles */}
        <div className="relic-setting">
          <label><strong>⚔️ Pouvoirs des killers disponibles</strong></label>
          <p className="relic-desc">
            Décochez les pouvoirs que vous souhaitez exclure du tirage aléatoire en partie.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' }}>
            {ALL_POWERS.map(p => (
              <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="checkbox"
                  checked={localEnabledPowers[p.key] ?? true}
                  onChange={(e) => setLocalEnabledPowers(prev => ({ ...prev, [p.key]: e.target.checked }))}
                />
                {p.label}
              </label>
            ))}
          </div>
          {!Object.values(localEnabledPowers).some(v => v) && (
            <p className="warning-text">⚠️ Au moins un pouvoir doit être activé</p>
          )}
          <button
            style={{ marginTop: '8px', padding: '4px 10px', fontSize: '0.8rem', cursor: 'pointer', borderRadius: '4px', border: '1px solid #555', background: '#333', color: '#ccc' }}
            onClick={() => {
              const allSelected = ALL_POWERS.every(p => localEnabledPowers[p.key] ?? true);
              setLocalEnabledPowers(Object.fromEntries(ALL_POWERS.map(p => [p.key, !allSelected])));
            }}
          >
            {ALL_POWERS.every(p => localEnabledPowers[p.key] ?? true) ? 'Tout décocher' : 'Tout sélectionner'}
          </button>
        </div>

        {!Object.values(localRequiredRelics).some(v => v) && (
          <p className="relic-desc" style={{ color: '#9fd0ff', marginTop: '8px' }}>
            ℹ️ Aucune relique n'est requise : les aventuriers pourront attaquer le cristal directement.
          </p>
        )}

        <div className="modal-actions">
          <button
            data-testid="cancel-settings-btn"
            onClick={() => {
              setLocalRequiredRelics(gameState.required_relics || localRequiredRelics);
              setLocalDungeonSize(gameState.dungeon_size || 12);
              if (gameState.enabled_powers) {
                setLocalEnabledPowers(Object.fromEntries(ALL_POWERS.map(p => [p.key, gameState.enabled_powers.includes(p.key)])));
              } else {
                setLocalEnabledPowers(Object.fromEntries(ALL_POWERS.map(p => [p.key, true])));
              }
              setShowSettingsModal(false);
            }}
          >
            Annuler
          </button>
          <button
            data-testid="save-settings-btn"
            onClick={async () => {
              try {
                const enabledPowersList = ALL_POWERS.filter(p => localEnabledPowers[p.key]).map(p => p.key);
                await axios.post(`${API}/game/${sessionId}/update_settings`, {
                  required_relics: localRequiredRelics,
                  dungeon_size: localDungeonSize,
                  enabled_powers: enabledPowersList,
                });
                setShowSettingsModal(false);
              } catch (err) {
                const detail = err.response?.data?.detail;
                const msg = Array.isArray(detail)
                  ? detail.map(d => d.msg || JSON.stringify(d)).join(", ")
                  : typeof detail === "string"
                  ? detail
                  : "Erreur lors de la sauvegarde";
                toast.error(msg);
              }
            }}
          >
            Enregistrer
          </button>
        </div>
      </div>
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
  powerActionData,
  secousseEvents = [],
  maledictionSurvivors = [],
  cursePowerItem,
  cursePowerItemMasse
}) => {
  const [tempRoomSelections, setTempRoomSelections] = useState([]);
  const [selectedFloor, setSelectedFloor] = useState(null);
  const [teleportationStep, setTeleportationStep] = useState(1); // 1 = trap room, 2 = exit room
  const [trapRoom, setTrapRoom] = useState(null);
  // Variant "masse": multiple trap rooms (up to 3) before choosing exit
  const [masseTrapRooms, setMasseTrapRooms] = useState([]);
  // NEW: Secousse - currently picked event and confirmation modal toggle
  const [secousseSelected, setSecousseSelected] = useState(null);
  const [secousseConfirming, setSecousseConfirming] = useState(false);
  // NEW: Malédiction - selected target player + item
  const [maledictionTarget, setMaledictionTarget] = useState(null); // {player_id, player_name, slot_index, item_type}
  const [maledictionConfirming, setMaledictionConfirming] = useState(false);
  // NEW: Malédiction de Masse - one selection per survivor + recap step
  const [maledictionMasseSelections, setMaledictionMasseSelections] = useState({}); // {player_id: {slot_index, item_type, player_name}}
  const [maledictionMasseRecap, setMaledictionMasseRecap] = useState(false);
  
  const myPowerSelection = gameState.pending_power_selections?.[playerId];
  if (!myPowerSelection) return null;

  // GOBLIN ROULETTE: bloquer la sélection de pouvoir tant que la roulette n'est pas terminée
  const hasGoblinRoulettePending = gameState.pending_events?.[playerId]?.type?.startsWith('goblin_roulette');
  if (hasGoblinRoulettePending) {
    return (
      <div className="power-selection-overlay" data-testid="power-blocked-by-goblin-roulette">
        <div style={{ textAlign: 'center', color: '#e8dcc4', padding: '2rem' }}>
          <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>⏳ Terminez d'abord la roulette gobelin...</p>
        </div>
      </div>
    );
  }

  const currentPlayer = gameState.players[playerId];

  
  const powerOptions = myPowerSelection.options || [];
  const hasCompletedSelection = myPowerSelection.action_complete;
  
  // Room selection for powers that require it
  const _basePowerDef = powerDefinitions[selectedPower];
  const _powerEvolution = selectedPower ? currentPlayer?.powers_evolution?.[selectedPower] : null;
  const selectedPowerDef = _basePowerDef ? {
    ..._basePowerDef,
    // Si niveau 2 : surcharger nom, description et rooms_count selon la variante
    ...(_powerEvolution?.level === 2 && _powerEvolution.variant === "invasive" ? {
      name: _powerEvolution.variant_name || _basePowerDef.name,
      description: _powerEvolution.variant_description || _basePowerDef.description,
      rooms_count: 5,
    } : _powerEvolution?.level === 2 && _powerEvolution.variant === "masse" && selectedPower === "teleportation" ? {
      name: _powerEvolution.variant_name || _basePowerDef.name,
      description: _powerEvolution.variant_description || _basePowerDef.description,
      masse_trap_count: 3,
    } : _powerEvolution?.level === 2 && selectedPower === "traque" && _powerEvolution.variant === "masse" ? {
      // Traque de masse : pas de sélection d'étage, le pouvoir s'active directement
      name: _powerEvolution.variant_name || "🔊 Traque de masse",
      description: _powerEvolution.variant_description || _basePowerDef.description,
      requires_action: false,
      action_type: null,
    } : _powerEvolution?.level === 2 && selectedPower === "traque" && _powerEvolution.variant === "precision" ? {
      // Traque de précision : toujours sélection d'étage, libellé mis à jour
      name: _powerEvolution.variant_name || "🔍 Traque de précision",
      description: _powerEvolution.variant_description || _basePowerDef.description,
      requires_action: true,
      action_type: "select_floor",
    } : _powerEvolution?.level === 2 && selectedPower === "piege" && _powerEvolution.variant === "masse" ? {
      // Blizzard de masse : sélection étendue selon dungeon_size + tours écoulés
      name: _powerEvolution.variant_name || "🥶 Blizzard de masse",
      description: _powerEvolution.variant_description || _basePowerDef.description,
      requires_action: true,
      action_type: "select_rooms_blizzard",
      blizzard_masse: true,
    } : _powerEvolution?.level === 2 && selectedPower === "piege" && _powerEvolution.variant === "precision" ? {
      // Blizzard de précision : même sélection, alerte si quelqu'un tombe dedans
      name: _powerEvolution.variant_name || "🎯 Blizzard de précision",
      description: _powerEvolution.variant_description || _basePowerDef.description,
      requires_action: true,
      action_type: "select_rooms_blizzard",
    } : _powerEvolution?.level === 2 && selectedPower === "malediction" && _powerEvolution.variant === "masse" ? {
      // Malédiction de Masse : sélection d'un objet par aventurier puis récapitulatif
      name: _powerEvolution.variant_name || "🔮 Malédiction de Masse",
      description: _powerEvolution.variant_description || _basePowerDef.description,
      requires_action: true,
      action_type: "select_cursed_item_masse",
    } : _powerEvolution?.level === 2 && _powerEvolution.variant_name ? {
      name: _powerEvolution.variant_name,
      description: _powerEvolution.variant_description || _basePowerDef.description,
    } : {})
  } : _basePowerDef;
  const requiresAction = selectedPowerDef?.requires_action;
  const actionType = selectedPowerDef?.action_type;
  
  const handleRoomSelection = (roomName) => {
    if (actionType === "select_rooms_blizzard") {
      // Blizzard (base + masse + precision) : N pièces selon dungeon_size (+ tours pour masse)
      const dungeonSize = gameState?.dungeon_size || 12;
      const baseCount = dungeonSize === 6 ? 2 : dungeonSize === 9 ? 3 : 4;
      const isMasse = selectedPowerDef?.blizzard_masse;
      const turnsPassed = isMasse ? Math.max(0, (gameState?.turn || 1) - 1) : 0;
      const maxRooms = isMasse ? Math.min(baseCount * 2, baseCount + turnsPassed) : baseCount;
      if (tempRoomSelections.includes(roomName)) {
        setTempRoomSelections(tempRoomSelections.filter(r => r !== roomName));
      } else if (tempRoomSelections.length < maxRooms) {
        setTempRoomSelections([...tempRoomSelections, roomName]);
      }
    } else if (actionType === "select_rooms_per_floor") {
      // Blizzard legacy fallback: 1 room per floor
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
      // Variant "masse": up to 3 trap rooms then exit
      const isMasse = selectedPowerDef?.masse_trap_count > 0;
      if (teleportationStep === 1) {
        if (isMasse) {
          // Toggle trap room in masseTrapRooms list (max 3)
          const maxTraps = selectedPowerDef.masse_trap_count || 3;
          if (masseTrapRooms.includes(roomName)) {
            setMasseTrapRooms(masseTrapRooms.filter(r => r !== roomName));
          } else if (masseTrapRooms.length < maxTraps) {
            setMasseTrapRooms([...masseTrapRooms, roomName]);
          }
        } else {
          setTrapRoom(roomName);
        }
      } else {
        setTempRoomSelections([roomName]);
      }
    }
  };
  
  const handleFloorSelection = (floor) => {
    setSelectedFloor(floor);
  };
  
  const canConfirmAction = () => {
    if (actionType === "select_rooms_blizzard") {
      const dungeonSize = gameState?.dungeon_size || 12;
      const baseCount = dungeonSize === 6 ? 2 : dungeonSize === 9 ? 3 : 4;
      return tempRoomSelections.length >= 1 && tempRoomSelections.length <= baseCount * 2;
    } else if (actionType === "select_rooms_per_floor") {
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
      const isMasse = selectedPowerDef?.masse_trap_count > 0;
      if (teleportationStep === 1) {
        return isMasse ? masseTrapRooms.length > 0 : trapRoom !== null;
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
    // NEW: Secousse - select an already-discovered event then confirm relocation
    if (actionType === "select_event") {
      // If user is in confirmation step
      if (secousseConfirming && secousseSelected) {
        return (
          <div className="power-selection-overlay" data-testid="secousse-confirm-overlay">
            <Card className="power-action-card">
              <CardHeader>
                <CardTitle className="text-center">
                  {selectedPowerDef.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p
                  className="text-center mb-4"
                  data-testid="secousse-confirm-message"
                  style={{ fontSize: '1.1rem', lineHeight: '1.5' }}
                >
                  La secousse déplacera l'événement suivant aléatoirement sur la carte :
                  <br />
                  <strong>{secousseSelected.name}</strong>
                  <br />
                  <span style={{ opacity: 0.85 }}>
                    (actuellement dans « {secousseSelected.room} »)
                  </span>
                </p>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                  <Button
                    data-testid="secousse-confirm-btn"
                    onClick={() => {
                      confirmPowerAction({
                        event_room: secousseSelected.room,
                        event_type: secousseSelected.type
                      });
                      setSecousseConfirming(false);
                    }}
                    style={{ backgroundColor: '#8b5cf6', padding: '0.75rem 1.5rem' }}
                  >
                    Confirmer
                  </Button>
                  <Button
                    data-testid="secousse-cancel-btn"
                    onClick={() => {
                      setSecousseConfirming(false);
                      setSecousseSelected(null);
                    }}
                    style={{ backgroundColor: '#555', padding: '0.75rem 1.5rem' }}
                  >
                    Annuler
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }

      // Otherwise show the event selection list
      const hasEvents = Array.isArray(secousseEvents) && secousseEvents.length > 0;
      return (
        <div className="power-selection-overlay" data-testid="secousse-select-overlay">
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
              {!hasEvents ? (
                <p className="text-center mb-4" data-testid="secousse-no-events">
                  Aucun événement découvert n'est disponible pour le moment.
                </p>
              ) : (
                <>
                  <p className="text-center mb-4">
                    Choisissez un événement déjà découvert à déplacer :
                  </p>
                  <div
                    data-testid="secousse-event-list"
                    style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
                  >
                    {secousseEvents.map((ev, idx) => {
                      const isSel =
                        secousseSelected &&
                        secousseSelected.room === ev.room &&
                        secousseSelected.type === ev.type;
                      return (
                        <Button
                          key={`${ev.type}-${ev.room}-${idx}`}
                          data-testid={`secousse-event-${ev.type}-${idx}`}
                          onClick={() => setSecousseSelected(ev)}
                          style={{
                            backgroundColor: isSel ? '#8b5cf6' : '#555',
                            padding: '1rem',
                            textAlign: 'left',
                            fontSize: '1rem'
                          }}
                        >
                          {ev.name} — {ev.room} {isSel && ' ✓'}
                        </Button>
                      );
                    })}
                  </div>
                </>
              )}

              <Button
                data-testid="secousse-next-btn"
                onClick={() => setSecousseConfirming(true)}
                disabled={!secousseSelected}
                className="w-full mt-4"
                style={{
                  backgroundColor: secousseSelected ? '#8b5cf6' : '#555',
                  marginTop: '1.5rem'
                }}
              >
                Suivant
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Malédiction de Masse: select one cursable item per survivor, then recap & confirm
    if (actionType === "select_cursed_item_masse") {
      const allSurvivorsSelected = maledictionSurvivors.length > 0 &&
        maledictionSurvivors.every((s) => maledictionMasseSelections[s.player_id]);

      // Recap step
      if (maledictionMasseRecap) {
        return (
          <div className="power-selection-overlay" data-testid="malediction-masse-recap-overlay">
            <Card className="power-action-card">
              <CardHeader>
                <CardTitle className="text-center">{selectedPowerDef.name}</CardTitle>
                <CardDescription className="text-center">Récapitulatif des malédictions</CardDescription>
              </CardHeader>
              <CardContent>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {maledictionSurvivors.map((survivor) => {
                    const sel = maledictionMasseSelections[survivor.player_id];
                    return (
                      <div key={survivor.player_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '0.6rem 1rem', border: '1px solid rgba(124,58,237,0.4)' }}>
                        <span style={{ fontWeight: 'bold', color: '#c4b5fd' }}>🧙 {survivor.player_name}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {sel && <img src={ITEM_SPRITES[sel.item_type] || '/inventory/placeholder.png'} alt={ITEM_NAMES[sel.item_type] || sel.item_type} style={{ width: '24px', height: '24px', objectFit: 'contain' }} />}
                          {sel ? (ITEM_NAMES[sel.item_type] || sel.item_type) : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                  <Button
                    data-testid="malediction-masse-confirm-btn"
                    onClick={() => {
                      const selections = maledictionSurvivors.map((s) => ({
                        target_player_id: s.player_id,
                        slot_index: maledictionMasseSelections[s.player_id]?.slot_index
                      }));
                      cursePowerItemMasse(selections);
                      setMaledictionMasseRecap(false);
                      setMaledictionMasseSelections({});
                    }}
                    style={{ backgroundColor: '#7c3aed', padding: '0.75rem 1.5rem' }}
                  >
                    🔮 Confirmer toutes les malédictions
                  </Button>
                  <Button
                    data-testid="malediction-masse-back-btn"
                    onClick={() => setMaledictionMasseRecap(false)}
                    style={{ backgroundColor: '#555', padding: '0.75rem 1.5rem' }}
                  >
                    Retour
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }

      // Selection step: pick one item per survivor
      return (
        <div className="power-selection-overlay" data-testid="malediction-masse-select-overlay">
          <Card className="power-action-card">
            <CardHeader>
              <CardTitle className="text-center">{selectedPowerDef.name}</CardTitle>
              <CardDescription className="text-center">{selectedPowerDef.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {maledictionSurvivors.length === 0 ? (
                <p className="text-center mb-4">Aucun aventurier ne possède d'objet maudissable.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                  {maledictionSurvivors.map((survivor) => (
                    <div key={survivor.player_id} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '10px', padding: '0.75rem 1rem', border: '1px solid rgba(124,58,237,0.4)' }}>
                      <div style={{ fontWeight: 'bold', color: '#c4b5fd', marginBottom: '0.5rem' }}>🧙 {survivor.player_name}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {survivor.items.map((item) => {
                          const sel = maledictionMasseSelections[survivor.player_id];
                          const isSel = sel && sel.slot_index === item.slot_index;
                          return (
                            <button
                              key={`${survivor.player_id}-${item.slot_index}`}
                              data-testid={`malediction-masse-item-${survivor.player_id}-${item.slot_index}`}
                              onClick={() => setMaledictionMasseSelections({
                                ...maledictionMasseSelections,
                                [survivor.player_id]: { slot_index: item.slot_index, item_type: item.type, player_name: survivor.player_name }
                              })}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                backgroundColor: isSel ? '#7c3aed' : '#3b2a5a',
                                border: isSel ? '2px solid #c4b5fd' : '2px solid transparent',
                                borderRadius: '8px', padding: '6px 12px',
                                color: '#fff', cursor: 'pointer', fontSize: '0.95rem', transition: 'all 0.2s'
                              }}
                            >
                              <img src={ITEM_SPRITES[item.type] || '/inventory/placeholder.png'} alt={ITEM_NAMES[item.type] || item.type} style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
                              {ITEM_NAMES[item.type] || item.type}
                              {isSel && ' ✓'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                data-testid="malediction-masse-next-btn"
                onClick={() => setMaledictionMasseRecap(true)}
                disabled={!allSurvivorsSelected}
                className="w-full mt-4"
                style={{ backgroundColor: allSurvivorsSelected ? '#7c3aed' : '#555', marginTop: '1.5rem' }}
              >
                Suivant
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Malédiction: select a cursable item in a survivor's inventory
    if (actionType === "select_cursed_item") {
      // Confirmation step
      if (maledictionConfirming && maledictionTarget) {
        return (
          <div className="power-selection-overlay" data-testid="malediction-confirm-overlay">
            <Card className="power-action-card">
              <CardHeader>
                <CardTitle className="text-center">{selectedPowerDef.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-center mb-4" style={{ fontSize: '1.1rem', lineHeight: '1.5' }}>
                  Maudire <strong>{ITEM_NAMES[maledictionTarget.item_type] || maledictionTarget.item_type}</strong> de <strong>{maledictionTarget.player_name}</strong> ?
                  <br/><span style={{ opacity: 0.8, fontSize: '0.95rem' }}>S'il ne s'en débarrasse pas avant la fin du tour, tous les survivants perdront 10 PV.</span>
                </p>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                  <Button
                    data-testid="malediction-confirm-btn"
                    onClick={() => {
                      cursePowerItem(maledictionTarget.player_id, maledictionTarget.slot_index);
                      setMaledictionConfirming(false);
                    }}
                    style={{ backgroundColor: '#7c3aed', padding: '0.75rem 1.5rem' }}
                  >
                    🔮 Maudire
                  </Button>
                  <Button
                    data-testid="malediction-cancel-btn"
                    onClick={() => { setMaledictionConfirming(false); setMaledictionTarget(null); }}
                    style={{ backgroundColor: '#555', padding: '0.75rem 1.5rem' }}
                  >
                    Annuler
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }

      // Item selection list
      return (
        <div className="power-selection-overlay" data-testid="malediction-select-overlay">
          <Card className="power-action-card">
            <CardHeader>
              <CardTitle className="text-center">{selectedPowerDef.name}</CardTitle>
              <CardDescription className="text-center">{selectedPowerDef.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {maledictionSurvivors.length === 0 ? (
                <p className="text-center mb-4">Aucun aventurier ne possède d'objet maudissable.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                  {maledictionSurvivors.map((survivor) => (
                    <div key={survivor.player_id} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '10px', padding: '0.75rem 1rem', border: '1px solid rgba(124,58,237,0.4)' }}>
                      <div style={{ fontWeight: 'bold', color: '#c4b5fd', marginBottom: '0.5rem' }}>🧙 {survivor.player_name}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {survivor.items.map((item) => {
                          const isSel = maledictionTarget && maledictionTarget.player_id === survivor.player_id && maledictionTarget.slot_index === item.slot_index;
                          return (
                            <button
                              key={`${survivor.player_id}-${item.slot_index}`}
                              data-testid={`malediction-item-${survivor.player_id}-${item.slot_index}`}
                              onClick={() => setMaledictionTarget({ player_id: survivor.player_id, player_name: survivor.player_name, slot_index: item.slot_index, item_type: item.type })}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                backgroundColor: isSel ? '#7c3aed' : '#3b2a5a',
                                border: isSel ? '2px solid #c4b5fd' : '2px solid transparent',
                                borderRadius: '8px', padding: '6px 12px',
                                color: '#fff', cursor: 'pointer', fontSize: '0.95rem', transition: 'all 0.2s'
                              }}
                            >
                              <img src={ITEM_SPRITES[item.type] || '/inventory/placeholder.png'} alt={ITEM_NAMES[item.type] || item.type} style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
                              {ITEM_NAMES[item.type] || item.type}
                              {isSel && ' ✓'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                data-testid="malediction-next-btn"
                onClick={() => setMaledictionConfirming(true)}
                disabled={!maledictionTarget}
                className="w-full mt-4"
                style={{ backgroundColor: maledictionTarget ? '#7c3aed' : '#555', marginTop: '1.5rem' }}
              >
                Suivant
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

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
                  {actionType === "select_rooms_blizzard" && (() => {
                    const dungeonSize = gameState?.dungeon_size || 12;
                    const baseCount = dungeonSize === 6 ? 2 : dungeonSize === 9 ? 3 : 4;
                    const isMasse = selectedPowerDef?.blizzard_masse;
                    const turnsPassed = isMasse ? Math.max(0, (gameState?.turn || 1) - 1) : 0;
                    const maxRooms = isMasse ? Math.min(baseCount * 2, baseCount + turnsPassed) : baseCount;
                    return `Sélectionnez jusqu'à ${maxRooms} pièce${maxRooms > 1 ? "s" : ""} à piéger par le blizzard (${tempRoomSelections.length}/${maxRooms}) :`;
                  })()}
                  {actionType === "select_rooms_per_floor" && "Sélectionnez une pièce par étage à piéger:"}
                  {actionType === "select_rooms" && `Sélectionnez ${selectedPowerDef.rooms_count} pièces à verrouiller:`}
                  {actionType === "select_room" && "Sélectionnez une pièce à empoisonner:"}
                  {actionType === "select_two_rooms" && teleportationStep === 1 && !selectedPowerDef?.masse_trap_count && "Posez votre piège de téléportation dans la pièce que vous souhaitez ➡️🌀"}
                  {actionType === "select_two_rooms" && teleportationStep === 1 && selectedPowerDef?.masse_trap_count > 0 && `Sélectionnez jusqu'à ${selectedPowerDef.masse_trap_count} pièces d'entrée ➡️🌀 (${masseTrapRooms.length}/${selectedPowerDef.masse_trap_count} choisies)`}
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
                              ? (selectedPowerDef?.masse_trap_count > 0 ? masseTrapRooms.includes(roomName) : trapRoom === roomName)
                              : tempRoomSelections.includes(roomName);
                            const isLocked = roomData.locked;
                            const isTrapped = roomData.trapped; // FIXED: Show trapped rooms
                            
                            // ESPIONNAGE: Highlight selected room in red, other rooms on same floor in orange
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
                        // Confirm: masse variant sends multiple trap rooms, standard sends single
                        const isMasse = selectedPowerDef?.masse_trap_count > 0;
                        if (isMasse) {
                          confirmPowerAction({ trap_rooms: masseTrapRooms, exit_room: tempRoomSelections[0] });
                        } else {
                          confirmPowerAction({ trap_room: trapRoom, exit_room: tempRoomSelections[0] });
                        }
                        // Reset teleportation internal state so it's clean if the component
                        // re-renders before being unmounted (e.g. during the specialization flow)
                        setTeleportationStep(1);
                        setTrapRoom(null);
                        setMasseTrapRooms([]);
                        setTempRoomSelections([]);
                      }
                    } else {
                      confirmPowerAction({ rooms: tempRoomSelections });
                    }
                  }}
                  disabled={!canConfirmAction()}
                  className="w-full mt-4"
                  style={{ backgroundColor: canConfirmAction() ? '#8b5cf6' : '#555' }}
                >
                  {actionType === "select_two_rooms" && teleportationStep === 1
                    ? (selectedPowerDef?.masse_trap_count > 0
                        ? `Suivant (${masseTrapRooms.length} piège${masseTrapRooms.length > 1 ? "s" : ""})`
                        : "Suivant")
                    : "Confirmer"}
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
                      src={
                        currentPlayer?.powers_evolution?.[powerName]?.level === 2 &&
                        currentPlayer.powers_evolution[powerName].variant_video_path
                          ? currentPlayer.powers_evolution[powerName].variant_video_path
                          : `/powers/${power.icon}`
                      }
                      autoPlay
                      loop
                      muted
                      playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                  <div className="power-card-content">
                    <h3 className="power-card-name" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>
                        {currentPlayer?.powers_evolution?.[powerName]?.level === 2 && currentPlayer.powers_evolution[powerName].variant_name
                          ? currentPlayer.powers_evolution[powerName].variant_name
                          : power.name}
                      </span>
                      {currentPlayer && currentPlayer.powers_evolution && currentPlayer.powers_evolution[powerName] && (
                        <span style={{
                          fontSize: '0.75rem',
                          color: currentPlayer.powers_evolution[powerName].level === 2 ? '#10b981' : '#d4af37',
                          fontWeight: 'normal',
                          marginLeft: '0.5rem'
                        }}>
                          Niv.{currentPlayer.powers_evolution[powerName].level}
                        </span>
                      )}
                    </h3>
                    <p className="power-card-description">
                      {currentPlayer?.powers_evolution?.[powerName]?.level === 2 && currentPlayer.powers_evolution[powerName].variant_description
                        ? currentPlayer.powers_evolution[powerName].variant_description
                        : power.description}
                    </p>
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

// ========== POWER SPECIALIZATION MODAL ==========
const PowerSpecializationModal = ({ data, onClose, wsRef }) => {
  const [selectedVariant, setSelectedVariant] = useState(null);
  
  if (!data) return null;
  
  const { power, specializations } = data;
  const variants = Object.entries(specializations);
  
  const handleSelectVariant = (variantKey) => {
    if (!wsRef || !wsRef.current) return;
    
    wsRef.current.send(JSON.stringify({
      type: "select_power_specialization",
      power: power,
      variant: variantKey
    }));
    
    setSelectedVariant(variantKey);
    setTimeout(() => { onClose(); }, 1500);
  };
  
  return (
    <div
      className="game-over-overlay"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 4000,
      }}
    >
      <Card style={{
        maxWidth: '1100px',
        width: '95%',
        backgroundColor: '#2a1f17',
        border: '3px solid #d4af37',
      }}>
        <CardHeader>
          <CardTitle style={{ color: '#d4af37', textAlign: 'center', fontSize: '1.8rem' }}>
            🔮 Spécialisation — {power.charAt(0).toUpperCase() + power.slice(1)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p style={{ color: '#e8dcc4', textAlign: 'center', marginBottom: '1.5rem' }}>
            Choisissez une amélioration pour votre pouvoir :
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1rem' }}>
            {variants.map(([variantKey, variantData]) => (
              <div
                key={variantKey}
                style={{
                  backgroundColor: 'rgba(0,0,0,0.4)',
                  border: selectedVariant === variantKey ? '3px solid #10b981' : '2px solid rgba(212,175,55,0.3)',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  transition: 'all 0.3s ease',
                }}
              >
                <h3 style={{ color: '#d4af37', fontSize: '1.3rem', marginBottom: '0.75rem', textAlign: 'center' }}>
                  {variantData.name}
                </h3>
                <div
                  style={{
                    width: '100%', height: '200px', backgroundColor: '#000',
                    borderRadius: '8px', marginBottom: '0.75rem',
                    overflow: 'hidden',
                  }}
                >
                  <video src={variantData.video_path} autoPlay loop muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <p style={{ color: '#e8dcc4', fontSize: '0.95rem', marginBottom: '1rem', textAlign: 'center', minHeight: '50px' }}>
                  {variantData.description}
                </p>
                <button
                  onClick={() => handleSelectVariant(variantKey)}
                  disabled={selectedVariant !== null}
                  style={{
                    width: '100%', padding: '10px',
                    backgroundColor: selectedVariant === variantKey ? '#10b981' : '#d4af37',
                    border: 'none', borderRadius: '8px',
                    color: '#1a1410', fontSize: '1rem', fontWeight: 'bold',
                    cursor: selectedVariant !== null ? 'not-allowed' : 'pointer',
                    opacity: selectedVariant !== null && selectedVariant !== variantKey ? 0.5 : 1,
                    transition: 'all 0.2s ease',
                  }}
                >
                  {selectedVariant === variantKey ? '✓ Sélectionné' : 'Choisir'}
                </button>
              </div>
            ))}
          </div>
          {selectedVariant && (
            <p style={{ color: '#10b981', textAlign: 'center', fontSize: '1.1rem', fontWeight: 'bold' }}>
              ✨ Amélioration confirmée !
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// Game Page - Main gameplay
// ========== FORGE BAR ANIMATION COMPONENT ==========
// ========== FORGE TIMING MINI-GAME ==========
// Interactive: player clicks to stop the cursor; landing in the green zone = success.
// Green zone shrinks with each forge attempt on the weapon (−8% per attempt, min 12%).
// Cursor oscillates left↔right with progressive acceleration (25 → 120 %/s).
// Success zones are placed randomly across the bar without overlapping.

// Helper: generate N non-overlapping random success zones across [0, 100]
const generateRandomSuccessZones = (count, totalSuccessWidth) => {
  const zoneWidth = totalSuccessWidth / count;
  const minGap = 2; // minimum gap between zones in %
  const margin = 1; // margin from edges

  // Place zones randomly with no overlap, retrying if needed
  for (let attempt = 0; attempt < 200; attempt++) {
    const zones = [];
    let valid = true;

    for (let i = 0; i < count; i++) {
      const maxLeft = 100 - margin - zoneWidth;
      const left = margin + Math.random() * (maxLeft - margin);
      zones.push({ left, width: zoneWidth });
    }

    // Sort by position and check for overlaps
    zones.sort((a, b) => a.left - b.left);
    for (let i = 1; i < zones.length; i++) {
      if (zones[i].left < zones[i - 1].left + zones[i - 1].width + minGap) {
        valid = false;
        break;
      }
    }
    // Also check last zone doesn't go out of bounds
    const last = zones[zones.length - 1];
    if (last.left + last.width > 100 - margin) valid = false;

    if (valid) return zones;
  }

  // Fallback: distribute evenly if random placement fails
  const spacing = (100 - 2 * margin - count * zoneWidth) / (count + 1);
  return Array.from({ length: count }, (_, i) => ({
    left: margin + spacing * (i + 1) + i * zoneWidth,
    width: zoneWidth,
  }));
};

const ForgeTimingGame = ({ attempts, onResult }) => {
  const [cursorPos, setCursorPos] = useState(0);
  const [clicked, setClicked] = useState(false);
  const [hitResult, setHitResult] = useState(null); // 'success' | 'failure'
  const rafRef = useRef(null);
  const posRef = useRef(0);
  const dirRef = useRef(1);

  // NOUVELLE LOGIQUE: La vitesse de base augmente avec chaque tentative
  const BASE_SPEED_MULTIPLIER = Math.max(1, attempts + 1);

  // Green zone total width: shrinks 8% per attempt, minimum 12%
  const TOTAL_SUCCESS_WIDTH = Math.max(12, 50 - attempts * 8);

  // Number of success zones = number of attempts (min 1)
  const segmentCount = attempts + 1;

  // Generate random zone positions once per render (stable via useMemo pattern with useRef)
  const zonesRef = useRef(null);
  if (zonesRef.current === null || zonesRef.current.length !== segmentCount) {
    zonesRef.current = generateRandomSuccessZones(segmentCount, TOTAL_SUCCESS_WIDTH);
  }
  const successZones = zonesRef.current;

  useEffect(() => {
    if (clicked) return;

    const animate = () => {
      const baseSpeed = 10 * BASE_SPEED_MULTIPLIER;
      const speed = Math.min(baseSpeed, 200);
      posRef.current += dirRef.current * speed * (1 / 60);
      if (posRef.current >= 100) { posRef.current = 100; dirRef.current = -1; }
      if (posRef.current <= 0)   { posRef.current = 0;   dirRef.current =  1; }
      setCursorPos(posRef.current);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [clicked, BASE_SPEED_MULTIPLIER]);

  const handleClick = () => {
    if (clicked) return;
    cancelAnimationFrame(rafRef.current);
    setClicked(true);

    // Check if cursor falls inside any success zone
    const inGreen = successZones.some(
      (zone) => posRef.current >= zone.left && posRef.current <= zone.left + zone.width
    );

    setHitResult(inGreen ? 'success' : 'failure');
    setTimeout(() => onResult(inGreen), 900);
  };

  return (
    <div style={{ width: '100%', padding: '0 4px', userSelect: 'none' }}>
      <div style={{ textAlign: 'center', color: '#d4af37', fontSize: '15px', fontWeight: 'bold', marginBottom: '10px' }}>
        {clicked
          ? (hitResult === 'success' ? '✅ Dans la zone !' : '💥 Raté !')
          : '⚒️ Cliquez au bon moment !'}
      </div>

      {/* Clickable bar */}
      <div
        onClick={handleClick}
        style={{
          position: 'relative', width: '100%', height: '56px',
          backgroundColor: '#dc2626',
          background: 'linear-gradient(90deg, #7f1d1d, #dc2626 30%, #dc2626 70%, #7f1d1d)',
          border: `3px solid ${clicked ? (hitResult === 'success' ? '#4ade80' : '#ef4444') : '#d4af37'}`,
          borderRadius: '10px', overflow: 'hidden',
          cursor: clicked ? 'default' : 'pointer',
          boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.8)',
          transition: 'border-color 0.2s'
        }}
      >
        {/* ÉCHEC label left */}
        <div style={{
          position: 'absolute', left: 0, top: 0, width: '18%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'
        }}>
          <span style={{ color: '#fff', fontSize: '12px', fontWeight: 'bold', textShadow: '0 1px 3px rgba(0,0,0,0.8)', whiteSpace: 'nowrap' }}>✗ ÉCHEC</span>
        </div>
        {/* ÉCHEC label right */}
        <div style={{
          position: 'absolute', right: 0, top: 0, width: '18%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'
        }}>
          <span style={{ color: '#fff', fontSize: '12px', fontWeight: 'bold', textShadow: '0 1px 3px rgba(0,0,0,0.8)', whiteSpace: 'nowrap' }}>✗ ÉCHEC</span>
        </div>

        {/* Success zones — randomly placed */}
        {successZones.map((zone, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${zone.left}%`, top: 0,
            width: `${zone.width}%`, height: '100%',
            background: 'linear-gradient(90deg, #059669, #10b981, #059669)',
            boxShadow: '0 0 8px rgba(16,185,129,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {zone.width > 5 && (
              <span style={{ color: '#fff', fontSize: segmentCount === 1 ? '12px' : '10px', fontWeight: 'bold', textShadow: '0 1px 3px rgba(0,0,0,0.9)', whiteSpace: 'nowrap' }}>
                {segmentCount === 1 ? '✓ SUCCÈS' : '✓'}
              </span>
            )}
          </div>
        ))}

        {/* Cursor needle */}
        <div style={{
          position: 'absolute', left: `${cursorPos}%`, top: 0, bottom: 0, width: '4px',
          backgroundColor: '#fff', transform: 'translateX(-50%)',
          boxShadow: '0 0 12px rgba(255,255,255,0.9), 0 0 24px rgba(212,175,55,0.7)',
          zIndex: 10, pointerEvents: 'none'
        }} />
      </div>

      {/* Hint */}
      <div style={{ marginTop: '8px', textAlign: 'center', color: '#9a8475', fontSize: '0.78rem' }}>
        Zone de succès : <strong style={{ color: '#d4af37' }}>{Math.round(TOTAL_SUCCESS_WIDTH)}%</strong>
        {attempts > 0 && <span style={{ color: '#ef4444' }}> (−{attempts * 8}% depuis la 1ʳᵉ tentative)</span>}
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
  const [showMimicCombat, setShowMimicCombat] = useState(false);
  const [mimicCombatEvent, setMimicCombatEvent] = useState(null);
  // NEW: Combat help window states
  const [combatHelpWaiting, setCombatHelpWaiting] = useState(null); // pour A
  const [combatHelpAvailable, setCombatHelpAvailable] = useState(null); // pour B
  const [combatHelpParticipants, setCombatHelpParticipants] = useState([]); // pour A : liste qui s'agrandit
  const [showCrystalCombat, setShowCrystalCombat] = useState(false);
  const [crystalCombatEvent, setCrystalCombatEvent] = useState(null);
  const [showFleeingGoblinCombat, setShowFleeingGoblinCombat] = useState(false);
  const [fleeingGoblinCombatEvent, setFleeingGoblinCombatEvent] = useState(null);

  // SAFEGUARD: ferme l'overlay "en attente d'alliés" dès qu'un combat mimic
  // est arrivé dans pending_events, même si le state_update tarde par ailleurs.
  useEffect(() => {
    const evt = gameState?.pending_events?.[playerId];
    if (evt && typeof evt === 'object' && evt.type === 'mimic_combat') {
      setCombatHelpWaiting(null);
      setCombatHelpAvailable(null);
      setCombatHelpParticipants([]);
    }
  }, [gameState?.pending_events, playerId]);

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
  // NEW: Discovered events list for the Secousse power (provided by backend)
  const [secousseEvents, setSecousseEvents] = useState([]);
  
  // NEW: Power specialization modal
  const [showPowerSpecialization, setShowPowerSpecialization] = useState(false);
  const [powerSpecializationData, setPowerSpecializationData] = useState(null);

  // NEW: Key found popup state
  const [showKeyFoundPopup, setShowKeyFoundPopup] = useState(false);
  const [keyFoundMessage, setKeyFoundMessage] = useState("");
  
  // quest_completed popup state REMOVED — replaced by continuous lucky searches

  // Stone quest completed popup (non-blocking, auto-closes)
  const [showStoneQuestPopup, setShowStoneQuestPopup] = useState(false);
  const [stoneQuestMessage, setStoneQuestMessage] = useState("");
  
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
  const [showCartographerDialog, setShowCartographerDialog] = useState(false);
  const [cartographerDialogStep, setCartographerDialogStep] = useState('initial'); // 'initial', 'payment', 'topic_choice', 'hint_shown'
  const [cartographerHint, setCartographerHint] = useState('');
  const [cartographerVideoPath, setCartographerVideoPath] = useState('');
  const [showSellDialog, setShowSellDialog] = useState(false);

  // NEW: Forge popup + interface state
  const [showForgePopup, setShowForgePopup] = useState(false);
  // Resurrection stele
  const [showResurrectionPopup, setShowResurrectionPopup] = useState(false);
  const [resurrectionMessage, setResurrectionMessage] = useState("");
  const [resurrectionVideoPath, setResurrectionVideoPath] = useState("");
  const [resurrectionEliminatedSurvivors, setResurrectionEliminatedSurvivors] = useState([]);
  const [resurrectionSteleRoom, setResurrectionSteleRoom] = useState(null);
  const [showRevivalConfirm, setShowRevivalConfirm] = useState(false);
  const [revivalTargetId, setRevivalTargetId] = useState(null);
  // Revived popup (for the player who was revived)
  const [showYouWereRevivedPopup, setShowYouWereRevivedPopup] = useState(false);
  const [youWereRevivedMessage, setYouWereRevivedMessage] = useState("");
  const [youWereRevivedVideoPath, setYouWereRevivedVideoPath] = useState("");
  const [forgeVideoPath, setForgeVideoPath] = useState("");
  const [showForgeInterface, setShowForgeInterface] = useState(false);
  const [forgeAnimation, setForgeAnimation] = useState(null); // null | "forging" | "success" | "failure"
  const [forgeBusy, setForgeBusy] = useState(false);
  const [forgeFlashLabel, setForgeFlashLabel] = useState("");
  const [forgePendingResult, setForgePendingResult] = useState(null); // response cached during "forging"

  // NEW: Cristal popup
  const [showCrystalPopup, setShowCrystalPopup] = useState(false);
  const [crystalVideoPath, setCrystalVideoPath] = useState("");
  const [crystalMessage, setCrystalMessage] = useState("");
  
  // Animation de la barre de forge
  const [forgeBarAnimation, setForgeBarAnimation] = useState(false);
  const [forgeBarCursorPosition, setForgeBarCursorPosition] = useState(0);
  
  // NEW: Antidote used popup state
  const [showAntidotePopup, setShowAntidotePopup] = useState(false);
  const [antidoteMessage, setAntidoteMessage] = useState("");

  // Poursuite spawn popup state
  const [showPoursuiteSpawnPopup, setShowPoursuiteSpawnPopup] = useState(false);
  const [poursuiteSpawnMessage, setPoursuiteSpawnMessage] = useState("");
  const [poursuiteSpawnVideoPath, setPoursuiteSpawnVideoPath] = useState("");
  const [showTraquePopup, setShowTraquePopup] = useState(false);
  const [traqueMessage, setTraqueMessage] = useState("");
  const [traqueVideoPath, setTraqueVideoPath] = useState("/powers/Traque.mp4");
  const [traqueAvatars, setTraqueAvatars] = useState([]);

  // NEW: Eboulement popup state
  const [showEboulementPopup, setShowEboulementPopup] = useState(false);
  const [eboulementMessage, setEboulementMessage] = useState("");
  const [eboulementVideoPath, setEboulementVideoPath] = useState("");

  // NEW: Patrouille popup state
  const [showPatrouillePopup, setShowPatrouillePopup] = useState(false);
  const [patrouilleMessage, setPatrouilleMessage] = useState("");
  const [patrouilleVideoPath, setPatrouilleVideoPath] = useState("");

  // NEW: Observation stone alert popup (for killers, non-blocking)
  const [showObservationStoneAlert, setShowObservationStoneAlert] = useState(false);
  const [observationStoneMessage, setObservationStoneMessage] = useState("");
  const [observationStoneVideoPath, setObservationStoneVideoPath] = useState("");

  // ── Killer alert queue (non-bloquant, séquentiel) ──────────────────────────
  // Toutes les popups non-bloquantes killers passent par cette file pour éviter
  // toute superposition. Chaque entrée : { title, icon, message, videoPath, color }
  const [killerAlertQueue, setKillerAlertQueue] = useState([]);
  const [activeKillerAlert, setActiveKillerAlert] = useState(null);

  // Enfile une alerte killer. Si aucune n'est active, l'affiche immédiatement.
  const enqueueKillerAlert = (alert) => {
    setActiveKillerAlert(prev => {
      if (prev === null) {
        return alert; // affichage immédiat
      }
      setKillerAlertQueue(q => [...q, alert]);
      return prev;
    });
  };

  // Ferme l'alerte active et dépile la suivante (appelée au clic).
  const dismissKillerAlert = () => {
    setKillerAlertQueue(q => {
      const [next, ...rest] = q;
      setActiveKillerAlert(next ?? null);
      return rest;
    });
  };

  // NEW: Malédiction states
  const [showMaledictionWarningPopup, setShowMaledictionWarningPopup] = useState(false);
  const [maledictionWarningMessage, setMaledictionWarningMessage] = useState("");
  const [maledictionVideoPath, setMaledictionVideoPath] = useState("");
  const [showMaledictionPenaltyPopup, setShowMaledictionPenaltyPopup] = useState(false);
  const [maledictionPenaltyMessage, setMaledictionPenaltyMessage] = useState("");
  // NEW: Malédiction Incertaine - team-wide curse lifted popup
  const [showMaledictionLiftedPopup, setShowMaledictionLiftedPopup] = useState(false);
  const [maledictionLiftedMessage, setMaledictionLiftedMessage] = useState("");
  // Malediction killer selection state (passed to PowerSelectionOverlay)
  const [maledictionSurvivors, setMaledictionSurvivors] = useState([]);

  // NEW: Active traps section state
  const [expandedTrap, setExpandedTrap] = useState(null);

  // NEW: Turn announcement popups (flashing)
  const [showAdventurerTurnPopup, setShowAdventurerTurnPopup] = useState(false);
  const [showOrcSearchPopup, setShowOrcSearchPopup] = useState(false);

  // NEW: Room selection with confirmation - preSelectedRoom is the room clicked once, selectedRoom is confirmed
  const [preSelectedRoom, setPreSelectedRoom] = useState(null);

  // NEW: Inventory system states
  const [showInventory, setShowInventory] = useState(false);

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

      if (data.type === "mimic_combat") {
        // Fermer immédiatement la fenêtre d'attente (A) ou le popup d'aide (B)
        setCombatHelpWaiting(null);
        setCombatHelpAvailable(null);
        setCombatHelpParticipants([]);
        // ⚠️ NE PAS return : laisser le code existant gérer l'ajout aux pending_events
      }

      if (data.type === "state_update") {
        setGameState(data.game);

        // Sync hasSelectedRoom from pending_actions — handles the case where
        // this player was just revived mid-turn and already has a forced pending_action.
        if (data.game && data.game.phase === "survivor_selection") {
          const myAction = data.game.pending_actions?.[storedPlayerId];
          if (myAction) {
            setHasSelectedRoom(true);
          }
        }

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
            } else if (event.type === "mimic_combat") {
              setCombatHelpWaiting(null);
              setCombatHelpAvailable(null);
              if (event.survivors) {
                // Nouveau format multi-joueurs : router vers MultiPlayerCombat
                setMultiplayerCombatEvent(event);
                setShowMultiplayerCombat(true);
              } else {
                // Ancien format solo (rétro-compat)
                setMimicCombatEvent(event);
                setShowMimicCombat(true);
              }
            } else if (event.type === "crystal_combat") {
              setCrystalCombatEvent(event);
              setShowCrystalCombat(true);
            } else if (event.type === "fleeing_goblin_combat") {
              setFleeingGoblinCombatEvent(event);
              setShowFleeingGoblinCombat(true);
            } else if (event.type === "power_specialization") {
              // Show power specialization modal
              setPowerSpecializationData(event);
              setShowPowerSpecialization(true);
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
        // NOTE: No auto-hide — user must click to close (will trigger notifyEventCompleted)
      } else if (data.type === "poisoned_notification") {
        // NEW: Show poison video popup first, then image popup
        setPoisonMessage(data.message);
        setPoisonVideoPath(data.video_path || "");
        
        if (data.video_path) {
          // Show video popup first
          setShowPoisonVideoPopup(true);
        } else {
          // If no video, show image popup directly — user must click to close
          setShowPoisonPopup(true);
        }
      } else if (data.type === "mimic_notification") {
        // NEW: Show mimic popup for survivor who entered room with mimic
        setMimicVideoPath(data.video_path || "");
        setMimicMessage(data.message);
        setShowMimicPopup(true);
        // NOTE: No auto-hide — user must click to close (will trigger notifyEventCompleted)
      } else if (data.type === "combat_help_waiting") {
        setCombatHelpWaiting(data);
        setCombatHelpParticipants([storedPlayerId]); // A est seul au départ
        return;
      } else if (data.type === "combat_help_available") {
        setCombatHelpAvailable(data);
        return;
      } else if (data.type === "combat_help_expired") {
        setCombatHelpAvailable(null);
        toast.info(data.message || "⏱️ La fenêtre de combat est expirée");
        return;
      } else if (data.type === "player_joined_combat") {
        // Mettre à jour la liste si on est A (overlay ouvert)
        if (data.participants) {
          setCombatHelpParticipants(data.participants);
        }
        // Si on est B et qu'on vient de rejoindre, fermer le popup
        if (data.player_id === storedPlayerId) {
          setCombatHelpAvailable(null);
        }
        return;
      } else if (data.type === "mimic_combat") {
        // FIX: Top-level handler for the mimic combat WS message sent by the backend
        // via enqueue_player_event / dispatch_next_player_event. Without this branch,
        // the message was silently dropped when it arrived AFTER a gold popup
        // (mimic was queued behind gold_found and only dispatched on event_completed).
        setCombatHelpWaiting(null);
        setCombatHelpAvailable(null);
        if (data.survivors) {
          // Nouveau format multi-joueurs : router vers MultiPlayerCombat
          setMultiplayerCombatEvent(data);
          setShowMultiplayerCombat(true);
        } else {
          // Ancien format solo (rétro-compat)
          setMimicCombatEvent(data);
          setShowMimicCombat(true);
        }
      } else if (data.type === "crystal_combat") {
        // Direct WS handler for the crystal combat (sent via enqueue_player_event
        // once the 10s help window closes, or broadcasted by crystal_attack).
        // Only show the overlay to participants of the combat.
        setCombatHelpWaiting(null);
        setCombatHelpAvailable(null);
        setCombatHelpParticipants([]);
        if (Array.isArray(data.survivors) && data.survivors.some(s => s.id === storedPlayerId)) {
          setCrystalCombatEvent(data);
          setShowCrystalCombat(true);
        }
      } else if (data.type === "fleeing_goblin_combat") {
        // Direct WS handler for fleeing goblin combat
        setFleeingGoblinCombatEvent(data);
        setShowFleeingGoblinCombat(true);
      } else if (data.type === "power_specialization") {
        // ⚠️ FIX SÉQUENCEMENT : top-level handler pour la spécialisation envoyée
        // par `dispatch_next_player_event` APRÈS la fermeture d'un combat
        // (cas où le killer a fouillé une pièce avec aventuriers et a déclenché
        //  un combat en même temps que sa spécialisation niveau 1).
        // Sans ce handler, le message WS direct serait ignoré et la modale
        // de spec ne s'afficherait jamais après la fermeture du combat.
        setPowerSpecializationData(data);
        setShowPowerSpecialization(true);
      } else if (data.type === "teleportation_notification") {
        // NEW: Show teleportation popup for survivor who entered teleportation trap with video
        setTeleportationVideoPath(data.video_path || "");
        setTeleportationMessage(data.message);
        setShowTeleportationPopup(true);
        // NOTE: No auto-hide — user must click to close (will trigger notifyEventCompleted)
      } else if (data.type === "merchant_encounter") {
        // NEW: Show merchant popup for survivor who encountered the merchant
        setMerchantVideoPath(data.video_path || "");
        setShowMerchantPopup(true);
      } else if (data.type === "forge_encounter") {
        // NEW: Show forge intro popup for survivor who found the forge
        setForgeVideoPath(data.video_path || "/event/Forge.mp4");
        setShowForgePopup(true);
      } else if (data.type === "crystal_encounter") {
        setCrystalVideoPath(data.video_path || "/event/cristal.mp4");
        setCrystalMessage(data.message || "");
        setShowCrystalPopup(true);
      } else if (data.type === "cartographer_encounter") {
        // NEW: Cartographer encounter
        setShowCartographerDialog(true);
        setCartographerDialogStep('initial');
        setCartographerVideoPath(data.video_path || '/event/Cartographe.mp4');
      } else if (data.type === "resurrection_stele_encounter") {
        setResurrectionMessage(data.message || "");
        setResurrectionVideoPath(data.video_path || "/event/Revive.mp4");
        setResurrectionEliminatedSurvivors(data.eliminated_survivors || []);
        setResurrectionSteleRoom(data.stele_room || null);
        setShowResurrectionPopup(true);
      } else if (data.type === "you_were_revived") {
        setYouWereRevivedMessage(data.message || "");
        setYouWereRevivedVideoPath(data.video_path || "/event/Revive.mp4");
        setShowYouWereRevivedPopup(true);
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
      } else if (data.type === "poursuite_spawned") {
        // Afficher le popup Poursuite (pour les survivants)
        setPoursuiteSpawnMessage(data.message);
        setPoursuiteSpawnVideoPath(data.video_path);
        setShowPoursuiteSpawnPopup(true);
        // No auto-hide - survivors must click to close
      } else if (data.type === "eboulement_activated") {
        // Show Eboulement popup with video (for survivors)
        setEboulementMessage(data.message);
        setEboulementVideoPath(data.video_path);
        setShowEboulementPopup(true);
        // NOTE: No auto-hide — user must click to close
      } else if (data.type === "patrol_detected" || data.type === "patrol_found") {
        // Show Patrouille detection popup with video (for survivors)
        setPatrouilleMessage(data.message);
        setPatrouilleVideoPath(data.video_path);
        setShowPatrouillePopup(true);
        // NOTE: No auto-hide — user must click to close (will trigger notifyEventCompleted)
      } else if (data.type === "observation_stone_alert") {
        // Non-blocking alert for killers: a survivor is carrying the observation stone
        setObservationStoneMessage(data.message);
        setObservationStoneVideoPath(data.video_path);
        setShowObservationStoneAlert(true);
        // NOTE: No notifyEventCompleted needed — non-blocking for killers
      } else if (data.type === "room_pillaged_discovered") {
        // NEW: le killer découvre qu'une pièce a déjà été pillée par les survivants
        if (data.killer_id === storedPlayerId) {
          toast.info(`🏚️ ${data.room_name} a déjà été pillée par les aventuriers.`, {
            duration: 4000,
          });
        }
      } else if (data.type === "blizzard_precision_alert") {
        // Blizzard de précision : alerter le killer qu'un aventurier est pris dans son blizzard
        enqueueKillerAlert({
          title: "Blizzard de Précision !",
          icon: "🥶",
          message: `🥶 ${data.player_name} est pris dans votre blizzard (${data.room}) !`,
          videoPath: "/powers/blizzard.mp4",
          color: "#60a5fa",
        });
      } else if (data.type === "patrol_reveal") {
        // Killers: exact position revealed by Patrouille variant → popup with video
        enqueueKillerAlert({
          title: "Gobelin de Patrouille !",
          icon: "🔍",
          message: `🔍 Gobelin de Patrouille : ${data.player_name} est dans "${data.room}" !`,
          videoPath: "/powers/Patrouille.mp4",
          color: "#f59e0b",
        });
      } else if (data.type === "patrol_presence") {
        // Killers: floor presence revealed by Espionnage or Vadrouille → popup with video
        const _floorLabels = { upper_floor: "Étage supérieur", ground_floor: "Rez-de-chaussée", basement: "Sous-sol" };
        const _varLabel = data.variant === "vadrouille" ? "Vadrouille" : "Espion";
        enqueueKillerAlert({
          title: `Gobelin ${_varLabel} !`,
          icon: "🔍",
          message: `🔍 Gobelin ${_varLabel} : ${data.player_name} détecté au ${_floorLabels[data.floor] || data.floor} !`,
          videoPath: data.variant === "vadrouille" ? "/powers/Vadrouille.mp4" : "/powers/Espionnage.mp4",
          color: "#f59e0b",
        });
      } else if (data.type === "traque_result") {
        // Show Traque popup with video (video_path and avatars vary by variant)
        setTraqueMessage(data.message);
        setTraqueVideoPath(data.video_path || "/powers/Traque.mp4");
        setTraqueAvatars(data.avatars || []);
        setShowTraquePopup(true);
      } else if (data.type === "poison_countdown") {
        // Show poison countdown notification
        toast.warning(data.message, {
          duration: 4000,
          icon: '😷'
        });
      } else if (data.type === "toxic_cough_popup") {
        // Toxine suffocante — notify killers of poisoned survivor's floor
        enqueueKillerAlert({
          title: "Toxine Suffocante",
          icon: "😷",
          message: data.message,
          videoPath: "/powers/Toxine suffocante.mp4",
          color: "#84cc16",
        });
      } else if (data.type === "seisme_popup") {
        // Séisme — notify killer of floors occupied by survivors
        enqueueKillerAlert({
          title: "Séisme",
          icon: "⛰️",
          message: data.message,
          videoPath: "/powers/Séisme.mp4",
          color: "#a78bfa",
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

    // Sync gameState immediately when the payload includes the full game object.
    // Without this, gameState.phase stays "killer_power_selection" for one render
    // after the phase_change arrives, causing PowerSelectionOverlay to flash
    // "En attente des autres Orcs..." even though action_complete is already True.
    if (data.game) {
      setGameState(data.game);
    }
    
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
        // NOTE: No auto-hide — user must click to close
        // quest_completed_popup REMOVED — replaced by continuous lucky searches
      } else if (data.type === "stone_quest_completed_popup") {
        setStoneQuestMessage(data.message);
        setShowStoneQuestPopup(true);
        setTimeout(() => setShowStoneQuestPopup(false), 4000);
      } else if (data.type === "toxin_death_popup") {
        // Show popup with video for toxin death
        setToxinDeathMessage(data.message);
        setToxinDeathVideoPath(data.video_path);
        setShowToxinDeathPopup(true);
        // NOTE: No auto-hide — user must click to close
      } else if (data.type === "wrong_class_popup") {
        // Show popup with image for wrong class
        setWrongClassMessage(data.message);
        setRequiredClassImage(data.required_class_image);
        setShowWrongClassPopup(true);
        // No auto-hide, user must click to close
      } else if (data.type === "lucky_search_popup") {
        // NEW: Fouille miraculeuse — réutilise le même rendu que wrong_class (image + message)
        setRequiredClassImage(data.required_class_image);
        setWrongClassMessage(data.message); // "Vous faites une fouille miraculeuse !"
        setShowWrongClassPopup(true);
      } else if (data.type === "gold_found") {
        // Show popup with gold image
        setGoldMessage(data.message);
        setGoldAmount(data.gold_amount);
        setGoldImage(data.gold_image);
        setShowGoldFoundPopup(true);
        // NOTE: No auto-hide — user must click to close (will trigger notifyEventCompleted)
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
        // NEW: store discovered events list for Secousse
        if (data.power === "secousse" && Array.isArray(data.events)) {
          setSecousseEvents(data.events);
        } else {
          setSecousseEvents([]);
        }
        // NEW: store cursable survivors list for Malédiction
        if (data.power === "malediction" && Array.isArray(data.cursable_survivors)) {
          setMaledictionSurvivors(data.cursable_survivors);
        } else if (data.power !== "malediction") {
          setMaledictionSurvivors([]);
        }
        setShowPowerAction(true);
      } else if (data.type === "game_reset") {
        // Redirect all players back to lobby when game is reset
        toast.info(data.message);
        setTimeout(() => {
          window.location.href = `/lobby/${sessionId}`;
        }, 1500); // Small delay to show the toast message
      } else if (data.type === "malediction_warning") {
        // Show curse warning popup for survivors
        setMaledictionWarningMessage(data.message);
        setMaledictionVideoPath(data.video_path || "/powers/Malediction.mp4");
        setShowMaledictionWarningPopup(true);
        // No auto-hide — user must click to close
      } else if (data.type === "malediction_penalty") {
        // Show curse penalty popup for survivors
        setMaledictionPenaltyMessage(data.message);
        setMaledictionVideoPath(data.video_path || "/powers/Malediction.mp4");
        setShowMaledictionPenaltyPopup(true);
        // No auto-hide — user must click to close
      } else if (data.type === "malediction_lifted") {
        // Malédiction Incertaine: the whole team's curse has been lifted at once
        setMaledictionLiftedMessage(data.message);
        setShowMaledictionLiftedPopup(true);
        // No auto-hide — user must click to close
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
    // Tenir compte des évolutions de pouvoir (ex: Traque de masse niveau 2 n'a pas besoin d'action)
    const powerDef = powerDefinitions[powerName];
    const currentPlayer = gameState.players[playerId];
    const evolution = currentPlayer?.powers_evolution?.[powerName];

    // Calculer si le pouvoir effectivement sélectionné requiert une action,
    // en appliquant les surcharges de variante niveau 2 (comme dans selectedPowerDef)
    let effectiveRequiresAction = powerDef?.requires_action;
    if (evolution?.level === 2) {
      if (powerName === "traque" && evolution.variant === "masse") {
        // Traque de masse : s'active directement, pas de sélection d'étage
        effectiveRequiresAction = false;
      } else if (powerName === "traque" && evolution.variant === "precision") {
        effectiveRequiresAction = true;
      }
      // Les autres variantes niveau 2 conservent le comportement de base
    }

    if (powerDef && !effectiveRequiresAction) {
      setShowOrcSearchPopup(true);
      // Auto-hide after 3 seconds
      setTimeout(() => {
        setShowOrcSearchPopup(false);
      }, 3000);
    } else if (powerDef && effectiveRequiresAction) {
      // Pour la malédiction : NE PAS afficher immédiatement.
      // La liste cursable_survivors arrive avec le power_action_required WebSocket —
      // afficher avant la réponse causerait un état vide ("Aucun aventurier...").
      // Pour tous les autres pouvoirs : affichage immédiat pour éviter le flash réseau.
      if (powerName !== "malediction") {
        setShowPowerAction(true);
      }
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

  // Resurrection stele: revive an eliminated survivor
  const useResurrectionStele = async (targetId) => {
    if (!gameState || !targetId) return;
    try {
      await axios.post(`${API}/game/${sessionId}/use_resurrection_stele`, {
        player_id: playerId,
        target_id: targetId,
      });
      setShowResurrectionPopup(false);
      setShowRevivalConfirm(false);
      setRevivalTargetId(null);
      notifyEventCompleted();
    } catch (err) {
      console.error("Resurrection failed:", err);
      toast.error("Impossible de réanimer ce joueur.");
    }
  };

  // NEW: Curse item function for Malédiction power
  const cursePowerItem = (targetPlayerId, slotIndex) => {
    if (!gameState || gameState.phase !== "killer_power_selection") return;
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "curse_item",
        target_player_id: targetPlayerId,
        slot_index: slotIndex
      }));
    }
    // Show "Fouillez une pièce" popup
    setShowPowerAction(false);
    setShowOrcSearchPopup(true);
    setTimeout(() => {
      setShowOrcSearchPopup(false);
    }, 3000);
  };

  // NEW: Curse all survivors at once (Malédiction de Masse)
  const cursePowerItemMasse = (selections) => {
    if (!gameState || gameState.phase !== "killer_power_selection") return;
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "curse_item_masse",
        selections: selections
      }));
    }
    // Show "Fouillez une pièce" popup
    setShowPowerAction(false);
    setShowOrcSearchPopup(true);
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
    
    // Check for La Poursuite
    if (gameState.goliath_active && gameState.goliath_turns_remaining > 0) {
      const hasPrecision = (gameState.poursuite_precision_empty_rooms || []).length > 0;
      traps.push({
        type: "goliath",
        icon: "/icons/Poursuite.png",
        name: "Poursuite",
        description: `La Poursuite est active pour ${gameState.goliath_turns_remaining} tour(s) : Ne choisissez jamais une pièce visitée au tour précédent !` +
          (hasPrecision && currentPlayerRole === "killer" ? ` Les salles marquées (vide) ne contiennent aucun aventurier.` : ``),
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

      {/* Combat Help Window — overlay A (en attente d'alliés) */}
      {combatHelpWaiting && (
        <CombatHelpWaitingOverlay
          data={combatHelpWaiting}
          participants={combatHelpParticipants}
          players={gameState.players}
          playerId={playerId}
          onExpire={() => {
            setCombatHelpWaiting(null);
            setCombatHelpParticipants([]);
          }}
        />
      )}

      {/* Combat Help Window — popup B (proposition de rejoindre) */}
      {combatHelpAvailable && (
        <CombatHelpAvailablePopup
          data={combatHelpAvailable}
          ws={ws}
          onClose={() => setCombatHelpAvailable(null)}
        />
      )}

      {/* Mimic Combat Popup */}
      {showMimicCombat && mimicCombatEvent && (
        <MimicCombat
          event={mimicCombatEvent}
          playerId={playerId}
          sessionId={sessionId}
          onClose={() => {
            setShowMimicCombat(false);
            setMimicCombatEvent(null);
            // Notifie le backend pour dispatcher l'événement suivant en queue
            // (sécurité : resolve_mimic_combat supprime déjà pending_events côté serveur,
            // mais cela déclenche dispatch_next_player_event côté frontend aussi)
            notifyEventCompleted();
          }}
        />
      )}

      {/* Crystal Combat Popup (identical pattern to MultiPlayerCombat) */}
      {showCrystalCombat && crystalCombatEvent && (
        <CrystalCombat
          event={crystalCombatEvent}
          playerId={playerId}
          sessionId={sessionId}
          wsRef={ws}
          onClose={() => {
            setShowCrystalCombat(false);
            setCrystalCombatEvent(null);
            notifyEventCompleted();
          }}
        />
      )}

      {/* Fleeing Goblin Combat Popup */}
      {showFleeingGoblinCombat && fleeingGoblinCombatEvent && (
        <FleeingGoblinCombat
          event={fleeingGoblinCombatEvent}
          playerId={playerId}
          sessionId={sessionId}
          onClose={() => {
            setShowFleeingGoblinCombat(false);
            setFleeingGoblinCombatEvent(null);
            notifyEventCompleted();
          }}
        />
      )}

      {/* NEW: Key Found Popup */}
      {showKeyFoundPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => { setShowKeyFoundPopup(false); notifyEventCompleted(); }}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPoisonVideoPopup(false);
                    setShowPoisonPopup(true);
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

      {/* quest_completed_popup REMOVED — replaced by continuous lucky searches */}

      {/* Stone quest completed — non-blocking toast */}
      {showStoneQuestPopup && (
        <div
          onClick={() => setShowStoneQuestPopup(false)}
          data-testid="stone-quest-popup"
          style={{
            position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 1100, backgroundColor: '#1a3a2a', border: '2px solid #4ade80',
            borderRadius: '12px', padding: '16px 24px', maxWidth: '420px', textAlign: 'center',
            boxShadow: '0 4px 24px rgba(74,222,128,0.3)', cursor: 'pointer'
          }}
        >
          <p style={{ color: '#4ade80', fontWeight: 'bold', fontSize: '1.1rem', margin: 0 }}>🪨 Quête de la Pierre accomplie !</p>
          <p style={{ color: '#e8dcc4', fontSize: '0.9rem', marginTop: '6px' }}>{stoneQuestMessage}</p>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', marginTop: '12px' }}>
            <img
              src={ITEM_SPRITES.relique_cubique}
              alt="Relique Cubique"
              style={{
                width: '80px',
                height: '80px',
                objectFit: 'contain',
                filter: 'drop-shadow(0 0 10px rgba(74,222,128,0.7))',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            <p style={{ color: '#4ade80', fontWeight: 'bold', fontSize: '0.95rem', margin: 0 }}>
              ✨ Relique Cubique ajoutée à l'inventaire !
            </p>
          </div>
          <p style={{ color: '#a0aec0', fontSize: '0.75rem', marginTop: '8px' }}>Cliquez pour fermer</p>
        </div>
      )}

      {/* NEW: Toxin Death Popup with Video */}
      {showToxinDeathPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1000 }}
          onClick={() => { setShowToxinDeathPopup(false); notifyEventCompleted(); }}
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
          onClick={() => { setShowWrongClassPopup(false); notifyEventCompleted(); }}
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
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button
                  onClick={() => {
                    setShowMerchantPopup(false);
                    setShowShopDialog(true);
                  }}
                  data-testid="merchant-buy-btn"
                  style={{ 
                    backgroundColor: '#d4af37', 
                    color: '#000', 
                    fontWeight: 'bold',
                    padding: '1rem 2rem',
                    fontSize: '1.1rem'
                  }}
                >
                  🛒 Acheter
                </Button>
                <Button
                  onClick={() => {
                    setShowMerchantPopup(false);
                    setShowSellDialog(true);
                  }}
                  data-testid="merchant-sell-btn"
                  style={{ 
                    backgroundColor: '#a16207', 
                    color: '#fff', 
                    fontWeight: 'bold',
                    padding: '1rem 2rem',
                    fontSize: '1.1rem'
                  }}
                >
                  💰 Vendre
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

                {/* Relique Triangulaire */}
                {!gameState.relique_triangulaire_sold && (
                <div style={{ 
                  padding: '1.5rem', 
                  backgroundColor: 'rgba(139, 92, 46, 0.3)', 
                  border: '2px solid #d4af37',
                  borderRadius: '8px',
                  display: 'flex',
                  gap: '1rem',
                  alignItems: 'center'
                }}>
                  <img src="/items/Relique_Triangulaire.png" alt="Relique Triangulaire" style={{ width: '80px', height: '80px', objectFit: 'contain' }} />
                  <div style={{ flex: 1 }}>
                    <h3 style={{ color: '#d4af37', fontSize: '1.2rem', marginBottom: '0.5rem' }}>Relique Triangulaire</h3>
                    <p style={{ color: '#ccc', fontSize: '0.95rem', marginBottom: '0.5rem' }}>
                      Le Roi Orc m'a confié cette étrange relique. Je ne dois pas m'en séparer mais si vous m'en offrez un bon prix, elle est à vous !
                    </p>
                    <p style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '1.1rem' }}>Prix: 🪙 1000</p>
                  </div>
                  <Button
                    onClick={async () => {
                      try {
                        await axios.post(`${API}/shop/buy_item?session_id=${sessionId}&player_id=${playerId}&item_name=relique_triangulaire`);
                        toast.success("Relique Triangulaire achetée !");
                      } catch (error) {
                        toast.error(error.response?.data?.detail || "Erreur lors de l'achat");
                      }
                    }}
                    disabled={gameState.players[playerId]?.gold < 1000 || (gameState.players[playerId]?.inventory || []).some(s => s?.type === 'relique_triangulaire')}
                    style={{ 
                      backgroundColor: (gameState.players[playerId]?.gold >= 1000 && !(gameState.players[playerId]?.inventory || []).some(s => s?.type === 'relique_triangulaire')) ? '#10b981' : '#555',
                      minWidth: '100px'
                    }}
                  >
                    Acheter
                  </Button>
                </div>
                )}
              </div>

              {/* Buttons */}
              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button
                  onClick={() => {
                    setShowShopDialog(false);
                    setShowSellDialog(true);
                  }}
                  style={{ 
                    backgroundColor: '#a16207', 
                    color: '#fff',
                    padding: '0.8rem 2rem',
                    fontSize: '1rem',
                    fontWeight: 'bold'
                  }}
                >
                  💰 Vendre des objets
                </Button>
                <Button
                  onClick={() => {
                    setShowShopDialog(false);
                    notifyEventCompleted();
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

      {/* NEW: Sell Dialog */}
      {showSellDialog && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 2001 }}
          data-testid="sell-dialog"
        >
          <Card className="game-over-card" style={{ maxWidth: '800px', backgroundColor: '#2a1f17', borderColor: '#d4af37' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#d4af37' }}>
                💰
                <span>Vendre au Marchand</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Display player's gold */}
              <div style={{ textAlign: 'center', marginBottom: '1.5rem', fontSize: '1.3rem', color: '#FFD700', fontWeight: 'bold' }}>
                Votre or: 🪙 {gameState.players[playerId]?.gold || 0}
              </div>

              {/* Sellable items list */}
              {(() => {
                const inventory = gameState.players[playerId]?.inventory || [];
                const sellable = inventory
                  .map((slot, idx) => ({ slot, idx }))
                  .filter(({ slot }) => slot && !NON_SELLABLE_ITEMS.has(slot.type));

                if (sellable.length === 0) {
                  return (
                    <div style={{
                      padding: '2rem',
                      textAlign: 'center',
                      color: '#a0aec0',
                      fontStyle: 'italic',
                      fontSize: '1.05rem',
                    }}>
                      Vous n'avez aucun objet à vendre.
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '50vh', overflowY: 'auto' }}>
                    {sellable.map(({ slot, idx }) => {
                      const itemType = slot.type;
                      const itemName = ITEM_NAMES[itemType] || itemType;
                      const itemSprite = ITEM_SPRITES[itemType];
                      const price = getSellPrice(itemType);

                      return (
                        <div key={idx} style={{
                          padding: '1.5rem',
                          backgroundColor: 'rgba(139, 92, 46, 0.3)',
                          border: '2px solid #d4af37',
                          borderRadius: '8px',
                          display: 'flex',
                          gap: '1rem',
                          alignItems: 'center'
                        }}>
                          <img
                            src={itemSprite}
                            alt={itemName}
                            style={{ width: '80px', height: '80px', objectFit: 'contain' }}
                          />
                          <div style={{ flex: 1 }}>
                            <h3 style={{ color: '#d4af37', fontSize: '1.2rem', marginBottom: '0.5rem' }}>{itemName}</h3>
                            <p style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '1.1rem' }}>
                              Valeur: 🪙 {price}
                            </p>
                          </div>
                          <Button
                            onClick={async () => {
                              try {
                                const res = await axios.post(`${API}/shop/sell_item?session_id=${sessionId}&player_id=${playerId}&slot_index=${idx}`);
                                toast.success(`${itemName} vendu pour ${res.data.gold_gained} pièces !`);
                              } catch (error) {
                                toast.error(error.response?.data?.detail || "Erreur lors de la vente");
                              }
                            }}
                            data-testid={`sell-item-btn-${idx}`}
                            style={{
                              backgroundColor: '#10b981',
                              minWidth: '100px',
                              color: '#fff',
                              fontWeight: 'bold'
                            }}
                          >
                            Vendre
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Buttons */}
              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button
                  onClick={() => {
                    setShowSellDialog(false);
                    setShowShopDialog(true);
                  }}
                  style={{ 
                    backgroundColor: '#d4af37', 
                    color: '#000',
                    padding: '0.8rem 2rem',
                    fontSize: '1rem',
                    fontWeight: 'bold'
                  }}
                >
                  🛒 Acheter des objets
                </Button>
                <Button
                  onClick={() => {
                    setShowSellDialog(false);
                    notifyEventCompleted();
                  }}
                  data-testid="close-sell-dialog-btn"
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

      {/* NEW: Cartographer Dialog */}
      {showCartographerDialog && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 2002 }}
          data-testid="cartographer-dialog"
        >
          <Card className="game-over-card" style={{ maxWidth: '800px', backgroundColor: '#2a1f17', borderColor: '#d4af37' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#d4af37' }}>
                🗺️
                <span>Le Cartographe</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Video */}
              {cartographerVideoPath && cartographerDialogStep === 'initial' && (
                <video 
                  autoPlay 
                  muted 
                  loop
                  style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1.5rem' }}
                >
                  <source src={cartographerVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}

              {/* Initial step */}
              {cartographerDialogStep === 'initial' && (
                <>
                  <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff', marginBottom: '1.5rem' }}>
                    Vous rencontrez le cartographe !
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <Button
                      onClick={() => setCartographerDialogStep('payment')}
                      style={{ 
                        backgroundColor: '#10b981', 
                        color: '#fff',
                        padding: '1rem 2rem',
                        fontSize: '1.1rem'
                      }}
                    >
                      💬 Dialoguer
                    </Button>
                    <Button
                      onClick={() => {
                        setShowCartographerDialog(false);
                        notifyEventCompleted();
                      }}
                      style={{ 
                        backgroundColor: '#6b7280', 
                        color: '#fff',
                        padding: '1rem 2rem',
                        fontSize: '1.1rem'
                      }}
                    >
                      🚪 Je ne suis pas intéressé
                    </Button>
                  </div>
                </>
              )}

              {/* Payment step */}
              {cartographerDialogStep === 'payment' && (
                <>
                  <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff', marginBottom: '1rem' }}>
                    Vous semblez perdu jeune aventurier. Contre une modique somme, je pourrai probablement vous aider.
                  </p>
                  <p style={{ textAlign: 'center', color: '#FFD700', fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>
                    Prix : 🪙 300 pièces d'or
                  </p>
                  <p style={{ textAlign: 'center', color: '#a0aec0', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
                    Votre or : 🪙 {gameState.players[playerId]?.gold || 0}
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <Button
                      onClick={() => {
                        if ((gameState.players[playerId]?.gold || 0) >= 300) {
                          setCartographerDialogStep('topic_choice');
                        } else {
                          toast.error("Vous n'avez pas assez d'or !");
                        }
                      }}
                      disabled={(gameState.players[playerId]?.gold || 0) < 300}
                      style={{ 
                        backgroundColor: (gameState.players[playerId]?.gold || 0) >= 300 ? '#10b981' : '#555',
                        color: '#fff',
                        padding: '1rem 2rem',
                        fontSize: '1.1rem'
                      }}
                    >
                      💰 Payer 300 pièces d'or
                    </Button>
                    <Button
                      onClick={() => {
                        setShowCartographerDialog(false);
                        notifyEventCompleted();
                      }}
                      style={{ 
                        backgroundColor: '#dc2626', 
                        color: '#fff',
                        padding: '1rem 2rem',
                        fontSize: '1.1rem'
                      }}
                    >
                      ❌ Non merci
                    </Button>
                  </div>
                </>
              )}

              {/* Topic choice step */}
              {cartographerDialogStep === 'topic_choice' && (
                <>
                  <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff', marginBottom: '1.5rem' }}>
                    Que recherchez-vous ?
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <Button
                      onClick={async () => {
                        try {
                          const response = await axios.post(`${API}/cartographer/pay_for_hint?session_id=${sessionId}&player_id=${playerId}&hint_topic=merchant`);
                          setCartographerHint(response.data.hint_text);
                          setCartographerDialogStep('hint_shown');
                          toast.success("Indice obtenu !");
                        } catch (error) {
                          toast.error(error.response?.data?.detail || "Erreur lors de l'obtention de l'indice");
                        }
                      }}
                      style={{ 
                        backgroundColor: '#8b5cf6', 
                        color: '#fff',
                        padding: '1rem 2rem',
                        fontSize: '1.1rem'
                      }}
                    >
                      🧙 Je cherche un marchand
                    </Button>
                    <Button
                      onClick={async () => {
                        try {
                          const response = await axios.post(`${API}/cartographer/pay_for_hint?session_id=${sessionId}&player_id=${playerId}&hint_topic=forge`);
                          setCartographerHint(response.data.hint_text);
                          setCartographerDialogStep('hint_shown');
                          toast.success("Indice obtenu !");
                        } catch (error) {
                          toast.error(error.response?.data?.detail || "Erreur lors de l'obtention de l'indice");
                        }
                      }}
                      style={{ 
                        backgroundColor: '#ef4444', 
                        color: '#fff',
                        padding: '1rem 2rem',
                        fontSize: '1.1rem'
                      }}
                    >
                      🔥 Je cherche la forge
                    </Button>
                  </div>
                </>
              )}

              {/* Hint shown step */}
              {cartographerDialogStep === 'hint_shown' && (
                <>
                  <div style={{ 
                    backgroundColor: 'rgba(212, 175, 55, 0.2)', 
                    border: '2px solid #d4af37',
                    borderRadius: '8px',
                    padding: '1.5rem',
                    marginBottom: '1.5rem'
                  }}>
                    <p style={{ fontSize: '1.2rem', color: '#d4af37', fontWeight: 'bold', textAlign: 'center', marginBottom: '1rem' }}>
                      💡 Indice du Cartographe
                    </p>
                    <p style={{ fontSize: '1.1rem', color: '#fff', textAlign: 'center' }}>
                      {cartographerHint}
                    </p>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <Button
                      onClick={() => {
                        setShowCartographerDialog(false);
                        setCartographerDialogStep('initial');
                        setCartographerHint('');
                        notifyEventCompleted();
                      }}
                      style={{ 
                        backgroundColor: '#10b981', 
                        color: '#fff',
                        padding: '1rem 2rem',
                        fontSize: '1.1rem'
                      }}
                    >
                      👋 Saluer le cartographe
                    </Button>
                  </div>
                </>
              )}
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

      {/* NEW: Crystal Popup */}
      {showCrystalPopup && (() => {
        const placed = gameState?.crystal_placed_relics || {};
        const allPlaced = placed.relique_spherique && placed.relique_cubique && placed.relique_triangulaire;

        const closeCrystal = async () => {
          setShowCrystalPopup(false);
          try { await axios.post(`${API}/game/${sessionId}/crystal_close`, { player_id: playerId }); } catch (e) {}
          notifyEventCompleted();
        };
        const placeRelic = async () => {
          try {
            const res = await axios.post(`${API}/game/${sessionId}/crystal_place_relic`, { player_id: playerId });
            toast.success(res.data.message);
          } catch (e) {
            toast.error(e.response?.data?.detail || "Erreur");
          }
        };
        const attackCrystal = async () => {
          try {
            await axios.post(`${API}/game/${sessionId}/crystal_attack`, { player_id: playerId });
            // Close the crystal popup — a 10s help window opens for allies to
            // join, then the `crystal_combat` WS event is sent by the backend.
            setShowCrystalPopup(false);
            toast.info("💎 Vous attaquez le Cristal ! Vos alliés ont 10s pour vous rejoindre...");
          } catch (e) {
            toast.error(e.response?.data?.detail || "Erreur");
          }
        };

        return (
          <div className="game-over-overlay" style={{ zIndex: 2000 }} data-testid="crystal-popup">
            <Card style={{ maxWidth: '700px', backgroundColor: '#0d1a26', borderColor: '#5fa8ff', border: '3px solid #5fa8ff' }}>
              <CardHeader>
                <CardTitle style={{ color: '#9fd0ff', textAlign: 'center' }}>
                  💎 Le Cristal
                </CardTitle>
              </CardHeader>
              <CardContent>
                {crystalVideoPath && (
                  <video src={crystalVideoPath} autoPlay loop muted
                    style={{ width: '100%', maxHeight: '380px', borderRadius: '8px', marginBottom: '1rem' }} />
                )}
                <p style={{ color: '#fff', textAlign: 'center', marginBottom: '1rem' }}>{crystalMessage}</p>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginBottom: '1rem' }}>
                  {['relique_spherique','relique_cubique','relique_triangulaire'].map(r => (
                    <span key={r} style={{
                      padding: '0.3rem 0.6rem', borderRadius: '6px',
                      backgroundColor: placed[r] ? '#1f4d2b' : '#3a1f1f',
                      color: placed[r] ? '#9fffb5' : '#ff9f9f', fontSize: '0.85rem',
                    }}>
                      {placed[r] ? '✓' : '✗'} {r.replace('relique_', '')}
                    </span>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Button data-testid="crystal-place-relic-btn" onClick={placeRelic}
                    style={{ backgroundColor: '#5fa8ff', color: '#000', fontWeight: 'bold' }}>
                    Placer une relique
                  </Button>
                  {allPlaced && (
                    <Button data-testid="crystal-attack-btn" onClick={attackCrystal}
                      style={{ backgroundColor: '#ff4d4d', color: '#fff', fontWeight: 'bold' }}>
                      ⚔️ Attaquer le cristal
                    </Button>
                  )}
                  <Button data-testid="crystal-close-btn" onClick={closeCrystal}
                    style={{ backgroundColor: '#555', color: '#fff' }}>
                    Fermer
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}
      {showCrystalPopup && (() => {
        const placed = gameState?.crystal_placed_relics || {};
        const requiredRelics = gameState?.required_relics || {
          relique_spherique: true,
          relique_cubique: true,
          relique_triangulaire: true
        };
        
        // Only check the relics that are required
        const requiredRelicsList = Object.keys(requiredRelics).filter(r => requiredRelics[r]);
        const allPlaced = requiredRelicsList.every(r => placed[r]);

        const closeCrystal = async () => {
          setShowCrystalPopup(false);
          try { await axios.post(`${API}/game/${sessionId}/crystal_close`, { player_id: playerId }); } catch (e) {}
          notifyEventCompleted();
        };
        const placeRelic = async () => {
          try {
            const res = await axios.post(`${API}/game/${sessionId}/crystal_place_relic`, { player_id: playerId });
            toast.success(res.data.message);
          } catch (e) {
            toast.error(e.response?.data?.detail || "Erreur");
          }
        };
        const attackCrystal = async () => {
          try {
            await axios.post(`${API}/game/${sessionId}/crystal_attack`, { player_id: playerId });
            // Close the crystal popup — a 10s help window opens for allies to
            // join, then the `crystal_combat` WS event is sent by the backend.
            setShowCrystalPopup(false);
            toast.info("💎 Vous attaquez le Cristal ! Vos alliés ont 10s pour vous rejoindre...");
          } catch (e) {
            toast.error(e.response?.data?.detail || "Erreur");
          }
        };

        return (
          <div className="game-over-overlay" style={{ zIndex: 2000 }} data-testid="crystal-popup">
            <Card style={{ maxWidth: '700px', backgroundColor: '#0d1a26', borderColor: '#5fa8ff', border: '3px solid #5fa8ff' }}>
              <CardHeader>
                <CardTitle style={{ color: '#9fd0ff', textAlign: 'center' }}>
                  💎 Le Cristal
                </CardTitle>
              </CardHeader>
              <CardContent>
                {crystalVideoPath && (
                  <video src={crystalVideoPath} autoPlay loop muted
                    style={{ width: '100%', maxHeight: '380px', borderRadius: '8px', marginBottom: '1rem' }} />
                )}
                <p style={{ color: '#fff', textAlign: 'center', marginBottom: '1rem' }}>{crystalMessage}</p>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginBottom: '1rem' }}>
                  {requiredRelicsList.length === 0 ? (
                    <span style={{
                      padding: '0.3rem 0.8rem', borderRadius: '6px',
                      backgroundColor: '#1f3a4d', color: '#9fd0ff', fontSize: '0.85rem',
                      fontStyle: 'italic',
                    }}>
                      ℹ️ Aucune relique n'est requise — le cristal est directement vulnérable.
                    </span>
                  ) : (
                    requiredRelicsList.map(r => (
                      <span key={r} style={{
                        padding: '0.3rem 0.6rem', borderRadius: '6px',
                        backgroundColor: placed[r] ? '#1f4d2b' : '#3a1f1f',
                        color: placed[r] ? '#9fffb5' : '#ff9f9f', fontSize: '0.85rem',
                      }}>
                        {placed[r] ? '✓' : '✗'} {r.replace('relique_', '')}
                      </span>
                    ))
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {requiredRelicsList.length > 0 && (
                    <Button data-testid="crystal-place-relic-btn" onClick={placeRelic}
                      style={{ backgroundColor: '#5fa8ff', color: '#000', fontWeight: 'bold' }}>
                      Placer une relique
                    </Button>
                  )}
                  {allPlaced && (
                    <Button data-testid="crystal-attack-btn" onClick={attackCrystal}
                      style={{ backgroundColor: '#ff4d4d', color: '#fff', fontWeight: 'bold' }}>
                      ⚔️ Attaquer le cristal
                    </Button>
                  )}
                  <Button data-testid="crystal-close-btn" onClick={closeCrystal}
                    style={{ backgroundColor: '#555', color: '#fff' }}>
                    Fermer
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

        // cursorHit is passed by ForgeTimingGame after the player clicks
        const handleForge = async (slotIndex, cursorHit) => {
          if (forgeBusy) return;
          setForgeBusy(true);
          setForgeAnimation('forging');
          setForgeFlashLabel('');
          try {
            const res = await axios.post(`${API}/game/${sessionId}/forge_use_rune`, {
              player_id: playerId,
              slot_index: slotIndex,
              cursor_hit: cursorHit,
            });
            const ok = res.data.result === 'success';
            setForgeBarAnimation(false);
            setForgeAnimation(ok ? 'success' : 'failure');
            setForgeFlashLabel(ok ? `✨ ${res.data.rune_label}` : `💥 Tous les bonus perdus`);
            if (ok) toast.success(`🔨 Forge réussie : ${res.data.rune_label}`);
            else toast.error(`💥 Forge ratée — bonus réinitialisés`);
            setTimeout(() => { setForgeAnimation(null); setForgeFlashLabel(''); setForgeBusy(false); }, 2200);
          } catch (e) {
            setForgeAnimation(null);
            setForgeBarAnimation(false);
            toast.error(e.response?.data?.detail || 'Erreur de forge');
            setForgeBusy(false);
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
                {/* Timing mini-game: shown full-width above the weapon/stats grid when active */}
                {forgeBarAnimation !== false && (
                  <div style={{ marginBottom: '1.2rem' }}>
                    <ForgeTimingGame
                      attempts={attempts}
                      onResult={(hit) => {
                        setForgeBarAnimation(false);
                        handleForge(forgeBarAnimation, hit);
                      }}
                    />
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'flex-start' }}>
                  <div style={{ position: 'relative', textAlign: 'center', padding: '1rem', backgroundColor: '#0d0a08', borderRadius: '12px', minHeight: '260px' }}>
                    <img src={weaponSrc} alt="Arme" style={weaponStyle} data-testid="forge-weapon-sprite" />
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
                          disabled={forgeBusy || forgeBarAnimation !== false}
                          onClick={() => { if (!forgeBusy && forgeBarAnimation === false) setForgeBarAnimation(idx); }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.6rem',
                            backgroundColor: '#2a1f17',
                            border: `2px solid ${forgeBarAnimation === idx ? '#ffd166' : '#ff7a18'}`,
                            borderRadius: '10px',
                            padding: '0.6rem 0.9rem',
                            color: '#fff',
                            cursor: (forgeBusy || forgeBarAnimation !== false) ? 'not-allowed' : 'pointer',
                            opacity: (forgeBusy || forgeBarAnimation !== false) ? 0.6 : 1,
                            transition: 'transform 0.15s',
                          }}
                          onMouseEnter={(e) => { if (!forgeBusy && forgeBarAnimation === false) e.currentTarget.style.transform = 'translateY(-2px)'; }}
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

      {/* Poursuite Spawn Popup */}
      {showPoursuiteSpawnPopup && (
        <div 
          className="game-over-overlay" 
          style={{ zIndex: 1001 }}
          onClick={() => setShowPoursuiteSpawnPopup(false)}
          data-testid="poursuite-spawn-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#2a2a2a', borderColor: '#8b0000' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#dc2626' }}>
                ⚔️
                <span>Poursuite !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {poursuiteSpawnVideoPath && (
                <video 
                  autoPlay 
                  muted 
                  style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1rem' }}
                  onEnded={() => setTimeout(() => setShowPoursuiteSpawnPopup(false), 1000)}
                >
                  <source src={poursuiteSpawnVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {poursuiteSpawnMessage}
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
          onClick={() => { setShowEboulementPopup(false); notifyEventCompleted(); }}
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
          onClick={() => { setShowPatrouillePopup(false); notifyEventCompleted(); }}
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

      {/* NEW: Observation Stone Alert Popup (for killers, non-blocking) */}
      {showObservationStoneAlert && (
        <div
          className="game-over-overlay"
          style={{ zIndex: 1001 }}
          onClick={() => setShowObservationStoneAlert(false)}
          data-testid="observation-stone-alert-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#1a1a2e', borderColor: '#7c3aed' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#a78bfa' }}>
                🔮
                <span>Aventurier repéré !</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {observationStoneVideoPath && (
                <video
                  autoPlay
                  muted
                  style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1rem' }}
                >
                  <source src={observationStoneVideoPath} type="video/mp4" />
                  Votre navigateur ne supporte pas la vidéo.
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {observationStoneMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Killer Alert Queue Popup ────────────────────────────────────────────
           Toutes les alertes non-bloquantes pour les killers (Patrouille, Blizzard,
           Toxine suffocante, Séisme…) passent par cette file. Une seule popup à la fois,
           la suivante s'affiche après fermeture. */}
      {activeKillerAlert && (
        <div
          className="game-over-overlay"
          style={{ zIndex: 1001 }}
          onClick={dismissKillerAlert}
          data-testid="killer-alert-queue-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#1a1a2e', borderColor: activeKillerAlert.color || '#f59e0b' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: activeKillerAlert.color || '#fbbf24' }}>
                {activeKillerAlert.icon} <span>{activeKillerAlert.title}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeKillerAlert.videoPath && (
                <video key={activeKillerAlert.videoPath} autoPlay muted style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1rem' }}>
                  <source src={activeKillerAlert.videoPath} type="video/mp4" />
                </video>
              )}
              <p className="game-over-message" style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff' }}>
                {activeKillerAlert.message}
              </p>
              {killerAlertQueue.length > 0 && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.8em', color: '#a0aec0', textAlign: 'center' }}>
                  {killerAlertQueue.length} alerte{killerAlertQueue.length > 1 ? 's' : ''} en attente
                </p>
              )}
              <p style={{ marginTop: '0.5rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>Cliquez pour continuer</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Resurrection Stele Encounter Popup */}
      {showResurrectionPopup && (
        <div className="game-over-overlay" style={{ zIndex: 2000 }} data-testid="resurrection-popup">
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#0f1f0f', borderColor: '#22c55e' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ color: '#86efac', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                🪦 Stèle de Résurrection
              </CardTitle>
            </CardHeader>
            <CardContent>
              {resurrectionVideoPath && (
                <video autoPlay muted style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1rem' }}>
                  <source src={resurrectionVideoPath} type="video/mp4" />
                </video>
              )}
              <p style={{ textAlign: 'center', fontSize: '1.05rem', color: '#dcfce7', marginBottom: '1.5rem', lineHeight: '1.6' }}>
                {resurrectionMessage}
              </p>
              {!showRevivalConfirm ? (
                <>
                  {resurrectionEliminatedSurvivors.length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#a0aec0' }}>Aucun coéquipier à réanimer.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                      {resurrectionEliminatedSurvivors.map((s) => (
                        <button
                          key={s.id}
                          data-testid={`revive-target-${s.id}`}
                          onClick={() => { setRevivalTargetId(s.id); setShowRevivalConfirm(true); }}
                          style={{
                            backgroundColor: '#14532d', border: '2px solid #22c55e', borderRadius: '10px',
                            padding: '0.75rem 1.5rem', color: '#dcfce7', fontSize: '1rem', cursor: 'pointer',
                            transition: 'background 0.2s',
                          }}
                        >
                          💀 Réanimer <strong>{s.name}</strong>
                        </button>
                      ))}
                    </div>
                  )}
                  <Button
                    data-testid="resurrection-skip-btn"
                    onClick={() => { setShowResurrectionPopup(false); notifyEventCompleted(); }}
                    className="w-full"
                    style={{ backgroundColor: '#555', marginTop: '0.5rem' }}
                  >
                    Passer
                  </Button>
                </>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: '#fef9c3', marginBottom: '1.5rem', fontSize: '1.05rem' }}>
                    Vous allez sacrifier <strong>¼ de vos PV</strong> pour réanimer{' '}
                    <strong>{resurrectionEliminatedSurvivors.find(s => s.id === revivalTargetId)?.name}</strong>.
                    <br/>Confirmer ?
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                    <Button
                      data-testid="revive-confirm-btn"
                      onClick={() => useResurrectionStele(revivalTargetId)}
                      style={{ backgroundColor: '#15803d', padding: '0.75rem 2rem', fontWeight: 'bold' }}
                    >
                      ✅ Confirmer
                    </Button>
                    <Button
                      data-testid="revive-cancel-btn"
                      onClick={() => { setShowRevivalConfirm(false); setRevivalTargetId(null); }}
                      style={{ backgroundColor: '#555', padding: '0.75rem 2rem' }}
                    >
                      Annuler
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* You Were Revived Popup */}
      {showYouWereRevivedPopup && (
        <div
          className="game-over-overlay"
          style={{ zIndex: 2000 }}
          onClick={() => setShowYouWereRevivedPopup(false)}
          data-testid="you-were-revived-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#0f1f0f', borderColor: '#22c55e' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ color: '#86efac', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                🌟 Vous avez été réanimé !
              </CardTitle>
            </CardHeader>
            <CardContent>
              {youWereRevivedVideoPath && (
                <video autoPlay muted style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1rem' }}>
                  <source src={youWereRevivedVideoPath} type="video/mp4" />
                </video>
              )}
              <p style={{ textAlign: 'center', fontSize: '1.1rem', color: '#dcfce7', lineHeight: '1.6' }}>
                {youWereRevivedMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#a0aec0', textAlign: 'center' }}>
                Vous rejoignez la partie au prochain tour — Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Malédiction Warning Popup (for survivors) */}
      {showMaledictionWarningPopup && (
        <div
          className="game-over-overlay"
          style={{ zIndex: 1002 }}
          onClick={() => setShowMaledictionWarningPopup(false)}
          data-testid="malediction-warning-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#1a0a2e', borderColor: '#7c3aed' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#c4b5fd', animation: 'cursedPulse 1.5s ease-in-out infinite' }}>
                🔮 MALÉDICTION !
              </CardTitle>
            </CardHeader>
            <CardContent>
              {maledictionVideoPath && (
                <video
                  autoPlay
                  muted
                  style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1rem' }}
                >
                  <source src={maledictionVideoPath} type="video/mp4" />
                </video>
              )}
              <p style={{ fontSize: '1.05em', textAlign: 'center', color: '#e9d5ff', lineHeight: '1.6' }}>
                {maledictionWarningMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Malédiction Penalty Popup (for survivors) */}
      {showMaledictionPenaltyPopup && (
        <div
          className="game-over-overlay"
          style={{ zIndex: 1002 }}
          onClick={() => setShowMaledictionPenaltyPopup(false)}
          data-testid="malediction-penalty-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#2a0a0a', borderColor: '#dc2626' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#fca5a5', animation: 'bloodPulse 1.5s ease-in-out infinite' }}>
                💀 MALÉDICTION — PUNITION !
              </CardTitle>
            </CardHeader>
            <CardContent>
              {maledictionVideoPath && (
                <video
                  autoPlay
                  muted
                  style={{ width: '100%', maxHeight: '350px', borderRadius: '8px', marginBottom: '1rem' }}
                >
                  <source src={maledictionVideoPath} type="video/mp4" />
                </video>
              )}
              <p style={{ fontSize: '1.05em', textAlign: 'center', color: '#fca5a5', lineHeight: '1.6' }}>
                {maledictionPenaltyMessage}
              </p>
              <p style={{ marginTop: '1rem', fontSize: '0.9em', color: '#a0aec0', textAlign: 'center' }}>
                Cliquez pour continuer
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NEW: Malédiction Incertaine - team-wide curse lifted popup */}
      {showMaledictionLiftedPopup && (
        <div
          className="game-over-overlay"
          style={{ zIndex: 1002 }}
          onClick={() => setShowMaledictionLiftedPopup(false)}
          data-testid="malediction-lifted-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '700px', backgroundColor: '#1e0a32', borderColor: '#7c3aed' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#c4b5fd' }}>
                🔮 Malédiction levée !
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p style={{ fontSize: '1.05em', textAlign: 'center', color: '#c4b5fd', lineHeight: '1.6' }}>
                {maledictionLiftedMessage}
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                <Button
                  data-testid="malediction-lifted-ok-btn"
                  onClick={() => setShowMaledictionLiftedPopup(false)}
                  style={{ backgroundColor: '#7c3aed', padding: '0.6rem 1.5rem' }}
                >
                  OK
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Traque Result Popup */}
      {showTraquePopup && (
        <div
          className="game-over-overlay"
          style={{ zIndex: 1001 }}
          onClick={() => setShowTraquePopup(false)}
          data-testid="traque-popup"
        >
          <Card className="game-over-card" style={{ maxWidth: '600px', backgroundColor: '#1a1a2e', borderColor: '#8b5cf6' }}>
            <CardHeader>
              <CardTitle className="game-over-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#8b5cf6' }}>
                🔊 Traque
              </CardTitle>
            </CardHeader>
            <CardContent>
              <video
                key={traqueVideoPath}
                autoPlay
                muted
                style={{ width: '100%', maxHeight: '320px', borderRadius: '8px', marginBottom: '1rem' }}
                onEnded={() => {/* keep popup open until clicked */}}
              >
                <source src={traqueVideoPath} type="video/mp4" />
                Votre navigateur ne supporte pas la vidéo.
              </video>
              <p style={{ fontSize: '1.1em', textAlign: 'center', color: '#fff', fontWeight: 'bold' }}>
                {traqueMessage}
              </p>
              {traqueAvatars.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  {traqueAvatars.map((avatarPath, idx) => (
                    <img
                      key={idx}
                      src={avatarPath}
                      alt="Aventurier détecté"
                      style={{ width: '64px', height: '64px', borderRadius: '50%', border: '2px solid #8b5cf6', objectFit: 'cover' }}
                    />
                  ))}
                </div>
              )}
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
          {/* Keys counter REMOVED — no more quest/key system */}
          {currentPlayerRole === "survivor" && gameState.observation_stone_target_room && (
            <div
              className="keys-counter"
              data-testid="stone-quest-counter"
              style={{ marginTop: '4px', fontSize: '0.82em', color: gameState.observation_stone_quest_completed ? '#4ade80' : '#f6c90e' }}
              title={`Pierre d'observation : jeter à ${gameState.observation_stone_target_room}`}
            >
              {gameState.observation_stone_quest_completed
                ? "🪨 ✅ Pierre jetée"
                : `🪨 Pierre → ${gameState.observation_stone_target_room}`}
            </div>
          )}
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
          key={gameState.turn}
          gameState={gameState}
          playerId={playerId}
          powerDefinitions={powerDefinitions}
          selectedPower={selectedPower}
          selectPower={selectPower}
          showPowerAction={showPowerAction}
          confirmPowerAction={confirmPowerAction}
          powerActionData={powerActionData}
          secousseEvents={secousseEvents}
          maledictionSurvivors={maledictionSurvivors}
          cursePowerItem={cursePowerItem}
          cursePowerItemMasse={cursePowerItemMasse}
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

                    // 3. Pour les orcs : afficher les aventuriers révélés par le gobelin espion pour ce tour
                    // Variant "patrouille" → position exacte (afficher avatar dans la salle)
                    // Variant base/vadrouille → présence seulement (floor toast uniquement, pas d'avatar)
                    let patrolRevealedInRoom = [];
                    if (currentPlayerRole === "killer" && gameState.patrol_revealed_survivors) {
                      patrolRevealedInRoom = Object.entries(gameState.patrol_revealed_survivors)
                        .filter(([pid, revealedRoom]) => {
                          // "__floor__X" entries are presence-only (espionnage/vadrouille) — no avatar
                          if (!revealedRoom || revealedRoom.startsWith("__floor__")) return false;
                          if (revealedRoom !== room.name) return false;
                          const player = gameState.players[pid];
                          return player && !player.eliminated && player.role === "survivor";
                        })
                        .map(([pid]) => gameState.players[pid]);
                    }

                    // 4. Pour les orcs : afficher les aventuriers portant la Pierre d'observation (position révélée)
                    let stoneRevealedInRoom = [];
                    if (currentPlayerRole === "killer") {
                      stoneRevealedInRoom = Object.values(gameState.players)
                        .filter(player => {
                          if (player.role !== "survivor" || player.eliminated) return false;
                          if (player.current_room !== room.name) return false;
                          if (!player.has_observation_stone) return false;
                          // Ne pas dupliquer avec patrol
                          const alreadyShown = patrolRevealedInRoom.some(p => p.id === player.id);
                          return !alreadyShown;
                        })
                        .map(player => ({ ...player, _stone_revealed: true }));
                    }

                    playersSelectingThisRoom = [...playersWithPendingAction, ...playersAtCurrentPosition, ...patrolRevealedInRoom, ...stoneRevealedInRoom];
                  }

                  const eliminatedInRoom = room.eliminated_players || [];
                  
                  // Check for power effects
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
                         } ${flashingRooms.has(room.name) ? 'room-teammate-flash' : ''} ${isAnimatingDiscovery ? 'room-discovery-animation' : ''} ${
                          currentPlayerRole === "killer" &&
                          (gameState.killer_knows_pillaged?.[playerId] || []).includes(room.name)
                            ? 'room-pillaged' : ''
                         }`}
                        onClick={() => selectRoom(room.name)}
                        disabled={isEliminated || hasSelectedRoom || room.locked}
                      >
                        <div className="room-name">{displayName}</div>
                        {currentPlayerRole === "killer" &&
                         (gameState.killer_knows_pillaged?.[playerId] || []).includes(room.name) && (
                          <div className="room-pillaged-banner" data-testid={`pillaged-banner-${room.name}`}>
                            PIÈCE PILLÉE
                          </div>
                        )}
                        {/* Poursuite de Précision : indiquer les salles sans survivants aux killers */}
                        {currentPlayerRole === "killer" &&
                         (gameState.poursuite_precision_empty_rooms || []).includes(room.name) && (
                          <div style={{
                            fontSize: '0.72em',
                            color: '#a3e635',
                            fontStyle: 'italic',
                            marginTop: '2px',
                            lineHeight: 1.1,
                          }}>
                            (vide)
                          </div>
                        )}
                        <div className="room-indicators">
                          {room.locked && <span className="room-icon locked-icon">❌</span>}
                          {eliminatedInRoom.length > 0 && <span className="room-icon skull-icon">💀</span>}
                          {isTrapped && <span className="room-icon room-trap-indicator" title="Blizzard">🥶</span>}
                          {isTrapTriggered && <span className="room-icon room-trap-indicator" title="Blizzard activé">🥶</span>}
                          {isPoisoned && <span className="room-icon room-poison-indicator" title="Toxine">😷</span>}
                          {hasMimic && <span className="room-icon room-mimic-indicator" title="Mimic">💰</span>}
                          {hasTeleportationTrap && <span className="room-icon room-teleport-trap-indicator" title="Piège de téléportation">➡️🌀</span>}
                          {hasTeleportationExit && <span className="room-icon room-teleport-exit-indicator" title="Portail de sortie">🌀➡️</span>}
                          {((room.merchant_discovered && currentPlayerRole === "survivor") || (room.merchant_killer_visible && currentPlayerRole === "killer")) && (
                             <span className="room-player-avatar" title="Marchand">
                                 <img src="/avatars/Merchant.png" alt="Marchand" style={{ width: '1.3rem', height: '1.3rem', objectFit: 'contain' }} />
                             </span>
                          )}
                          {(room.has_crystal_event && currentPlayerRole === "killer") ||
                           (room.crystal_discovered && currentPlayerRole === "survivor") ? (
                             <span className="room-player-avatar" title="Cristal">
                               <img src="/avatars/cristal.png" alt="Cristal" style={{ width: '1.4rem', height: '1.4rem', objectFit: 'contain' }} />
                             </span>
                          ) : null}
                          {((room.cartographer_discovered && currentPlayerRole === "survivor") || (room.cartographer_killer_visible && currentPlayerRole === "killer")) && (
                             <span className="room-player-avatar" title="Cartographe">
                                 <img src="/avatars/Cartographe.png" alt="Cartographe" style={{ width: '1.3rem', height: '1.3rem', objectFit: 'contain' }} />
                             </span>
                          )}
                          {((room.forge_discovered && currentPlayerRole === "survivor") || (room.forge_killer_visible && currentPlayerRole === "killer")) && (
                             <span className="room-icon" title="Forge" style={{ fontSize: '1.1rem' }}>🔥</span>
                          )}
                          {((room.resurrection_stele_discovered && currentPlayerRole === "survivor") || (room.resurrection_stele_killer_visible && currentPlayerRole === "killer")) && (
                             <span className="room-player-avatar" title="Stèle de résurrection">
                               <img src="/avatars/revive.png" alt="Stèle de résurrection" style={{ width: '1.3rem', height: '1.3rem', objectFit: 'contain' }} />
                             </span>
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
                      // sound_clue events are now shown as a popup — hide from journal
                      if (event.type === "sound_clue") {
                        return null;
                      }

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

      {/* Inventory Modal */}
      {showInventory && currentPlayer && (
        <InventoryModal
          player={currentPlayer}
          onClose={() => setShowInventory(false)}
          sessionId={sessionId}
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
          onOpenInventory={() => setShowInventory(true)}
          player={currentPlayer}
        />
      )}

      {/* 🥛 Lait LEW Pickup Modal */}
      {gameState.pending_events &&
       gameState.pending_events[playerId] &&
       typeof gameState.pending_events[playerId] === 'object' &&
       gameState.pending_events[playerId].type === 'lait_lew_found' && (
        <LaitLewPickupModal
          event={gameState.pending_events[playerId]}
          playerId={playerId}
          sessionId={sessionId}
          onOpenInventory={() => setShowInventory(true)}
          player={currentPlayer}
        />
      )}

      {/* Amulette Pickup Modal */}
      {gameState.pending_events && 
       gameState.pending_events[playerId] && 
       typeof gameState.pending_events[playerId] === 'object' &&
       (gameState.pending_events[playerId].type === 'amulette_tortue_found' ||
        gameState.pending_events[playerId].type === 'amulette_oignon_found' ||
        gameState.pending_events[playerId].type === 'amulette_trefle_found' ||
        gameState.pending_events[playerId].type === 'foulard_rankyr_found' ||
        gameState.pending_events[playerId].type === 'amulette_coco_found' ||
        gameState.pending_events[playerId].type === 'bandana_ranja_found' ||
        gameState.pending_events[playerId].type === 'bonnet_croblow_found') && (
        <AmulettePickupModal
          event={gameState.pending_events[playerId]}
          playerId={playerId}
          sessionId={sessionId}
          onOpenInventory={() => setShowInventory(true)}
          player={currentPlayer}
        />
      )}

      {/* Goblin Stat Choice Modal (killers only) */}
      {gameState.pending_events &&
       gameState.pending_events[playerId] &&
       typeof gameState.pending_events[playerId] === 'object' &&
       gameState.pending_events[playerId].type === 'goblin_roulette_choice' && (
        <GoblinStatChoiceModal
          gameState={gameState}
          playerId={playerId}
          sessionId={sessionId}
        />
      )}

      {/* Goblin Roulette Modal (active roulette) */}
      {gameState.pending_events &&
       gameState.pending_events[playerId] &&
       typeof gameState.pending_events[playerId] === 'object' &&
       gameState.pending_events[playerId].type === 'goblin_roulette_active' && (
        <GoblinRouletteModal
          gameState={gameState}
          playerId={playerId}
          sessionId={sessionId}
        />
      )}

      {/* Pierre Quete Pickup Modal — n'apparaît pas si un combat est en cours */}
      {gameState.pending_events && 
       gameState.pending_events[playerId] && 
       typeof gameState.pending_events[playerId] === 'object' &&
       gameState.pending_events[playerId].type === 'pierre_quete_found' &&
       !showMimicCombat &&
       !showMultiplayerCombat &&
       !showGoblinCombat &&
       !showCrystalCombat &&
       !showFleeingGoblinCombat && (
        <PierreQueteModal
          event={gameState.pending_events[playerId]}
          playerId={playerId}
          sessionId={sessionId}
          targetRoom={gameState.observation_stone_target_room}
          onOpenInventory={() => setShowInventory(true)}
          player={currentPlayer}
        />
      )}

      {/* Trophy Pickup Modal (Chaussons / Couronne / Culotte) */}
      {gameState.pending_events &&
       gameState.pending_events[playerId] &&
       typeof gameState.pending_events[playerId] === 'object' &&
       gameState.pending_events[playerId].type === 'trophy_found' && (
        <TrophyModal
          event={gameState.pending_events[playerId]}
          playerId={playerId}
          sessionId={sessionId}
          onOpenInventory={() => setShowInventory(true)}
          player={currentPlayer}
        />
      )}

      {/* Crystal Combat — handled by the dedicated <CrystalCombat /> component
          (see render block above). The previous server-driven overlay was
          replaced by an event-broadcast model identical to GoblinCombat. */}

      {/* Power Specialization Modal
          ⚠️ Affichée uniquement lorsqu'AUCUNE modale de combat n'est ouverte côté killer.
          Cas : si un combat (goblin / multiplayer / mimic / crystal / fleeing goblin) est
          déclenché en même temps que la spécialisation (le killer a fouillé une pièce
          contenant des aventuriers), on attend la fermeture du combat via le bouton
          "Cliquez pour fermer" avant d'afficher la popup de spécialisation.
          Si aucun combat n'a été déclenché, la popup s'affiche normalement, immédiatement. */}
      {showPowerSpecialization &&
        powerSpecializationData &&
        !showGoblinCombat &&
        !showMultiplayerCombat &&
        !showMimicCombat &&
        !showCrystalCombat &&
        !showFleeingGoblinCombat && (
          <PowerSpecializationModal
            data={powerSpecializationData}
            onClose={() => {
              setShowPowerSpecialization(false);
              setPowerSpecializationData(null);
            }}
            wsRef={ws}
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
