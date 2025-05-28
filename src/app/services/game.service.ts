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
        if (Object.keys(game.players).length < 5) { // Example minimum players
            throw new Error("Not enough players to start (min 5).");
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
            gameLog: [...(game.gameLog || []), { timestamp: serverTimestamp(), message: "Game started by host." }]
        }, true);
    }

    private assignRoles(playerIds: string[]): { [playerId: string]: string } {
        // This is a placeholder. Implement actual role assignment based on player count
        // from "manual (1).pdf". E.g., 5 players: 3 Dexter (1 Duke), 2 Sinister (1 Sniper).
        const numPlayers = playerIds.length;
        const assignedRoles: { [playerId: string]: string } = {};
        let rolesToAssign: string[] = [];

        // Example for 5 players (adjust based on manual)
        if (numPlayers === 5) {
            rolesToAssign = ['Duke', 'LoyalDexter', 'LoyalDexter', 'Sniper', 'SinisterSpy'];
        } else if (numPlayers === 7) {
            rolesToAssign = ['Duke', 'LoyalDexter', 'LoyalDexter', 'LoyalDexter', 'Sniper', 'SinisterSpy', 'SinisterSpy'];
        } else { // Default for other counts (needs proper logic)
             rolesToAssign = playerIds.map((_, i) => i < Math.ceil(numPlayers * 0.6) ? 'LoyalDexter' : 'SinisterSpy');
             if (rolesToAssign.includes('LoyalDexter')) rolesToAssign[0] = 'Duke'; // Ensure Duke
             if (rolesToAssign.includes('SinisterSpy')) rolesToAssign[rolesToAssign.length-1] = 'Sniper'; // Ensure Sniper
        }
        
        // Shuffle roles and assign
        rolesToAssign.sort(() => Math.random() - 0.5); 
        playerIds.forEach((id, index) => {
            assignedRoles[id] = rolesToAssign[index];
        });
        console.log("Assigned roles:", assignedRoles);
        return assignedRoles;
    }
    
    // TODO: Add methods for game actions: proposeTeam, submitTeamVote, playMissionCard, snipeDuke, etc.
    // These methods will update the game document in Firestore.
}