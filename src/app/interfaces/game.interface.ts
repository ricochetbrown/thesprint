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
        // Add other game settings, like optional roles
    };
    createdAt: Timestamp;
    updatedAt: Timestamp;
    currentTO_id?: string; // Technical Owner ID
    currentStoryNum?: number; // 1-based index
    storiesTotal?: number;
    storyResults?: ('dexter' | 'sinister' | null)[]; // For each story
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