import { signal, WritableSignal, effect, inject, Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { serverTimestamp, Unsubscribe } from 'firebase/firestore';
import { Game } from '../interfaces/game.interface';
import { Player } from '../interfaces/player.interface';

// --- Game Service ---
@Injectable({ providedIn: 'root' })
export class GameService {
    private firestoreService = inject(FirestoreService);
    private authService = inject(AuthService);

    currentGame: WritableSignal<Game | null> = signal(null);
    activeGameId: WritableSignal<string | null> = signal(null);
    private gameUnsubscribe: Unsubscribe | null = null;

    constructor() {
        // When activeGameId changes, listen to the new game document
        effect(() => {
            const gameId = this.activeGameId();
            if (this.gameUnsubscribe) {
                this.gameUnsubscribe();
                this.gameUnsubscribe = null;
            }
            if (gameId) {
                 // Games are public
                this.gameUnsubscribe = this.firestoreService.listenToDocument<Game>(
                    'games', 
                    gameId, 
                    (gameData) => {
                        this.currentGame.set(gameData);
                        console.log("Game data updated:", gameData);

                        // Check if the current player is an AI and is the current TO
                        const game = this.currentGame();
                        const currentUserId = this.authService.userId();
                        const isAI = currentUserId && gameId.startsWith(gameId + '-AI-'); // Check if the gameId is part of the AI ID

                        if (game && currentUserId && isAI && game.currentTO_id === currentUserId && game.status === 'teamProposal') {
                            this.aiProposeTeam();
                        }
                    },
                    true 
                );
            } else {
                this.currentGame.set(null);
            }
        });
    }

    async createGame(gameName: string, maxPlayers: number, isPublic: boolean): Promise<string> {
        const currentUser = this.authService.currentUser();
        const currentUserId = this.authService.userId();

        if (!currentUser || !currentUserId) throw new Error("User not authenticated to create game.");

        const hostPlayer: Player = {
            id: currentUserId,
            name: currentUser.displayName || currentUser.email || 'Host Player',
            isHost: true
        };

        const gameData: Omit<Game, 'id' | 'createdAt' | 'updatedAt'> = { // Firestore service adds timestamps
            name: gameName || `Sprint Game by ${hostPlayer.name}`,
            hostId: currentUserId,
            hostName: hostPlayer.name,
            status: 'lobby',
            players: { [currentUserId]: hostPlayer },
            playerOrder: [currentUserId],
            settings: { maxPlayers, isPublic },
            // Initialize other game fields as needed
            storiesTotal: 5, // Default for "The Sprint"
            storyResults: Array(5).fill(null),
            voteFailsThisRound: 0,
        };
        
        // Games are stored in a public collection
        const gameId = await this.firestoreService.createDocument<Omit<Game, 'id' | 'createdAt' | 'updatedAt'>>('games', gameData, undefined, true);
        this.activeGameId.set(gameId);
        return gameId;
    }

    async joinGame(gameId: string): Promise<void> {
        const currentUser = this.authService.currentUser();
        const currentUserId = this.authService.userId();

        if (!currentUser || !currentUserId) throw new Error("User not authenticated to join game.");

        const game = await this.firestoreService.getDocument<Game>('games', gameId, true);
        if (!game) throw new Error("Game not found.");
        if (Object.keys(game.players).length >= game.settings.maxPlayers) throw new Error("Game is full.");
        if (game.players[currentUserId]) {
            console.log("Player already in game. Setting as active game.");
            this.activeGameId.set(gameId); // Already in game
            return;
        }

        const newPlayer: Player = {
            id: currentUserId,
            name: currentUser.displayName || currentUser.email || `Player ${Object.keys(game.players).length + 1}`
        };

        const updatedPlayers = { ...game.players, [currentUserId]: newPlayer };
        const updatedPlayerOrder = [...game.playerOrder, currentUserId];

        await this.firestoreService.updateDocument('games', gameId, { players: updatedPlayers, playerOrder: updatedPlayerOrder }, true);
        this.activeGameId.set(gameId);
    }

    async leaveGame(): Promise<void> {
        const gameId = this.activeGameId();
        const currentUserId = this.authService.userId();
        if (!gameId || !currentUserId) return;

        const game = this.currentGame();
        if (!game || !game.players[currentUserId]) return;

        // More complex logic needed: reassign host, remove player, update playerOrder.
        // For simplicity, just clearing active game for now.
        // TODO: Implement full leave game logic (especially if host leaves)
        delete game.players[currentUserId];
        const newPlayerOrder = game.playerOrder.filter((id: string) => id !== currentUserId);

        if (Object.keys(game.players).length === 0) {
            // If last player leaves, delete the game (or mark as abandoned)
            // await this.firestoreService.deleteDocument('games', gameId, true); // Be careful with this
            console.log(`Game ${gameId} is now empty. Consider deleting or archiving.`);
        } else {
            let newHostId = game.hostId;
            if (game.hostId === currentUserId && newPlayerOrder.length > 0) {
                newHostId = newPlayerOrder[0]; // Assign new host
                game.players[newHostId].isHost = true;
            }
            await this.firestoreService.updateDocument('games', gameId, { 
                players: game.players, 
                playerOrder: newPlayerOrder,
                hostId: newHostId,
                hostName: newHostId ? game.players[newHostId]?.name : undefined
            }, true);
        }
        
        this.activeGameId.set(null);
    }

    async startGame(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || game.hostId !== currentUserId) {
            throw new Error("Only the host can start the game.");
        }
        if (Object.keys(game.players).length < 5 || Object.keys(game.players).length > 12) { 
            throw new Error("Invalid number of players (must be between 5 and 12).");
        }
        if (game.status !== 'lobby') {
            throw new Error("Game already started or not in lobby.");
        }

        // TODO: Implement role assignment logic here based on "manual (1).pdf" player counts
        // For now, just set status to 'starting' (which could trigger role assignment)
        // and then to 'teamProposal' with the first TO.
        const roles = this.assignRoles(game.playerOrder);
        const firstTO = game.playerOrder[0]; // Simplistic: first player is TO

        await this.firestoreService.updateDocument('games', gameId, { 
            status: 'teamProposal', 
            currentTO_id: firstTO,
            currentStoryNum: 1,
            roles: roles, // Store assigned roles
            gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: "Game started by host." }]
        }, true);
    }

    async addAIPlayers(gameId: string, numAI: number): Promise<void> {
        console.log('Received gameId:', gameId);
        if (!gameId || typeof gameId !== 'string') {
            throw new Error("Invalid game ID provided for adding AI players.");
        }
        const game = await this.firestoreService.getDocument<Game>('games', gameId, true);
        if (!game) throw new Error("Game not found.");

        const currentPlayers = Object.keys(game.players).length;
        if (currentPlayers + numAI > game.settings.maxPlayers) {
            throw new Error(`Cannot add ${numAI} AI players. Game only needs ${game.settings.maxPlayers - currentPlayers} more players.`);
        }

        const updatedPlayers = { ...game.players };
        const updatedPlayerOrder = [...game.playerOrder];

        for (let i = 1; i <= numAI; i++) {
            const aiPlayerId = `${gameId}-AI-${Date.now()}-${i}`; // Simple unique ID
            updatedPlayers[aiPlayerId] = { id: aiPlayerId, name: `AI Player ${currentPlayers + i}`, isHost: false };
            updatedPlayerOrder.push(aiPlayerId);
        }
        await this.firestoreService.updateDocument('games', gameId, { players: updatedPlayers, playerOrder: updatedPlayerOrder }, true);
    }

    private assignRoles(playerIds: string[]): { [playerId: string]: string } {
        // This is a placeholder. Implement actual role assignment based on player count
        // from "manual (1).pdf". E.g., 5 players: 3 Dexter (1 Duke), 2 Sinister (1 Sniper).
        const numPlayers = playerIds.length;
        const assignedRoles: { [playerId: string]: string } = {};
        let rolesToAssign: string[] = [];
        let numLoyalDexter = 0;
        let numSinisterSpy = 0;

        // Determine number of Loyal Dexters and Sinister Spies based on total players
        // (This is a common distribution pattern, adjust based on actual game rules)
        if (numPlayers >= 5 && numPlayers <= 6) {
            numLoyalDexter = 3;
            numSinisterSpy = numPlayers - numLoyalDexter;
        } else if (numPlayers >= 7 && numPlayers <= 8) {
            numLoyalDexter = 4;
            numSinisterSpy = numPlayers - numLoyalDexter;
        } else if (numPlayers >= 9 && numPlayers <= 10) {
            numLoyalDexter = 5;
            numSinisterSpy = numPlayers - numLoyalDexter;
        } else if (numPlayers >= 11 && numPlayers <= 12) {
            numLoyalDexter = 6;
            numSinisterSpy = numPlayers - numLoyalDexter;
        }
        
        // Ensure at least one Duke, one Sniper, one Sinister Spy
        // (Duke is one of the Loyal Dexters, Sniper is one of the Sinister Spies)
        rolesToAssign.push('Duke'); // One Duke from Loyal Dexters
        for (let i = 0; i < numLoyalDexter - 1; i++) {
            rolesToAssign.push('LoyalDexter');
        }

        rolesToAssign.push('Sniper'); // One Sniper from Sinister Spies
        for (let i = 0; i < numSinisterSpy - 1; i++) {
            rolesToAssign.push('SinisterSpy');
        }

        // Shuffle roles and assign
        rolesToAssign.sort(() => Math.random() - 0.5); 
        
        playerIds.forEach((id, index) => {
            assignedRoles[id] = rolesToAssign[index];
        });
        console.log("Assigned roles:", assignedRoles);
        return assignedRoles;
    }

    async proposeTeam(team: Player[]): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // 1. Check if the current user is the current Team Leader (TO).
        if (game.currentTO_id !== currentUserId) {
            throw new Error("Only the current Team Leader can propose a team.");
        }

        // 2. Check if the number of proposed players is correct for the current story.
        const requiredTeamSize = this.getRequiredTeamSize(Object.keys(game.players).length, game.currentStoryNum ?? 1);
        if (team.length !== requiredTeamSize) {
            throw new Error(`Incorrect team size. Story ${game.currentStoryNum} requires a team of ${requiredTeamSize} players.`);
        }

        // 3. Update the game document in Firestore with the proposed team.
        const teamPlayerIds = team.map(p => p.id);
        const gameLogEntry = {
            timestamp: new Date(),
            message: `${game.players[currentUserId]?.name || 'Team Leader'} proposed a team of ${team.length} for story ${game.currentStoryNum}.`
        };

        await this.firestoreService.updateDocument('games', gameId, {
            currentTeam: teamPlayerIds,
            status: 'teamVote',
            gameLog: [...(game.gameLog || []), gameLogEntry]
        }, true);
    }

    // Helper method to determine required team size based on player count and story number
    private getRequiredTeamSize(numPlayers: number, storyNum: number): number {
        // These numbers are based on "The Sprint" manual's player count vs team size table.
        // Adjust if using different rules or game variants.
        if (numPlayers < 5 || numPlayers > 12) {
            throw new Error("Invalid number of players for team size calculation.");
        }

        const teamSizes: { [key: number]: number[] } = {
            5: [2, 3, 2, 3, 3], // Stories 1-5
            6: [2, 3, 4, 3, 4],
            7: [2, 3, 3, 4, 4], // Usually 4 for story 4 here in some variants, check manual
            8: [3, 4, 4, 5, 5], // Check manual for exact numbers
            9: [3, 4, 4, 5, 5], // Check manual for exact numbers
            10: [3, 4, 4, 5, 5], // Check manual for exact numbers
            11: [3, 4, 5, 5, 5], // Check manual for exact numbers
            12: [3, 4, 4, 5, 5], // Check manual for exact numbers
        };

        // Story numbers are 1-indexed, array indices are 0-indexed
        if (storyNum < 1 || storyNum > 5 || !teamSizes[numPlayers]) {
            throw new Error(`Invalid story number (${storyNum}) or player count (${numPlayers}).`);
        }
        return teamSizes[numPlayers][storyNum - 1];
    }

    async aiProposeTeam(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game) {
            return; // No active game
        }

        const currentUserId = game.currentTO_id;
        const currentPlayer = game.players[currentUserId!];

        // Check if the current player is an AI and is the current TO
        // You'll need a way to identify AI players (e.g., based on their ID format)
        const isAI = currentUserId!.startsWith(gameId + '-AI-'); // Example AI ID check
        if (!isAI || game.currentTO_id !== currentUserId) {
            return; // Not an AI TO
        }

        // Randomly select the correct number of players for the current story
        const requiredTeamSize = this.getRequiredTeamSize(Object.keys(game.players).length, game.currentStoryNum ?? 1);
        const allPlayers = Object.values(game.players);
        const shuffledPlayers = allPlayers.sort(() => 0.5 - Math.random()); // Shuffle players
        const proposedTeam = shuffledPlayers.slice(0, requiredTeamSize); // Select the first 'requiredTeamSize' players

        // Call the proposeTeam() method with the randomly selected team
        await this.proposeTeam(proposedTeam);
    }
}