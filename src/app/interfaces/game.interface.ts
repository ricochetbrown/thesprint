// Firebase Imports (ensure you have firebase installed: npm install firebase)
import { Timestamp } from 'firebase/firestore';
import { Player } from './player.interface';

export interface Game {
    id: string;
    name?: string;
    hostId: string;
    hostName?: string;
    status: 'lobby' | 'starting' | 'teamProposal' | 'teamVoting' | 'mission' | 'results' | 'assassination' | 'gameOver' | 'shiftingPriorities' | 'loyaltyReveal' | 'ceoCardPlay';
    players: { [playerId: string]: Player }; // Player objects keyed by player ID
    playerOrder: string[]; // Array of player IDs to maintain order
    settings: {
        maxPlayers: number;
        isPublic: boolean;
        optionalRoles?: {
            includeDuke: boolean;
            includeSupportManager: boolean;
            includeNerlin: boolean;
            includeDevSlayer: boolean;
            includeSniper: boolean;
        };
    };
    managementDeck?: string[]; // Array of management card types
    managementDesignatedPlayer?: string; // Player ID designated to receive a management card
    managementPhase?: boolean; // Whether we're in the management phase (between Grooming and Review)
    managementCardPlayPhase?: boolean; // Whether a player has drawn a management card and now has the opportunity to play it
    playedManagementCard?: {
        cardId: string;       // ID of the played card (e.g., 'po', 'ceo', 'tl')
        playedBy: string;     // Player ID who played the card
        playedAt: Timestamp;  // When the card was played
    };
    discardedManagementCards?: {
        cardId: string;       // ID of the discarded card (e.g., 'po', 'ceo', 'tl')
        playedBy: string;     // Player ID who played/discarded the card
        discardedAt: Timestamp; // When the card was discarded
    }[];
    preliminaryReview?: {
        designatedPlayerId: string; // Player ID designated to review the User Story
        designatedBy: string;       // Player ID who designated the reviewer
        action: 'merge' | 'requestChanges'; // Action taken by the designated player
        timestamp: Timestamp;       // When the review was conducted
    };
    originalStoryNum?: number; // Original story number when PO card was played
    poShiftedStories?: number[]; // Stories that have been completed due to PO card effect
    createdAt: Timestamp;
    updatedAt: Timestamp;
    currentTO_id?: string; // Technical Owner ID
    currentStoryNum?: number; // 1-based index
    storiesTotal?: number;
    storyResults?: ('dexter' | 'sinister' | null)[]; // For each story
    completedMissionTeams?: { [storyIndex: number]: string[] }; // Teams for completed missions
    missionHistory?: {
        [storyIndex: number]: {
            team: string[];
            acceptedTeamProposedBy: string; // TO ID who proposed the accepted team
            requestChangesCount: number; // Number of "request changes" cards
        }
    };
    voteFailsThisRound?: number; // Rethrows for current story
    gameLog?: { timestamp: Timestamp, message: string }[];
    // Specific game phase data
    teamProposal?: {
        numToSelect: number;
        selectedPlayers: string[];
    };
    teamVote?: {
        proposedTeam: string[];
        votes: { [playerId: string]: 'agree' | 'rethrow' };
    };
    mission?: {
        team: string[];
        cardsPlayed: { [playerId: string]: 'approve' | 'request' }; // Or 'buggyCode' with expansion
    };
    assassination?: {
        sniperId: string;
        targetId?: string;
    };
    winner?: 'dexter' | 'sinister'; // Or 'creepers' with expansion
    roles?: { [playerId: string]: string }; // Assigned roles
    revealedLoyalties?: {
        [revealerId: string]: {
            targetId: string; // Player who was shown the loyalty
            timestamp: Timestamp;
        }
    }; // Tracks which players have revealed their loyalty to which other players
    loyaltyRevealPlayerId?: string; // Player ID who is currently revealing their loyalty

    // CEO card properties
    ceoCardPlayerId?: string; // Player ID who played the CEO card
    ceoCardDrawnCards?: string[]; // Cards drawn when playing CEO card (when no other player has a management card)
    ceoCardSelectedCard?: string; // Card selected from the drawn cards
    previousStatus?: 'lobby' | 'starting' | 'teamProposal' | 'teamVoting' | 'mission' | 'results' | 'assassination' | 'gameOver' | 'shiftingPriorities' | 'loyaltyReveal' | 'ceoCardPlay'; // Previous game status before special phase
}
