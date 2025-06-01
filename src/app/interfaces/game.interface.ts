// Firebase Imports (ensure you have firebase installed: npm install firebase)
import { Timestamp } from 'firebase/firestore';
import { Player } from './player.interface';

export interface Game {
    id: string;
    name?: string;
    hostId: string;
    hostName?: string;
    status: 'lobby' | 'starting' | 'teamProposal' | 'teamVoting' | 'mission' | 'results' | 'assassination' | 'gameOver';
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
        cardId: string;       // ID of the played card (e.g., 'po', 'ceo')
        playedBy: string;     // Player ID who played the card
        playedAt: Timestamp;  // When the card was played
    };
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
}
