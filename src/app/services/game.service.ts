import { signal, WritableSignal, effect, inject, Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { serverTimestamp, Unsubscribe, Timestamp, where } from 'firebase/firestore';
import { MANAGEMENT_CARDS } from '../interfaces/management-card.interface';
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

                        const currentUserId = this.authService.userId(); // Get current user ID inside the listener
                        const game = gameData; // Use the updated game data

                        // Check if the current TO is an AI
                        const currentTOId = game?.currentTO_id;
                        const isCurrentTOAnAI = currentTOId && gameId && currentTOId.startsWith(gameId + '-AI-'); // Check if the gameId is part of the AI ID

                        console.log("AI Team Proposal Check:", {
                            isCurrentTOAnAI,
                            currentTOId,
                            gameStatus: game?.status,
                            hasTeamVote: !!game?.teamVote,
                            currentUserId
                        });

                        if (game && currentTOId && isCurrentTOAnAI && game.status === 'teamProposal' && !game.teamVote) {
                            console.log("AI will propose a team now");
                            this.aiProposeTeam();
                        }

                        // Check if the current TO is an AI and the game is in the shiftingPriorities phase
                        if (game && currentTOId && isCurrentTOAnAI && game.status === 'shiftingPriorities') {
                            console.log("AI will select a team for Shifting Priorities");
                            this.aiSubmitShiftingPrioritiesTeam();
                        }

                        // Check if any AI players need to play mission cards
                        if (game && gameId && game.status === 'mission' && game.mission?.team) {
                            // Find all AI players on the mission team who haven't played a card yet
                            const aiPlayersOnMission = game.mission.team.filter(playerId =>
                                playerId.startsWith(gameId + '-AI-') && !game.mission?.cardsPlayed?.[playerId]
                            );

                            // If there are AI players who need to play cards, handle all cards in a single update
                            if (aiPlayersOnMission.length > 0) {
                                console.log("Game listener: Triggering AI mission cards for", aiPlayersOnMission);
                                // Use setTimeout to avoid blocking the listener and to ensure this runs after any other state updates
                                setTimeout(async () => {
                                    await this.submitAllAIMissionCards(aiPlayersOnMission);

                                    // After AI players have submitted their cards, check if all cards have been played
                                    // This is a safety check in case the game state wasn't updated properly
                                    const currentGame = this.currentGame();
                                    if (currentGame && currentGame.status === 'mission' && currentGame.mission?.team) {
                                        const allCardsPlayed = currentGame.mission.team.every(playerId =>
                                            currentGame.mission?.cardsPlayed?.[playerId]
                                        );

                                        if (allCardsPlayed) {
                                            console.log("Game listener: All cards played, checking if game state needs to be updated");
                                            // Create a copy of the game with the updated cards played
                                            const updatedGame = { ...currentGame };
                                            await this.checkIfAllCardsPlayed(updatedGame, currentGame.mission.cardsPlayed || {});
                                        }
                                    }
                                }, 500);
                            }
                        }

                        // Check if any AI players need to vote
                        if (game && gameId && game.status === 'teamVoting') {
                            // Find all AI players who haven't voted yet
                            const aiPlayers = game.playerOrder.filter(playerId =>
                                playerId.startsWith(gameId + '-AI-') && !game.teamVote?.votes?.[playerId]
                            );

                            // If there are AI players who need to vote, handle all votes in a single update
                            if (aiPlayers.length > 0) {
                                this.submitAllAIVotes(aiPlayers);
                            }
                        }
                    },
                    true
                );
            } else {
                this.currentGame.set(null);
            }
        });
    }

    async createGame(
        gameName: string,
        maxPlayers: number,
        isPublic: boolean,
        optionalRoles?: {
            includeDuke: boolean,
            includeSupportManager: boolean,
            includeNerlin: boolean,
            includeDevSlayer: boolean,
            includeSniper: boolean
        }
    ): Promise<string> {
        const currentUser = this.authService.currentUser();
        const currentUserId = this.authService.userId();

        if (!currentUser || !currentUserId) throw new Error("User not authenticated to create game.");

        const hostPlayer: Player = {
          id: currentUserId,
          name: currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : 'Host Player'),
          isHost: true,
          managementCard: null
        };

        // Default optional roles if not provided
        const defaultOptionalRoles = {
            includeDuke: true, // Duke is included by default
            includeSupportManager: false,
            includeNerlin: false,
            includeDevSlayer: false,
            includeSniper: true
        };

        const gameData: Omit<Game, 'id' | 'createdAt' | 'updatedAt'> = { // Firestore service adds timestamps
            name: gameName || `Sprint Game by ${hostPlayer.name}`,
            hostId: currentUserId,
            hostName: hostPlayer.name,
            status: 'lobby',
            players: { [currentUserId]: hostPlayer },
            playerOrder: [currentUserId],
            settings: {
                maxPlayers,
                isPublic,
                optionalRoles: optionalRoles || defaultOptionalRoles
            },
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
          name: currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : `Player ${Object.keys(game.players).length + 1}`),
          managementCard: null
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

    async updateGameSettings(optionalRoles: { includeDuke: boolean, includeSupportManager: boolean, includeNerlin: boolean, includeDevSlayer: boolean, includeSniper: boolean }): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || game.hostId !== currentUserId) {
            throw new Error("Only the host can update game settings.");
        }
        if (game.status !== 'lobby') {
            throw new Error("Game settings can only be updated in the lobby.");
        }

        await this.firestoreService.updateDocument('games', gameId, {
            settings: {
                ...game.settings,
                optionalRoles
            }
        }, true);
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

        // Assign roles based on game settings and player count
        const roles = this.assignRoles(game.playerOrder, game);

        // Initialize the management deck
        const managementDeck = this.initializeManagementDeck();

        // Randomly select a player to be the first TO
        const randomIndex = Math.floor(Math.random() * game.playerOrder.length);
        const firstTO = game.playerOrder[randomIndex];

        await this.firestoreService.updateDocument('games', gameId, {
            status: 'teamProposal',
            currentTO_id: firstTO,
            currentStoryNum: 1,
            roles: roles, // Store assigned roles
            managementDeck: managementDeck, // Store the management deck
            gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: "Game started by host." }]
        }, true);
    }

    private initializeManagementDeck(): string[] {
        // Create the management deck with 8 cards
        // 2 PO - Shifting Priorities, 2 HR - People Person cards, 2 TL - Preliminary Review cards,
        // 1 CMO - Scope Creep! card, and 1 VP R&D - Service Reassignment! card
        const managementDeck = [
            'po', 'po', // 2 PO cards (Shifting Priorities)
            'hr', 'hr', // 2 HR cards (People Person)
            'tl', 'tl', // 2 TL cards (Preliminary Review)
            'cmo',      // 1 CMO card (Scope Creep!)
            'joe'       // 1 VP R&D card (Service Reassignment!)
        ];

        // Shuffle the deck
        return this.shuffleArray(managementDeck);
    }

    private shuffleArray<T>(array: T[]): T[] {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
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
            updatedPlayers[aiPlayerId] = {
              managementCard: null,
              id: aiPlayerId, name: `AI Player ${currentPlayers + i}`, isHost: false };
            updatedPlayerOrder.push(aiPlayerId);
        }
        await this.firestoreService.updateDocument('games', gameId, { players: updatedPlayers, playerOrder: updatedPlayerOrder }, true);
    }

    private assignRoles(playerIds: string[], game: Game): { [playerId: string]: string } {
        const numPlayers = playerIds.length;
        const assignedRoles: { [playerId: string]: string } = {};
        let rolesToAssign: string[] = [];
        let dexterRoles: string[] = [];
        let sinisterRoles: string[] = [];
        let numLoyalDexter = 0;
        let numSinisterSpy = 0;

        // Get optional roles settings
        const optionalRoles = game.settings.optionalRoles || {
            includeDuke: true,
            includeSupportManager: false,
            includeNerlin: false,
            includeDevSlayer: false,
            includeSniper: false
        };

        // Determine number of Loyal Dexters and Sinister Spies based on total players
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

        // Add optional roles based on settings
        // For Dexter team
        if (optionalRoles.includeDuke) {
            dexterRoles.push('Duke');
            numLoyalDexter--;
        }

        if (optionalRoles.includeSupportManager) {
            dexterRoles.push('SupportManager');
            numLoyalDexter--;
        }

        // Fill remaining Dexter slots with Loyal Dexter
        for (let i = 0; i < numLoyalDexter; i++) {
            dexterRoles.push('LoyalDexter');
        }

        // For Sinister team
        if (optionalRoles.includeSniper) {
            sinisterRoles.push('Sniper');
            numSinisterSpy--;
        }

        if (optionalRoles.includeNerlin) {
            sinisterRoles.push('Nerlin');
            numSinisterSpy--;
        }

        if (optionalRoles.includeDevSlayer) {
            sinisterRoles.push('DevSlayer');
            numSinisterSpy--;
        }

        // Special rule: If Sniper, Dev Slayer, and Nerlin are all included and there are only 3 sinister slots,
        // then don't add any SinisterSpy
        if (optionalRoles.includeSniper && optionalRoles.includeDevSlayer && optionalRoles.includeNerlin &&
            sinisterRoles.length >= 3 && numSinisterSpy <= 0) {
            numSinisterSpy = 0;
        }

        // Fill remaining Sinister slots with Sinister Spy
        for (let i = 0; i < numSinisterSpy; i++) {
            sinisterRoles.push('SinisterSpy');
        }

        // Combine all roles
        rolesToAssign = [...dexterRoles, ...sinisterRoles];

        // Ensure we have enough roles for all players
        if (rolesToAssign.length < numPlayers) {
            const additionalRoles = numPlayers - rolesToAssign.length;
            // Add additional roles based on team balance
            if (dexterRoles.length <= sinisterRoles.length) {
                // Add more Dexter roles
                for (let i = 0; i < additionalRoles; i++) {
                    rolesToAssign.push('LoyalDexter');
                }
            } else {
                // Add more Sinister roles
                for (let i = 0; i < additionalRoles; i++) {
                    rolesToAssign.push('SinisterSpy');
                }
            }
        }

        // Shuffle roles and assign
        rolesToAssign.sort(() => Math.random() - 0.5);

        playerIds.forEach((id, index) => {
            if (index < rolesToAssign.length) {
                assignedRoles[id] = rolesToAssign[index];
            } else {
                // Fallback in case we somehow don't have enough roles
                assignedRoles[id] = 'LoyalDexter';
            }
        });

        console.log("Assigned roles:", assignedRoles);
        return assignedRoles;
    }

    async submitShiftingPrioritiesTeam(teamPlayerIds: string[], overrideUserId?: string): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = overrideUserId || this.authService.userId();

        console.log("submitShiftingPrioritiesTeam called with", { teamPlayerIds, currentUserId, overrideUserId });

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // 1. Check if the current user is the current Team Leader (TO).
        if (game.currentTO_id !== currentUserId) {
            console.error("submitShiftingPrioritiesTeam: User is not the current TO", { currentUserId, currentTO_id: game.currentTO_id });
            throw new Error("Only the current Team Leader can select the team.");
        }

        // 2. Check if the number of selected players is correct for the current story.
        const requiredTeamSize = game.teamProposal?.numToSelect || 0;
        if (teamPlayerIds.length !== requiredTeamSize) {
            throw new Error(`Incorrect team size. Story ${game.currentStoryNum} requires a team of ${requiredTeamSize} players.`);
        }

        // 3. Check if the original team is included in the selected team
        const originalTeam = game.teamProposal?.selectedPlayers || [];
        const missingOriginalPlayers = originalTeam.filter(playerId => !teamPlayerIds.includes(playerId));

        if (missingOriginalPlayers.length > 0) {
            const missingPlayerNames = missingOriginalPlayers.map(id => game.players[id]?.name || 'Unknown').join(', ');
            throw new Error(`The selected team must include all players from the original team. Missing: ${missingPlayerNames}`);
        }

        // Update the game state to transition to the mission phase
        await this.firestoreService.updateDocument('games', gameId, {
            status: 'mission',
            mission: {
                team: teamPlayerIds,
                cardsPlayed: {}
            },
            gameLog: [...(game.gameLog || []), {
                timestamp: new Date(),
                message: `${game.players[currentUserId]?.name || 'Team Leader'} selected a team of ${teamPlayerIds.length} for story ${game.currentStoryNum} after Shifting Priorities was played.`
            }]
        }, true);
    }

    // Function to submit the additional team member for Scope Creep
    async submitScopeCreepTeam(additionalPlayerId: string, overrideUserId?: string): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = overrideUserId || this.authService.userId();

        console.log("submitScopeCreepTeam called with", { additionalPlayerId, currentUserId, overrideUserId });

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // Check if we're in the scopeCreep phase
        if (game.status !== 'scopeCreep') {
            console.error("submitScopeCreepTeam: Not in the Scope Creep phase", { status: game.status });
            throw new Error("Not in the Scope Creep phase.");
        }

        // Check if the current user is the one who played the Scope Creep card
        if (game.scopeCreepPlayerId !== currentUserId) {
            console.error("submitScopeCreepTeam: User is not the Scope Creep player", { currentUserId, scopeCreepPlayerId: game.scopeCreepPlayerId });
            throw new Error("Only the player who played the Scope Creep card can select an additional team member.");
        }

        // Check if the selected player exists in the game
        if (!game.players[additionalPlayerId]) {
            throw new Error(`Player ${additionalPlayerId} does not exist in the game.`);
        }

        // Get the current mission team
        const currentMissionTeam = game.mission?.team || [];

        // Check if the selected player is already on the team
        if (currentMissionTeam.includes(additionalPlayerId)) {
            throw new Error("The selected player is already on the team.");
        }

        // Add the additional player to the mission team
        const updatedTeam = [...currentMissionTeam, additionalPlayerId];

        // Get the previous status to return to
        const previousStatus = game.previousStatus || 'mission';

        // Update the game with the new team
        await this.firestoreService.updateDocument('games', gameId, {
            status: previousStatus,
            mission: {
                ...game.mission,
                team: updatedTeam
            },
            scopeCreepPlayerId: null, // Clear the Scope Creep player ID
            previousStatus: null, // Clear the previous status
            gameLog: [...(game.gameLog || []), {
                timestamp: new Date(),
                message: `${game.players[currentUserId]?.name} added ${game.players[additionalPlayerId]?.name} to the team using the Scope Creep card.`
            }]
        }, true);
    }

    // Function to submit the team for the It's Show Time! card
    async submitItsShowTimeTeam(additionalPlayerIds: string[], overrideUserId?: string): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = overrideUserId || this.authService.userId();

        console.log("submitItsShowTimeTeam called with", { additionalPlayerIds, currentUserId, overrideUserId });

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // Check if we're in the itsShowTime phase
        if (game.status !== 'itsShowTime') {
            console.error("submitItsShowTimeTeam: Not in the It's Show Time! phase", { status: game.status });
            throw new Error("Not in the It's Show Time! phase.");
        }

        // Check if the current user is the one who played the It's Show Time! card
        if (game.itsShowTimePlayerId !== currentUserId) {
            console.error("submitItsShowTimeTeam: User is not the It's Show Time! player", { currentUserId, itsShowTimePlayerId: game.itsShowTimePlayerId });
            throw new Error("Only the player who played the It's Show Time! card can select additional team members.");
        }

        // Check if the correct number of players are being added
        if (additionalPlayerIds.length > 2) {
            throw new Error("You can only add up to 2 players to the team.");
        }

        // Get the current mission team
        const currentMissionTeam = game.mission?.team || [];

        // Check if any of the additional players are already on the team
        for (const playerId of additionalPlayerIds) {
            // Check if the selected player exists in the game
            if (!game.players[playerId]) {
                throw new Error(`Player ${playerId} does not exist in the game.`);
            }

            if (currentMissionTeam.includes(playerId)) {
                throw new Error(`${game.players[playerId].name} is already on the team.`);
            }
        }

        // Add the additional players to the team
        const updatedTeam = [...currentMissionTeam, ...additionalPlayerIds];

        // Add a log entry
        const playerNames = additionalPlayerIds.map(id => game.players[id].name).join(' and ');
        const logMessage = additionalPlayerIds.length > 0
            ? `${game.players[currentUserId].name} added ${playerNames} to the team for story ${game.currentStoryNum}.`
            : `${game.players[currentUserId].name} did not add any players to the team for story ${game.currentStoryNum}.`;

        // Update the game with the new team
        await this.firestoreService.updateDocument('games', gameId, {
            mission: {
                ...game.mission,
                team: updatedTeam
            },
            itsShowTimePlayersToAdd: additionalPlayerIds,
            gameLog: [...(game.gameLog || []), {
                timestamp: new Date(),
                message: logMessage
            }]
        }, true);

        // Process the shuffling and revealing of cards
        await this.processItsShowTimeResults(gameId, {
          ...game,
          mission: {
            ...game.mission,
            cardsPlayed: game.mission!.cardsPlayed,
            team: updatedTeam
          }
        });
    }

    async proposeTeam(team: Player[], overrideUserId?: string, managementDesignatedPlayerId?: string): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = overrideUserId || this.authService.userId();

        console.log("proposeTeam called with", { team, overrideUserId, currentUserId, managementDesignatedPlayerId });

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // 1. Check if the current user is the current Team Leader (TO).
        if (game.currentTO_id !== currentUserId) {
            console.error("proposeTeam: User is not the current TO", { currentUserId, currentTO_id: game.currentTO_id });
            throw new Error("Only the current Team Leader can propose a team.");
        }

        // 2. Check if the number of proposed players is correct for the current story.
        let currentStory = game.currentStoryNum ?? 1;
        const addExtraMember = game.rushJobTechDebtNextStoryAdditionalMember && currentStory === game.rushJobTechDebtNextStory;
        const requiredTeamSize = this.getRequiredTeamSize(Object.keys(game.players).length, currentStory, addExtraMember);
        if (team.length !== requiredTeamSize) {
            throw new Error(`Incorrect team size. Story ${game.currentStoryNum} requires a team of ${requiredTeamSize} players.`);
        }

        // 3. Check if the designated management player is valid (not on the team and exists)
        const teamPlayerIds = team.map(p => p.id);
        let designatedPlayerId = managementDesignatedPlayerId;

        if (designatedPlayerId) {
            // Ensure the designated player exists and is not on the team
            if (!game.players[designatedPlayerId]) {
                throw new Error("Designated management player does not exist.");
            }
            if (teamPlayerIds.includes(designatedPlayerId)) {
                throw new Error("Designated management player cannot be on the team.");
            }
        }

        // Only allow management designation for stories 1-4
        currentStory = game.currentStoryNum || 1;
        if (currentStory <= 4) {
            // If no player was designated, we'll set proposedManagementDesignatedPlayer to null
            // This allows the UI to know that the TO didn't select anyone
            const updateData: any = {
                teamVote: { proposedTeam: teamPlayerIds, votes: {} },
                status: 'teamVoting',
                proposedManagementDesignatedPlayer: designatedPlayerId || null,
                gameLog: [...(game.gameLog || []), {
                    timestamp: new Date(),
                    message: `${game.players[currentUserId]?.name || 'Team Leader'} proposed a team of ${team.length} for story ${game.currentStoryNum}.`
                }]
            };

            // If a player was designated, add a log entry
            if (designatedPlayerId) {
                updateData.gameLog.push({
                    timestamp: new Date(),
                    message: `${game.players[currentUserId]?.name || 'Team Leader'} designated ${game.players[designatedPlayerId]?.name || 'Unknown'} to receive a management card.`
                });
            }

            await this.firestoreService.updateDocument('games', gameId, updateData, true);
        } else {
            // For story 5 and beyond, don't allow management designation
            await this.firestoreService.updateDocument('games', gameId, {
                teamVote: { proposedTeam: teamPlayerIds, votes: {} },
                status: 'teamVoting',
                gameLog: [...(game.gameLog || []), {
                    timestamp: new Date(),
                    message: `${game.players[currentUserId]?.name || 'Team Leader'} proposed a team of ${team.length} for story ${game.currentStoryNum}.`
                }]
            }, true);
        }
    }

    // Helper method to determine required team size based on player count and story number
    private getRequiredTeamSize(numPlayers: number, storyNum: number, addExtraMember: boolean = false): number {
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

        // Get the base team size
        let teamSize = teamSizes[numPlayers][storyNum - 1];

        // Add an extra member if requested (e.g., due to Rush Job, Tech Debt! card)
        if (addExtraMember) {
            teamSize += 1;
            console.log(`getRequiredTeamSize: Adding an extra team member for story ${storyNum}. New team size: ${teamSize}`);
        }

        return teamSize;
    }

    async aiProposeTeam(): Promise<void> {
        console.log("aiProposeTeam called");
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game) {
            console.log("aiProposeTeam: No active game");
            return; // No active game
        }

        const currentUserId = game.currentTO_id;
        const currentPlayer = game.players[currentUserId!];
        console.log("aiProposeTeam: Current TO", { currentUserId, currentPlayer });

        // Check if the current player is an AI and is the current TO
        // You'll need a way to identify AI players (e.g., based on their ID format)
        const isAI = currentUserId!.startsWith(gameId + '-AI-'); // Example AI ID check
        if (!isAI || game.currentTO_id !== currentUserId) {
            console.log("aiProposeTeam: Not an AI TO", { isAI, currentTO_id: game.currentTO_id, currentUserId });
            return; // Not an AI TO
        }

        // Randomly select the correct number of players for the current story
        let currentStory = game.currentStoryNum ?? 1;
        const addExtraMember = game.rushJobTechDebtNextStoryAdditionalMember && currentStory === game.rushJobTechDebtNextStory;
        const requiredTeamSize = this.getRequiredTeamSize(Object.keys(game.players).length, currentStory, addExtraMember);
        const allPlayers = Object.values(game.players);
        const shuffledPlayers = allPlayers.sort(() => 0.5 - Math.random()); // Shuffle players
        const proposedTeam = shuffledPlayers.slice(0, requiredTeamSize); // Select the first 'requiredTeamSize' players
        console.log("aiProposeTeam: Selected team", { requiredTeamSize, proposedTeam });

        // Randomly select a player for management designation (only for stories 1-4)
        let managementDesignatedPlayerId: string | undefined = undefined;
        currentStory = game.currentStoryNum || 1;

        if (currentStory <= 4) {
            // Get all players who are not on the proposed team
            const proposedTeamIds = proposedTeam.map(p => p.id);
            const eligiblePlayers = allPlayers.filter(p => !proposedTeamIds.includes(p.id));

            if (eligiblePlayers.length > 0) {
                // Randomly select one player from the eligible players
                const randomIndex = Math.floor(Math.random() * eligiblePlayers.length);
                managementDesignatedPlayerId = eligiblePlayers[randomIndex].id;
                console.log("aiProposeTeam: Selected management player", { managementDesignatedPlayerId });
            }
        }

        try {
            // Call the proposeTeam() method with the randomly selected team, the AI's user ID, and the management designated player
            await this.proposeTeam(proposedTeam, currentUserId, managementDesignatedPlayerId);
            console.log("aiProposeTeam: Team proposed successfully");
        } catch (error) {
            console.error("aiProposeTeam: Error proposing team", error);
        }
    }

    async aiSubmitShiftingPrioritiesTeam(): Promise<void> {
        console.log("aiSubmitShiftingPrioritiesTeam called");
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game) {
            console.log("aiSubmitShiftingPrioritiesTeam: No active game");
            return; // No active game
        }

        const currentUserId = game.currentTO_id;
        const currentPlayer = game.players[currentUserId!];
        console.log("aiSubmitShiftingPrioritiesTeam: Current TO", { currentUserId, currentPlayer });

        // Check if the current player is an AI and is the current TO
        const isAI = currentUserId!.startsWith(gameId + '-AI-');
        if (!isAI || game.currentTO_id !== currentUserId) {
            console.log("aiSubmitShiftingPrioritiesTeam: Not an AI TO", { isAI, currentTO_id: game.currentTO_id, currentUserId });
            return; // Not an AI TO
        }

        // Get the required team size from the game.teamProposal.numToSelect
        const requiredTeamSize = game.teamProposal?.numToSelect || 0;
        if (requiredTeamSize === 0) {
            console.log("aiSubmitShiftingPrioritiesTeam: Invalid team size requirement");
            return; // Invalid team size requirement
        }

        // Get the original team that must be kept
        const originalTeam = game.teamProposal?.selectedPlayers || [];
        console.log("aiSubmitShiftingPrioritiesTeam: Original team", { originalTeam });

        // Calculate how many players we need to add
        const playersToAdd = requiredTeamSize - originalTeam.length;

        if (playersToAdd <= 0) {
            console.log("aiSubmitShiftingPrioritiesTeam: No need to add players, team already at required size");
            return; // No need to add players
        }

        // Find players who are not already on the team
        const allPlayerIds = Object.keys(game.players);
        const eligiblePlayers = allPlayerIds.filter(playerId => !originalTeam.includes(playerId));

        if (eligiblePlayers.length < playersToAdd) {
            console.log("aiSubmitShiftingPrioritiesTeam: Not enough eligible players to add to the team");
            return; // Not enough eligible players
        }

        // Randomly select the required number of players from the eligible players
        const shuffledEligiblePlayers = [...eligiblePlayers].sort(() => 0.5 - Math.random());
        const selectedNewPlayers = shuffledEligiblePlayers.slice(0, playersToAdd);

        // Create the new team by adding the selected players to the original team
        const selectedTeamIds = [...originalTeam, ...selectedNewPlayers];
        console.log("aiSubmitShiftingPrioritiesTeam: Selected team", {
            requiredTeamSize,
            originalTeam,
            selectedNewPlayers,
            selectedTeamIds
        });

        try {
            // Call the submitShiftingPrioritiesTeam() method with the selected team IDs and the AI's user ID
            await this.submitShiftingPrioritiesTeam(selectedTeamIds, currentUserId);
            console.log("aiSubmitShiftingPrioritiesTeam: Team submitted successfully");
        } catch (error) {
            console.error("aiSubmitShiftingPrioritiesTeam: Error submitting team", error);
        }
    }

    async submitVote(vote: 'agree' | 'rethrow'): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // 1. Check if the current game status is 'teamVote'.
        if (game.status !== 'teamVoting') {
            throw new Error("Voting is not currently open.");
        }

        // 2. Record the current user's vote.
        const updatedVotes = {
            ...(game.teamVote?.votes || {}),
            [currentUserId]: vote
        };

        await this.firestoreService.updateDocument('games', gameId, {
            teamVote: {
                ...game.teamVote,
                votes: updatedVotes
            }
        }, true);

        // 4. After recording the vote, check if all players have voted.
        const playerIds = game.playerOrder || [];
        const allVoted = playerIds.every(playerId => updatedVotes.hasOwnProperty(playerId));

        // 5. If all players have voted, process the votes.
        if (allVoted) {
            const voteCounts = Object.values(updatedVotes).reduce((acc, currentVote) => {
                acc[currentVote] = (acc[currentVote] || 0) + 1;
                return acc;
            }, { agree: 0, rethrow: 0 });

            let nextStatus: Game['status'];
            let nextTOId = game.currentTO_id;
            let nextVoteFails = game.voteFailsThisRound ?? 0;
            let additionalLogMessage = '';

            // 5b. If 'agree' votes are more than 'rethrow' votes.
            if (voteCounts.agree > voteCounts.rethrow) {
                nextStatus = 'mission';
                additionalLogMessage = `Team approved with ${voteCounts.agree} agree votes and ${voteCounts.rethrow} rethrow votes. Starting mission.`;
                nextVoteFails = 0; // Reset vote fails on successful vote

                // Set the mission team to the proposed team that was just approved
                const missionTeam = game.teamVote?.proposedTeam || [];

                // Check if there's a proposed designated player for management card and if we're in stories 1-4
                const currentStory = game.currentStoryNum || 1;
                const hasDesignatedPlayer = !!game.proposedManagementDesignatedPlayer && currentStory <= 4;

                // If there's a proposed designated player, set the managementPhase flag and the actual designated player
                if (hasDesignatedPlayer) {
                    const designatedPlayerId = game.proposedManagementDesignatedPlayer!;
                    const isAI = designatedPlayerId.startsWith(gameId + '-AI-');

                    // If the designated player is an AI, proceed to mission phase
                    // If it's a human player, stay in the current phase until they draw a card
                    await this.firestoreService.updateDocument('games', gameId, {
                        mission: { team: missionTeam, cardsPlayed: {} },
                        status: isAI ? nextStatus : game.status, // Keep current status for human players
                        currentTO_id: nextTOId,
                        voteFailsThisRound: nextVoteFails,
                        managementPhase: true, // Set the management phase flag
                        managementDesignatedPlayer: designatedPlayerId, // Set the actual designated player
                        proposedManagementDesignatedPlayer: null, // Clear the proposed designated player
                        previousStatus: isAI ? null : nextStatus, // Store the next status for human players
                        gameLog: [
                            ...(game.gameLog || []),
                            { timestamp: new Date(), message: additionalLogMessage },
                            { timestamp: new Date(), message: `${game.players[designatedPlayerId]?.name || 'Designated player'} can now draw a management card.` }
                        ],
                        teamVote: null, // Clear the team vote data for the next round
                    }, true);

                    // Check if the designated player is an AI and trigger them to draw a card
                    if (isAI) {
                        setTimeout(async () => {
                            await this.aiDrawManagementCard();
                        }, 2000); // Increased to 2 seconds to ensure the UI has time to update
                    }
                } else {
                    await this.firestoreService.updateDocument('games', gameId, {
                        mission: { team: missionTeam, cardsPlayed: {} },
                        status: nextStatus,
                        currentTO_id: nextTOId,
                        voteFailsThisRound: nextVoteFails,
                        gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: additionalLogMessage }],
                        teamVote: null, // Clear the team vote data for the next round
                    }, true);
                }

                // Check if there are any AI players on the mission team and trigger them to submit their cards
                const aiPlayersOnMission = missionTeam.filter(playerId =>
                    playerId.startsWith(gameId + '-AI-')
                );

                if (aiPlayersOnMission.length > 0) {
                    console.log(`Triggering ${aiPlayersOnMission.length} AI players to submit mission cards`);
                    // Use setTimeout to ensure this runs after the game state update is processed
                    setTimeout(async () => {
                        await this.submitAllAIMissionCards(aiPlayersOnMission);

                        // Check if any AI players have management cards they can play
                        await this.aiPlayManagementCard();

                        // After AI players have submitted their cards, check if all cards have been played
                        // This is a safety check in case the game state wasn't updated properly
                        const currentGame = this.currentGame();
                        if (currentGame && currentGame.status === 'mission' && currentGame.mission?.team) {
                            const allCardsPlayed = currentGame.mission.team.every(playerId =>
                                currentGame.mission?.cardsPlayed?.[playerId]
                            );

                            if (allCardsPlayed) {
                                console.log("submitVote: All cards played, checking if game state needs to be updated");
                                // Create a copy of the game with the updated cards played
                                const updatedGame = { ...currentGame };
                                await this.checkIfAllCardsPlayed(updatedGame, currentGame.mission.cardsPlayed || {});
                            }
                        }
                    }, 500);

                    // If all players on the mission are AI players, add an additional safety check
                    if (aiPlayersOnMission.length === missionTeam.length) {
                        console.log("All players on mission are AI players, adding additional safety check");
                        // Add a longer timeout as an additional safety check
                        setTimeout(async () => {
                            const currentGame = this.currentGame();
                            if (currentGame && currentGame.status === 'mission') {
                                console.log("Safety check: Game still in mission state, forcing check for all cards played");

                                // If we're in management phase but all players are AI, force AI players to submit cards
                                if (currentGame.managementPhase || currentGame.managementCardPlayPhase) {
                                    console.log("Safety check: Game in management phase but all players are AI, forcing AI to submit cards");
                                    // Force AI players to submit their cards despite management phase
                                    await this.submitAllAIMissionCards(aiPlayersOnMission);
                                }

                                // Force a check for all cards played
                                if (currentGame.mission?.team && currentGame.mission?.cardsPlayed) {
                                    const updatedGame = { ...currentGame };
                                    await this.checkIfAllCardsPlayed(updatedGame, currentGame.mission.cardsPlayed);
                                }
                            }
                        }, 3000); // Longer timeout for safety
                    }
                }

                // Return early since we've already updated the game
                return;
            }
            // 5c. If 'rethrow' votes are more than or equal to 'agree' votes.
            else {
                nextVoteFails++;
                if (nextVoteFails >= 5) {
                    nextStatus = 'gameOver'; // Or a specific 'sinisterWins' status
                    additionalLogMessage = `Team rejected. This was the 5th failed vote. Sinister Spy wins!`;
                } else {
                    nextStatus = 'teamProposal';
                    const currentTOIndex = playerIds.indexOf(game.currentTO_id!);
                    const nextTOIndex = (currentTOIndex + 1) % playerIds.length;
                    nextTOId = playerIds[nextTOIndex];
                    additionalLogMessage = `Team rejected with ${voteCounts.rethrow} rethrow votes and ${voteCounts.agree} agree votes. ${game.players[nextTOId]?.name || 'Next Team Leader'} is now the Team Leader.`;

                    // Check if the current story is 1-4 (management cards can be drawn in these stories)
                    const currentStory = game.currentStoryNum || 1;
                    if (currentStory <= 4) {
                        // Designate the next Team Leader to receive a management card
                        const designatedPlayerId = nextTOId;
                        const isAI = designatedPlayerId.startsWith(gameId + '-AI-');

                        // Add a log message about drawing a management card
                        const managementCardMessage = `${game.players[designatedPlayerId]?.name || 'Designated player'} can now draw a management card.`;
                        additionalLogMessage += '\n' + managementCardMessage;

                        // Update the game state to include management phase information
                        await this.firestoreService.updateDocument('games', gameId, {
                            status: isAI ? nextStatus : game.status, // Keep current status for human players
                            currentTO_id: nextTOId,
                            voteFailsThisRound: nextVoteFails,
                            managementPhase: true, // Set the management phase flag
                            managementDesignatedPlayer: designatedPlayerId, // Designate the player
                            proposedManagementDesignatedPlayer: null, // Clear the proposed designated player
                            previousStatus: isAI ? null : nextStatus, // Store the next status for human players
                            gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: additionalLogMessage }],
                            teamVote: null, // Clear the team vote data for the next round
                        }, true);

                        // Check if the designated player is an AI and trigger them to draw a card
                        if (isAI) {
                            setTimeout(async () => {
                                await this.aiDrawManagementCard();
                            }, 2000); // Increased to 2 seconds to ensure the UI has time to update
                        }

                        // Return early since we've already updated the game
                        return;
                    }
                }
            }

            // Only update the game if we haven't already done so
            await this.firestoreService.updateDocument('games', gameId, {
                status: nextStatus,
                currentTO_id: nextTOId,
                voteFailsThisRound: nextVoteFails,
                gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: additionalLogMessage }],
                teamVote: null, // Clear the team vote data for the next round
            }, true);
        }
    }

    // New method to submit all AI votes in a single update
    async submitAllAIVotes(aiPlayerIds: string[]): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game || !game.teamVote) {
            return; // No active game or no team vote
        }

        // Collect votes for all AI players
        const votes: {[playerId: string]: 'agree' | 'rethrow'} = {};
        const gameLogEntries: {timestamp: Date, message: string}[] = [];

        for (const aiPlayerId of aiPlayerIds) {
            // Skip if player is not an AI or has already voted
            if (!aiPlayerId.startsWith(gameId + '-AI-') || game.teamVote?.votes?.[aiPlayerId]) {
                continue;
            }

            // Determine the vote based on AI role
            const aiRole = game.roles?.[aiPlayerId];
            let vote: 'agree' | 'rethrow';

            // Always agree on the 5th vote failure to prevent automatic Sinister win
            if ((game.voteFailsThisRound ?? 0) === 4) {
                vote = 'agree';
            }
            // Loyal Dexter and Duke should generally agree to proposed teams
            else if (aiRole === 'LoyalDexter' || aiRole === 'Duke') {
                // 80% chance to agree for Loyal Dexter roles
                vote = Math.random() < 0.8 ? 'agree' : 'rethrow';
            }
            // Sinister roles should be more likely to rethrow, especially if the team has few Sinister players
            else if (aiRole === 'SinisterSpy' || aiRole === 'Sniper') {
                // Check if the proposed team has Sinister players
                const proposedTeam = game.teamVote?.proposedTeam || [];
                const sinisterOnTeam = proposedTeam.filter(playerId => {
                    const playerRole = game.roles?.[playerId];
                    return playerRole === 'SinisterSpy' || playerRole === 'Sniper';
                }).length;

                // If no Sinister on team, high chance to rethrow
                if (sinisterOnTeam === 0) {
                    vote = Math.random() < 0.8 ? 'rethrow' : 'agree';
                }
                // If at least one Sinister on team, more likely to agree
                else {
                    vote = Math.random() < 0.6 ? 'agree' : 'rethrow';
                }
            }
            // Default random vote for unknown roles
            else {
                vote = Math.random() > 0.5 ? 'agree' : 'rethrow';
            }

            console.log(`AI ${aiPlayerId} (${aiRole}) voting: ${vote}`);

            // Add vote to the collection
            votes[aiPlayerId] = vote;

            // Add log entry
            gameLogEntries.push({
                timestamp: new Date(),
                message: `${game.players[aiPlayerId]?.name || 'AI Player'} voted to ${vote} the team.`
            });
        }

        // If no votes were collected, return
        if (Object.keys(votes).length === 0) {
            return;
        }

        // Combine with existing votes
        const updatedVotes = {
            ...(game.teamVote.votes || {}),
            ...votes
        };

        try {
            // Update Firebase with all votes in a single update
            await this.firestoreService.updateDocument('games', gameId, {
                teamVote: {
                    ...game.teamVote,
                    votes: updatedVotes
                },
                gameLog: [...(game.gameLog || []), ...gameLogEntries]
            }, true);

            console.log(`All AI votes recorded successfully`);

            // Check if all players have voted after this batch of AI votes
            this.checkIfAllVoted(game, updatedVotes);
        } catch (error) {
            console.error(`Error when submitting AI votes:`, error);
        }
    }

    // Keep for backward compatibility, but modify to use the batch method
    async aiSubmitVoteForPlayer(aiPlayerId: string): Promise<void> {
        this.submitAllAIVotes([aiPlayerId]);
    }

    // Helper method to check if all players have voted after an AI vote
    private async checkIfAllVoted(game: Game, updatedVotes: {[playerId: string]: 'agree' | 'rethrow'}): Promise<void> {
        const gameId = this.activeGameId();
        if (!gameId || !game) return;

        const playerIds = game.playerOrder || [];
        const allVoted = playerIds.every(playerId => updatedVotes.hasOwnProperty(playerId));

        // If all players have voted, process the votes
        if (allVoted) {
            const voteCounts = Object.values(updatedVotes).reduce((acc, currentVote) => {
                acc[currentVote] = (acc[currentVote] || 0) + 1;
                return acc;
            }, { agree: 0, rethrow: 0 } as {agree: number, rethrow: number});

            let nextStatus: Game['status'];
            let nextTOId = game.currentTO_id;
            let nextVoteFails = game.voteFailsThisRound ?? 0;
            let additionalLogMessage = '';

            // If 'agree' votes are more than 'rethrow' votes
            if (voteCounts.agree > voteCounts.rethrow) {
                nextStatus = 'mission';
                additionalLogMessage = `Team approved with ${voteCounts.agree} agree votes and ${voteCounts.rethrow} rethrow votes. Starting mission.`;
                nextVoteFails = 0; // Reset vote fails on successful vote

                // Set the mission team to the proposed team that was just approved
                const missionTeam = game.teamVote?.proposedTeam || [];

                // Check if there's a proposed designated player for management card and if we're in stories 1-4
                const currentStory = game.currentStoryNum || 1;
                const hasDesignatedPlayer = !!game.proposedManagementDesignatedPlayer && currentStory <= 4;

                // If there's a proposed designated player, set the managementPhase flag and the actual designated player
                if (hasDesignatedPlayer) {
                    const designatedPlayerId = game.proposedManagementDesignatedPlayer!;
                    await this.firestoreService.updateDocument('games', gameId, {
                        mission: { team: missionTeam, cardsPlayed: {} },
                        status: nextStatus,
                        currentTO_id: nextTOId,
                        voteFailsThisRound: nextVoteFails,
                        managementPhase: true, // Set the management phase flag
                        managementDesignatedPlayer: designatedPlayerId, // Set the actual designated player
                        proposedManagementDesignatedPlayer: null, // Clear the proposed designated player
                        gameLog: [
                            ...(game.gameLog || []),
                            { timestamp: new Date(), message: additionalLogMessage },
                            { timestamp: new Date(), message: `${game.players[designatedPlayerId]?.name || 'Designated player'} can now draw a management card.` }
                        ],
                        teamVote: null, // Clear the team vote data for the next round
                    }, true);

                    // Check if the designated player is an AI and trigger them to draw a card
                    setTimeout(async () => {
                        await this.aiDrawManagementCard();
                    }, 2000); // Increased to 2 seconds to ensure the UI has time to update
                } else {
                    await this.firestoreService.updateDocument('games', gameId, {
                        mission: { team: missionTeam, cardsPlayed: {} },
                        status: nextStatus,
                        currentTO_id: nextTOId,
                        voteFailsThisRound: nextVoteFails,
                        gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: additionalLogMessage }],
                        teamVote: null, // Clear the team vote data for the next round
                    }, true);
                }

                // Return early since we've already updated the game
                return;
            }
            // If 'rethrow' votes are more than or equal to 'agree' votes
            else {
                nextVoteFails++;
                if (nextVoteFails >= 5) {
                    nextStatus = 'gameOver'; // Or a specific 'sinisterWins' status
                    additionalLogMessage = `Team rejected. This was the 5th failed vote. Sinister Spy wins!`;
                } else {
                    nextStatus = 'teamProposal';
                    const currentTOIndex = playerIds.indexOf(game.currentTO_id!);
                    const nextTOIndex = (currentTOIndex + 1) % playerIds.length;
                    nextTOId = playerIds[nextTOIndex];
                    additionalLogMessage = `Team rejected with ${voteCounts.rethrow} rethrow votes and ${voteCounts.agree} agree votes. ${game.players[nextTOId]?.name || 'Next Team Leader'} is now the Team Leader.`;
                }
            }

            await this.firestoreService.updateDocument('games', gameId, {
                status: nextStatus,
                currentTO_id: nextTOId,
                voteFailsThisRound: nextVoteFails,
                gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: additionalLogMessage }],
                teamVote: null, // Clear the team vote data for the next round
            }, true);
        }
    }

    // Keep the original method for backward compatibility
    async aiSubmitVote(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            return; // No active game or user
        }

        // Check if the current user is an AI and needs to vote
        if (currentUserId.startsWith(gameId + '-AI-') && game.status === 'teamVoting' && !game.teamVote?.votes?.[currentUserId]) {
            await this.aiSubmitVoteForPlayer(currentUserId);
        }
    }

    // Function to draw a management card
    async drawManagementCard(overrideUserId?: string): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = overrideUserId || this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // Check if we're in the management phase and the current user is the designated player
        if (!game.managementPhase || game.managementDesignatedPlayer !== currentUserId) {
            throw new Error("You are not allowed to draw a management card at this time.");
        }

        // Check if the current story is 1-4 (management cards should not be drawn in story 5)
        const currentStory = game.currentStoryNum || 1;
        if (currentStory > 4) {
            throw new Error("Management cards cannot be drawn in the 5th round.");
        }

        // Check if there are cards left in the deck
        if (!game.managementDeck || game.managementDeck.length === 0) {
            throw new Error("No management cards left in the deck.");
        }

        // Get the current player
        const player = game.players[currentUserId];
        if (!player) {
            throw new Error("Player not found.");
        }

        // If the player already has a management card, discard it first
        let gameLogEntries = [];
        if (player.managementCard) {
            gameLogEntries.push({
                timestamp: new Date(),
                message: `${player.name} discarded their ${player.managementCard} management card.`
            });
        }

        // Draw a card from the top of the deck
        const drawnCard = game.managementDeck[0];
        const updatedDeck = game.managementDeck.slice(1); // Remove the top card

        // Update the player's management card
        const updatedPlayers = { ...game.players };
        updatedPlayers[currentUserId] = {
            ...player,
            managementCard: drawnCard
        };

        // Add a log entry
        gameLogEntries.push({
            timestamp: new Date(),
            message: `${player.name} drew a management card.`
        });

        // Check if we need to restore a previous status (for human players)
        const previousStatus = game.previousStatus;

        // Update the game
        await this.firestoreService.updateDocument('games', gameId, {
            players: updatedPlayers,
            managementDeck: updatedDeck,
            managementPhase: false, // End the management phase
            managementCardPlayPhase: true, // Set the management card play phase
            managementDesignatedPlayer: null, // Clear the designated player
            status: previousStatus || game.status, // Restore previous status if it exists
            previousStatus: null, // Clear the previous status
            gameLog: [...(game.gameLog || []), ...gameLogEntries]
        }, true);

        // Determine if this is a human player or AI
        const isHumanPlayer = !currentUserId.startsWith(gameId + '-AI-');

        // Use a longer delay for human players to ensure they can see what happened
        const delay = isHumanPlayer ? 3000 : 500;

        // Give AI players a chance to play their management cards
        setTimeout(async () => {
            await this.aiPlayManagementCard();

            // After AI players have had a chance to play their management cards,
            // allow AI players on the mission team to submit their mission cards
            const currentGame = this.currentGame();
            if (currentGame && currentGame.status === 'mission' && currentGame.mission?.team) {
                const aiPlayersOnMission = currentGame.mission.team.filter(playerId =>
                    playerId.startsWith(gameId + '-AI-')
                );

                if (aiPlayersOnMission.length > 0) {
                    console.log(`drawManagementCard: Triggering ${aiPlayersOnMission.length} AI players to submit mission cards`);

                    // If all players on the mission are AI but a human player drew the card,
                    // add an extra delay to ensure the human player can see what happened
                    const missionDelay = (isHumanPlayer && aiPlayersOnMission.length === currentGame.mission.team.length) ? 2000 : 500;

                    setTimeout(async () => {
                        await this.submitAllAIMissionCards(aiPlayersOnMission);

                        // If all players on the mission are AI, add an additional safety check
                        if (aiPlayersOnMission.length === currentGame.mission?.team.length) {
                            console.log("drawManagementCard: All players on mission are AI, adding additional safety check");
                            // Add a short timeout to ensure the game state has been updated
                            setTimeout(async () => {
                                const latestGame = this.currentGame();
                                if (latestGame && latestGame.status === 'mission') {
                                    console.log("drawManagementCard safety check: Forcing check for all cards played");
                                    if (latestGame.mission?.team && latestGame.mission?.cardsPlayed) {
                                        const updatedGame = { ...latestGame };
                                        await this.checkIfAllCardsPlayed(updatedGame, latestGame.mission.cardsPlayed);
                                    }
                                }
                            }, 1000);
                        }
                    }, missionDelay);
                }
            }
        }, delay);
    }

    // Function for AI to draw a management card
    async aiDrawManagementCard(): Promise<void> {
        console.log("aiDrawManagementCard: Starting");
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game || !game.managementPhase || !game.managementDesignatedPlayer) {
            console.log("aiDrawManagementCard: No active game or not in management phase");
            return; // No active game or not in management phase
        }

        // Check if the current story is 1-4 (management cards should not be drawn in story 5)
        const currentStory = game.currentStoryNum || 1;
        if (currentStory > 4) {
            console.log("aiDrawManagementCard: Management cards cannot be drawn in the 5th round");
            return; // Don't draw management cards in the 5th round
        }

        const designatedPlayerId = game.managementDesignatedPlayer;

        // Check if the designated player is an AI
        if (!designatedPlayerId.startsWith(gameId + '-AI-')) {
            console.log(`aiDrawManagementCard: Designated player ${designatedPlayerId} is not an AI`);
            return; // Not an AI
        }

        // Add a longer delay to allow the UI to update and show the guido icon on the designated player
        console.log(`aiDrawManagementCard: Adding delay before AI ${designatedPlayerId} draws a card`);

        // First, add a log entry to make it clear who has been designated
        await this.firestoreService.updateDocument('games', gameId, {
            gameLog: [...(game.gameLog || []), {
                timestamp: new Date(),
                message: `AI Player has designated ${game.players[designatedPlayerId]?.name || 'Unknown'} to receive a management card.`
            }]
        }, true);

        setTimeout(async () => {
            try {
                // Get the latest game state to ensure we're working with the most up-to-date data
                const latestGame = await this.firestoreService.getDocument<Game>('games', gameId, true);

                // Only proceed if the management phase is still active and the designated player hasn't changed
                if (latestGame && latestGame.managementPhase && latestGame.managementDesignatedPlayer === designatedPlayerId) {
                    console.log(`aiDrawManagementCard: AI ${designatedPlayerId} drawing a card after delay`);
                    await this.drawManagementCard(designatedPlayerId);
                } else {
                    console.log(`aiDrawManagementCard: Management phase or designated player changed, not drawing card`);
                }
            } catch (error) {
                console.error(`aiDrawManagementCard: Error drawing card for AI ${designatedPlayerId}:`, error);
            }
        }, 5000); // 5-second delay to ensure the UI has time to update and users can see who was designated
    }

    // Function to skip playing a management card
    async skipPlayingManagementCard(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // Get the current player
        const player = game.players[currentUserId];
        if (!player) {
            throw new Error("Player not found.");
        }

        // Check if the player has a management card
        if (!player.managementCard) {
            throw new Error("You don't have a management card to skip playing.");
        }

        // Add a log entry
        const gameLogEntry = {
            timestamp: new Date(),
            message: `${player.name} chose not to play their management card.`
        };

        // Add the card to the discard pile
        const cardId = player.managementCard;
        const discardedCard = {
            cardId: cardId,
            playedBy: currentUserId,
            discardedAt: new Date()
        };
        const discardedCards = [...(game.discardedManagementCards || []), discardedCard];

        // Update the player's management card (remove it)
        const updatedPlayers = { ...game.players };
        updatedPlayers[currentUserId] = {
            ...player,
            managementCard: null
        };

        // Update the game
        await this.firestoreService.updateDocument('games', gameId, {
            players: updatedPlayers,
            discardedManagementCards: discardedCards,
            gameLog: [...(game.gameLog || []), gameLogEntry]
        }, true);

        // Determine if this is a human player or AI
        const isHumanPlayer = !currentUserId.startsWith(gameId + '-AI-');

        // Use a longer delay for human players to ensure they can see what happened
        const delay = isHumanPlayer ? 3000 : 500;

        // Give AI players a chance to play their management cards
        setTimeout(async () => {
            await this.aiPlayManagementCard();

            // After AI players have had a chance to play their management cards,
            // allow AI players on the mission team to submit their mission cards
            const currentGame = this.currentGame();
            if (currentGame && currentGame.status === 'mission' && currentGame.mission?.team) {
                const aiPlayersOnMission = currentGame.mission.team.filter(playerId =>
                    playerId.startsWith(gameId + '-AI-')
                );

                if (aiPlayersOnMission.length > 0) {
                    console.log(`skipPlayingManagementCard: Triggering ${aiPlayersOnMission.length} AI players to submit mission cards`);

                    // If all players on the mission are AI but a human player skipped playing the card,
                    // add an extra delay to ensure the human player can see what happened
                    const missionDelay = (isHumanPlayer && aiPlayersOnMission.length === currentGame.mission.team.length) ? 2000 : 500;

                    setTimeout(async () => {
                        await this.submitAllAIMissionCards(aiPlayersOnMission);

                        // If all players on the mission are AI, add an additional safety check
                        if (aiPlayersOnMission.length === currentGame.mission?.team.length) {
                            console.log("skipPlayingManagementCard: All players on mission are AI, adding additional safety check");
                            // Add a short timeout to ensure the game state has been updated
                            setTimeout(async () => {
                                const latestGame = this.currentGame();
                                if (latestGame && latestGame.status === 'mission') {
                                    console.log("skipPlayingManagementCard safety check: Forcing check for all cards played");
                                    if (latestGame.mission?.team && latestGame.mission?.cardsPlayed) {
                                        const updatedGame = { ...latestGame };
                                        await this.checkIfAllCardsPlayed(updatedGame, latestGame.mission.cardsPlayed);
                                    }
                                }
                            }, 1000);
                        }
                    }, missionDelay);
                }
            }
        }, delay);
    }

    // Function to skip drawing a management card
    async skipManagementCard(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // Check if we're in the management phase and the current user is the designated player
        if (!game.managementPhase || game.managementDesignatedPlayer !== currentUserId) {
            throw new Error("You are not allowed to skip drawing a management card at this time.");
        }

        // Add a log entry
        const gameLogEntry = {
            timestamp: new Date(),
            message: `${game.players[currentUserId]?.name || 'Player'} declined to draw a management card.`
        };

        // Update the game
        await this.firestoreService.updateDocument('games', gameId, {
            managementPhase: false, // End the management phase
            managementCardPlayPhase: false, // Ensure management card play phase is also false
            managementDesignatedPlayer: null, // Clear the designated player
            gameLog: [...(game.gameLog || []), gameLogEntry]
        }, true);

        // Determine if this is a human player or AI
        const isHumanPlayer = !currentUserId.startsWith(gameId + '-AI-');

        // Use a longer delay for human players to ensure they can see what happened
        const delay = isHumanPlayer ? 3000 : 500;

        // Give AI players a chance to play their management cards
        setTimeout(async () => {
            await this.aiPlayManagementCard();

            // After AI players have had a chance to play their management cards,
            // allow AI players on the mission team to submit their mission cards
            const currentGame = this.currentGame();
            if (currentGame && currentGame.status === 'mission' && currentGame.mission?.team) {
                const aiPlayersOnMission = currentGame.mission.team.filter(playerId =>
                    playerId.startsWith(gameId + '-AI-')
                );

                if (aiPlayersOnMission.length > 0) {
                    console.log(`skipManagementCard: Triggering ${aiPlayersOnMission.length} AI players to submit mission cards`);

                    // If all players on the mission are AI but a human player skipped the card,
                    // add an extra delay to ensure the human player can see what happened
                    const missionDelay = (isHumanPlayer && aiPlayersOnMission.length === currentGame.mission.team.length) ? 2000 : 500;

                    setTimeout(async () => {
                        await this.submitAllAIMissionCards(aiPlayersOnMission);

                        // If all players on the mission are AI, add an additional safety check
                        if (aiPlayersOnMission.length === currentGame.mission?.team.length) {
                            console.log("skipManagementCard: All players on mission are AI, adding additional safety check");
                            // Add a short timeout to ensure the game state has been updated
                            setTimeout(async () => {
                                const latestGame = this.currentGame();
                                if (latestGame && latestGame.status === 'mission') {
                                    console.log("skipManagementCard safety check: Forcing check for all cards played");
                                    if (latestGame.mission?.team && latestGame.mission?.cardsPlayed) {
                                        const updatedGame = { ...latestGame };
                                        await this.checkIfAllCardsPlayed(updatedGame, latestGame.mission.cardsPlayed);
                                    }
                                }
                            }, 1000);
                        }
                    }, missionDelay);
                }
            }
        }, delay);
    }

    // Function to handle AI players in the loyalty reveal state
    async aiHandleLoyaltyReveal(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game) {
            return; // No active game
        }

        // Check if we're in the loyaltyReveal phase
        if (game.status !== 'loyaltyReveal') {
            return; // Not in loyalty reveal phase
        }

        // Get the player who is revealing their loyalty
        const revealingPlayerId = game.loyaltyRevealPlayerId;
        if (!revealingPlayerId) {
            return; // No player is revealing their loyalty
        }

        // Check if the revealing player is an AI
        if (!revealingPlayerId.startsWith(gameId + '-AI-')) {
            return; // Not an AI player
        }

        // Get the revealing player
        const revealingPlayer = game.players[revealingPlayerId];
        if (!revealingPlayer) {
            return; // Revealing player not found
        }

        // Randomly select another player to reveal to
        const playerIds = Object.keys(game.players).filter(id => id !== revealingPlayerId);

        if (playerIds.length === 0) {
            return; // No other players to reveal loyalty to
        }

        const randomIndex = Math.floor(Math.random() * playerIds.length);
        const targetPlayerId = playerIds[randomIndex];

        // Reveal loyalty to the selected player
        await this.revealLoyaltyToPlayer(targetPlayerId);
    }

    // Function to handle AI players in the scope creep state
    async aiHandleScopeCreep(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game) {
            return; // No active game
        }

        // Check if we're in the scopeCreep phase
        if (game.status !== 'scopeCreep') {
            return; // Not in scope creep phase
        }

        // Get the player who played the Scope Creep card
        const scopeCreepPlayerId = game.scopeCreepPlayerId;
        if (!scopeCreepPlayerId) {
            return; // No player played the Scope Creep card
        }

        // Check if the scope creep player is an AI
        if (!scopeCreepPlayerId.startsWith(gameId + '-AI-')) {
            return; // Not an AI player
        }

        // Get the scope creep player
        const scopeCreepPlayer = game.players[scopeCreepPlayerId];
        if (!scopeCreepPlayer) {
            return; // Scope creep player not found
        }

        // Get the current mission team
        const currentTeam = game.mission?.team || [];

        // Get all players not on the current mission team
        const availablePlayers = Object.keys(game.players).filter(id => !currentTeam.includes(id));

        if (availablePlayers.length === 0) {
            return; // No available players to add to the team
        }

        // Randomly select a player to add to the team
        const randomIndex = Math.floor(Math.random() * availablePlayers.length);
        const selectedPlayerId = availablePlayers[randomIndex];

        // Submit the selected player
        await this.submitScopeCreepTeam(selectedPlayerId, scopeCreepPlayerId);
    }

    // Function to reveal loyalty to a selected player
    async revealLoyaltyToPlayer(targetPlayerId: string): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game) {
            throw new Error("Game not available.");
        }

        // Check if we're in the loyaltyReveal phase
        if (game.status !== 'loyaltyReveal') {
            throw new Error("Not in loyalty reveal phase.");
        }

        // Get the player who is revealing their loyalty
        const revealingPlayerId = game.loyaltyRevealPlayerId;
        if (!revealingPlayerId) {
            throw new Error("No player is revealing their loyalty.");
        }

        // Get the revealing player
        const revealingPlayer = game.players[revealingPlayerId];
        if (!revealingPlayer) {
            throw new Error("Revealing player not found.");
        }

        // Get the target player
        const targetPlayer = game.players[targetPlayerId];
        if (!targetPlayer) {
            throw new Error("Target player not found.");
        }

        // Get the revealing player's role to determine their squad loyalty
        const playerRole = game.roles?.[revealingPlayerId];
        if (!playerRole) {
            throw new Error("Player role not found.");
        }

        // Determine if the player is Dexter or Sinister
        const isDexter = playerRole.includes('Dexter') || playerRole === 'Duke' || playerRole === 'SupportManager';
        const squadLoyalty = isDexter ? 'dexter' : 'sinister';

        // Create a log entry for the loyalty reveal
        const gameLogEntry = {
            timestamp: new Date(),
            message: `${revealingPlayer.name} revealed their loyalty to ${targetPlayer.name}.`
        };

        // Update the game state to record the loyalty reveal
        const revealedLoyalties = game.revealedLoyalties || {};
        revealedLoyalties[revealingPlayerId] = {
            targetId: targetPlayerId,
            timestamp: Timestamp.now()
        };

        // Return to the previous game state
        const previousStatus = game.mission ? 'mission' : (game.teamVote ? 'teamVoting' : 'teamProposal');

        // Update the game
        await this.firestoreService.updateDocument('games', gameId, {
            status: previousStatus,
            loyaltyRevealPlayerId: null,
            revealedLoyalties: revealedLoyalties,
            gameLog: [...(game.gameLog || []), gameLogEntry]
        }, true);
    }

    // Function to inspect a player's card (Security Audit card effect)
    async inspectPlayerCard(targetPlayerId: string): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // Check if we're in the security audit phase
        if (game.status !== 'securityAudit' || !game.securityAuditPhase || game.securityAuditPlayerId !== currentUserId) {
            throw new Error("Not in security audit phase or not the player who played the Security Audit card.");
        }

        // Check if the target player is on the mission team
        if (!game.mission?.team.includes(targetPlayerId)) {
            throw new Error("Target player is not on the mission team.");
        }

        // Check if the target player has played a card
        if (!game.mission.cardsPlayed?.[targetPlayerId]) {
            throw new Error("Target player has not played a card yet.");
        }

        // Get the target player's card
        const targetCard = game.mission.cardsPlayed[targetPlayerId];

        // Create a game log entry (only visible to the player who played the Security Audit card)
        const gameLogEntry = {
            timestamp: Timestamp.now(),
            message: `You inspected ${game.players[targetPlayerId].name}'s Pull Request review selection and found they played: ${targetCard === 'approve' ? 'APPROVE' : 'REQUEST CHANGES'}.`
        };

        // Return to the previous game state
        const previousStatus = game.previousStatus || 'mission';

        // Update the game
        await this.firestoreService.updateDocument('games', gameId, {
            status: previousStatus,
            securityAuditPhase: false,
            securityAuditPlayerId: null,
            securityAuditTargetId: targetPlayerId,
            securityAuditResult: targetCard,
            gameLog: [...(game.gameLog || []), gameLogEntry]
        }, true);
    }

    // Function to handle AI security audit
    async aiHandleSecurityAudit(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game) {
            return;
        }

        // Check if we're in the security audit phase
        if (game.status !== 'securityAudit' || !game.securityAuditPhase) {
            return;
        }

        // Get the AI player ID
        const aiPlayerId = game.securityAuditPlayerId;
        if (!aiPlayerId || !aiPlayerId.startsWith(gameId + '-AI-')) {
            return;
        }

        // Get the mission team
        const missionTeam = game.mission?.team || [];
        if (missionTeam.length === 0) {
            return;
        }

        // Filter out players who haven't played a card yet
        const playersWithCards = missionTeam.filter(playerId =>
            game.mission?.cardsPlayed?.[playerId] !== undefined
        );

        if (playersWithCards.length === 0) {
            return;
        }

        // Randomly select a player to inspect
        const randomIndex = Math.floor(Math.random() * playersWithCards.length);
        const targetPlayerId = playersWithCards[randomIndex];

        // Inspect the player's card
        await this.inspectPlayerCard(targetPlayerId);
    }

    // Function to play a management card
    async playManagementCard(overrideUserId?: string): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = overrideUserId || this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // Get the current player
        const player = game.players[currentUserId];
        if (!player) {
            throw new Error("Player not found.");
        }

        // Check if the player has a management card
        if (!player.managementCard) {
            throw new Error("You don't have a management card to play.");
        }

        const cardId = player.managementCard;
        const cardInfo = MANAGEMENT_CARDS[cardId];

        if (!cardInfo) {
            throw new Error(`Unknown management card: ${cardId}`);
        }

        // Check if we're in the right phase to play this card
        if (!cardInfo.playablePhases.includes(game.status)) {
            throw new Error(`The ${cardInfo.title} - ${cardInfo.name} card cannot be played during the ${game.status} phase.`);
        }

        // Check if we're on the right story to play this card
        const currentStory = game.currentStoryNum || 1;
        if (!cardInfo.playableStories.includes(currentStory)) {
            throw new Error(`The ${cardInfo.title} - ${cardInfo.name} card cannot be played during User Story ${currentStory}.`);
        }

        // Add a log entry
        const gameLogEntry = {
            timestamp: new Date(),
            message: `${player.name} played their ${cardInfo.title} - ${cardInfo.name} management card.`
        };

        // Update the player's management card (remove it)
        const updatedPlayers = { ...game.players };
        updatedPlayers[currentUserId] = {
            ...player,
            managementCard: null
        };

        // Record the played card
        const playedCard = {
            cardId: cardId,
            playedBy: currentUserId,
            playedAt: new Date()
        };

        // Add the card to the discard pile
        const discardedCard = {
            cardId: cardId,
            playedBy: currentUserId,
            discardedAt: new Date()
        };
        const discardedCards = [...(game.discardedManagementCards || []), discardedCard];

        // Handle specific card effects
        let additionalUpdates = {};

        if (cardInfo.name === 'Shifting Priorities') {
            // "Shifting Priorities" card effect:
            // Switch to the next User Story that hasn't been played yet
            let nextStory = currentStory + 1;
            const poShiftedStories = game.poShiftedStories || [];

            // Skip any stories that have already been played
            while (poShiftedStories.includes(nextStory) && nextStory <= 5) {
                console.log("playManagementCard: Skipping already played story", nextStory);
                nextStory++;
            }

            if (nextStory > 5) {
                throw new Error("Cannot advance beyond the 5th User Story.");
            }

            // Add log entry for story change
            gameLogEntry.message += ` Switching to User Story ${nextStory}.`;

            // Get the required team size for the next story
            const playerIds = Object.keys(game.players);
            const addExtraMember = game.rushJobTechDebtNextStoryAdditionalMember && nextStory === game.rushJobTechDebtNextStory;
            const requiredTeamSize = this.getRequiredTeamSize(playerIds.length, nextStory, addExtraMember);

            // Get the current mission team if available
            const currentMissionTeam = game.mission?.team || [];

            // Calculate the new team size
            let newTeamSize = currentMissionTeam.length;

            // If the current team size is less than the required team size, add players
            if (currentMissionTeam.length < requiredTeamSize) {
                // The TO must keep the current team and add players
                newTeamSize = requiredTeamSize;
            } else if (currentMissionTeam.length > requiredTeamSize) {
                // If the current team size is greater than the required team size, we can't proceed
                throw new Error(`Cannot reduce the team size. The current team has ${currentMissionTeam.length} players, and the new story requires ${requiredTeamSize} players.`);
            }
            // If the current team size equals the required team size, keep the current team

            // Instead of automatically forming a team, we'll transition to a new phase
            // where the Technical Owner can select players for the team
            gameLogEntry.message += ` The Technical Owner needs to keep the current team and add ${newTeamSize - currentMissionTeam.length} more player for the new story.`;

            // Update the game state to move to the next story and transition to the shiftingPriorities phase
            additionalUpdates = {
                currentStoryNum: nextStory,
                originalStoryNum: currentStory, // Store the original story number
                poShiftedStories: [...poShiftedStories, nextStory], // Add the next story to the shifted stories array
                status: 'shiftingPriorities', // Transition to the shiftingPriorities phase
                teamProposal: {
                    numToSelect: newTeamSize,
                    selectedPlayers: currentMissionTeam // Start with the current team
                },
                teamVote: null // Clear any team votes
            };
        } else if (cardInfo.name === 'People Person') {
            // "People Person" card effect:
            // The player needs to select another player to reveal their squad loyalty to

            // Update the game state to transition to the loyaltyReveal phase
            // The player will select who to reveal their loyalty to in this phase
            gameLogEntry.message += ` ${player.name} can now select a player to reveal their loyalty to.`;

            additionalUpdates = {
                status: 'loyaltyReveal',
                loyaltyRevealPlayerId: currentUserId
            };

            // If this is an AI player, handle the loyalty reveal automatically after a short delay
            if (currentUserId.startsWith(gameId + '-AI-')) {
                setTimeout(() => {
                    this.aiHandleLoyaltyReveal();
                }, 1000);
            }
        } else if (cardInfo.name === 'Preliminary Review') {
            // "Preliminary Review" card effect:
            // Designate a player to review the User Story publicly for all to see

            // For now, we'll randomly select another player to review the User Story
            // In a real implementation, the player would choose who to designate
            const playerIds = Object.keys(game.players).filter(id => id !== currentUserId);

            if (playerIds.length === 0) {
                throw new Error("No other players to designate for review.");
            }

            const randomIndex = Math.floor(Math.random() * playerIds.length);
            const designatedPlayerId = playerIds[randomIndex];
            const designatedPlayer = game.players[designatedPlayerId];

            // Randomly determine if the designated player will merge or request changes
            // In a real implementation, this would be based on the player's decision
            const willMerge = Math.random() > 0.5;
            const reviewAction = willMerge ? 'merged' : 'requested changes on';

            // Add log entry for the preliminary review
            gameLogEntry.message += ` ${player.name} designated ${designatedPlayer.name} to review the User Story. ${designatedPlayer.name} ${reviewAction} the mission.`;

            // Update the game state to record the preliminary review
            additionalUpdates = {
                preliminaryReview: {
                    designatedPlayerId: designatedPlayerId,
                    designatedBy: currentUserId,
                    action: willMerge ? 'merge' : 'requestChanges',
                    timestamp: Timestamp.now()
                }
            };
        } else if (cardInfo.name === 'Scope Creep!') {
            // "Scope Creep!" card effect:
            // Add an additional person to the development team

            // Save the current game status to return to after the Scope Creep effect is resolved
            const previousStatus = game.status;

            // Get the current mission team if available
            const currentMissionTeam = game.mission?.team || [];

            // Add log entry for the Scope Creep card
            gameLogEntry.message += ` ${player.name} can now add an additional person to the development team.`;

            // Update the game state to transition to the scopeCreep phase
            additionalUpdates = {
                status: 'scopeCreep',
                scopeCreepPlayerId: currentUserId,
                previousStatus: previousStatus, // Store the previous status to return to after the Scope Creep effect is resolved
                teamProposal: {
                    numToSelect: 1, // Only one additional person can be added
                    selectedPlayers: [] // Start with no selected players
                }
            };

            // If this is an AI player, handle the Scope Creep automatically after a short delay
            if (currentUserId.startsWith(gameId + '-AI-')) {
                setTimeout(() => {
                    this.aiHandleScopeCreep();
                }, 1000);
            }
        } else if (cardInfo.name === 'Security Audit!') {
            // "Security Audit!" card effect:
            // Secretly inspect a player's Pull Request review selection

            // Save the current game status to return to after the Security Audit effect is resolved
            const previousStatus = game.status;

            // Add log entry for the Security Audit card
            gameLogEntry.message += ` ${player.name} can now select a player to inspect their Pull Request review selection.`;

            // Update the game state to transition to the securityAudit phase
            additionalUpdates = {
                status: 'securityAudit',
                securityAuditPlayerId: currentUserId,
                securityAuditPhase: true,
                previousStatus: previousStatus // Store the previous status to return to after the Security Audit effect is resolved
            };

            // If this is an AI player, handle the Security Audit automatically after a short delay
            if (currentUserId.startsWith(gameId + '-AI-')) {
                setTimeout(() => {
                    this.aiHandleSecurityAudit();
                }, 1000);
            }
        } else if (cardInfo.name === 'Service Reassignment!') {
            // "Service Reassignment!" card effect:
            // Exchange a player on the development team with a player not on the team

            // Save the current game status to return to after the Service Reassignment effect is resolved
            const previousStatus = game.status;

            // Get the current mission team if available
            const currentMissionTeam = game.mission?.team || [];

            // Add log entry for the Service Reassignment card
            gameLogEntry.message += ` ${player.name} can now exchange a player on the development team with a player not on the team.`;

            // Update the game state to transition to the serviceReassignment phase
            additionalUpdates = {
                status: 'serviceReassignment',
                serviceReassignmentPlayerId: currentUserId,
                serviceReassignmentPhase: true,
                previousStatus: previousStatus, // Store the previous status to return to after the Service Reassignment effect is resolved
                teamProposal: {
                    numToSelect: 1, // Only one player can be exchanged
                    selectedPlayers: [] // Start with no selected players
                }
            };

            // If this is an AI player, handle the Service Reassignment automatically after a short delay
            if (currentUserId.startsWith(gameId + '-AI-')) {
                // AI logic for Service Reassignment would go here
                // For now, we'll just have the AI randomly select a player to remove and a player to add
                setTimeout(async () => {
                    // Get the current mission team
                    const currentGame = await this.firestoreService.getDocument<Game>('games', gameId, true);
                    if (!currentGame) return;

                    const missionTeam = currentGame.mission?.team || [];
                    if (missionTeam.length === 0) {
                        // No team to modify, just return to the previous status
                        await this.firestoreService.updateDocument('games', gameId, {
                            status: previousStatus,
                            serviceReassignmentPlayerId: null,
                            serviceReassignmentPhase: false
                        }, true);
                        return;
                    }

                    // Get all players not on the team
                    const allPlayerIds = Object.keys(currentGame.players);
                    const playersNotOnTeam = allPlayerIds.filter(id => !missionTeam.includes(id));

                    if (playersNotOnTeam.length === 0) {
                        // No players to add, just return to the previous status
                        await this.firestoreService.updateDocument('games', gameId, {
                            status: previousStatus,
                            serviceReassignmentPlayerId: null,
                            serviceReassignmentPhase: false
                        }, true);
                        return;
                    }

                    // Randomly select a player to remove from the team
                    const randomTeamIndex = Math.floor(Math.random() * missionTeam.length);
                    const playerToRemove = missionTeam[randomTeamIndex];

                    // Randomly select a player to add to the team
                    const randomNotOnTeamIndex = Math.floor(Math.random() * playersNotOnTeam.length);
                    const playerToAdd = playersNotOnTeam[randomNotOnTeamIndex];

                    // Create the new team
                    const newTeam = [...missionTeam];
                    newTeam.splice(randomTeamIndex, 1, playerToAdd); // Replace the removed player with the added player

                    // Update the game
                    await this.firestoreService.updateDocument('games', gameId, {
                        status: previousStatus,
                        serviceReassignmentPlayerId: null,
                        serviceReassignmentPhase: false,
                        mission: {
                            ...currentGame.mission,
                            team: newTeam
                        },
                        gameLog: [...(currentGame.gameLog || []), {
                            timestamp: new Date(),
                            message: `${player.name} exchanged ${currentGame.players[playerToRemove].name} with ${currentGame.players[playerToAdd].name} on the development team.`
                        }]
                    }, true);
                }, 1000);
            }
        } else if (cardInfo.name === 'The Real Boss!') {
            // "The Real Boss!" card effect:
            // Take another player's management card or draw two cards from the management deck, keeping one

            // Save the current game status to return to after the CEO card effect is resolved
            const previousStatus = game.status;

            // Check if any other players have management cards
            const playersWithCards = Object.keys(game.players).filter(id => {
                return id !== currentUserId && game.players[id].managementCard !== null && game.players[id].managementCard !== undefined;
            });

            // Add log entry for the CEO card
            if (playersWithCards.length > 0) {
                gameLogEntry.message += ` ${player.name} can now take another player's management card.`;
            } else {
                gameLogEntry.message += ` ${player.name} can now draw two cards from the management deck, keeping one.`;
            }

            // Update the game state to transition to the ceoCardPlay phase
            additionalUpdates = {
                status: 'ceoCardPlay',
                ceoCardPlayerId: currentUserId,
                previousStatus: previousStatus // Store the previous status to return to after the CEO card effect is resolved
            };

            // If this is an AI player, handle the CEO card automatically after a short delay
            if (currentUserId.startsWith(gameId + '-AI-')) {
                // AI logic for CEO card would go here
                // For now, we'll just have the AI draw two cards and keep the first one
                setTimeout(async () => {
                    // Draw two cards
                    const availableCards = game.managementDeck || [];
                    if (availableCards.length < 2) {
                        // Not enough cards in the deck, just return to the previous status
                        await this.firestoreService.updateDocument('games', gameId, {
                            status: previousStatus,
                            ceoCardPlayerId: null
                        }, true);
                        return;
                    }

                    // Draw two cards
                    const drawnCards = [availableCards[0], availableCards[1]];
                    const remainingDeck = availableCards.slice(2);

                    // AI always keeps the first card
                    const selectedCard = drawnCards[0];
                    const discardedCard = drawnCards[1];

                    // Update the player's management card
                    const updatedPlayers = { ...game.players };
                    updatedPlayers[currentUserId] = {
                        ...player,
                        managementCard: selectedCard
                    };

                    // Add the discarded card to the discard pile
                    const discardedCards = [...(game.discardedManagementCards || []), {
                        cardId: discardedCard,
                        playedBy: currentUserId,
                        discardedAt: new Date()
                    }];

                    // Update the game
                    await this.firestoreService.updateDocument('games', gameId, {
                        status: previousStatus,
                        ceoCardPlayerId: null,
                        players: updatedPlayers,
                        managementDeck: remainingDeck,
                        discardedManagementCards: discardedCards,
                        gameLog: [...(game.gameLog || []), {
                            timestamp: new Date(),
                            message: `${player.name} drew two cards and kept the ${MANAGEMENT_CARDS[selectedCard]?.title} card.`
                        }]
                    }, true);
                }, 1000);
            }
        } else if (cardInfo.name === 'Foam Dart Assault!') {
            // "Foam Dart Assault!" card effect:
            // Redo a past User Story with its original team less one person of your choice

            // Save the current game status to return to after the Foam Dart Assault effect is resolved
            const previousStatus = game.status;

            // Check if three User Stories have merged or closed
            const completedStories = (game.storyResults || []).filter(result => result !== null).length;
            if (completedStories >= 3) {
                throw new Error("It is too late to play this card. Three or more User Stories have already merged or closed.");
            }

            // Check if there are any completed stories to redo
            if (!game.missionHistory || Object.keys(game.missionHistory).length === 0) {
                throw new Error("There are no completed User Stories to redo.");
            }

            // Add log entry for the Foam Dart Assault card
            gameLogEntry.message += ` ${player.name} can now select a past User Story to redo with its original team less one person.`;

            // Update the game state to transition to the foamDartAssault phase
            additionalUpdates = {
                status: 'foamDartAssault',
                foamDartAssaultPlayerId: currentUserId,
                foamDartAssaultPhase: true,
                previousStatus: previousStatus // Store the previous status to return to after the Foam Dart Assault effect is resolved
            };

            // If this is an AI player, handle the Foam Dart Assault automatically after a short delay
            if (currentUserId.startsWith(gameId + '-AI-')) {
                // AI logic for Foam Dart Assault would go here
                // For now, we'll just have the AI randomly select a story to redo and a player to remove
                setTimeout(async () => {
                    // Get the current game state
                    const currentGame = await this.firestoreService.getDocument<Game>('games', gameId, true);
                    if (!currentGame || !currentGame.missionHistory) return;

                    // Get the completed stories
                    const completedStoryIndices = Object.keys(currentGame.missionHistory).map(Number);
                    if (completedStoryIndices.length === 0) {
                        // No stories to redo, just return to the previous status
                        await this.firestoreService.updateDocument('games', gameId, {
                            status: previousStatus,
                            foamDartAssaultPlayerId: null,
                            foamDartAssaultPhase: false
                        }, true);
                        return;
                    }

                    // Randomly select a story to redo
                    const randomStoryIndex = Math.floor(Math.random() * completedStoryIndices.length);
                    const storyToRedo = completedStoryIndices[randomStoryIndex];

                    // Get the original team for the selected story
                    const originalTeam = currentGame.missionHistory[storyToRedo].team;
                    if (!originalTeam || originalTeam.length === 0) {
                        // No team for this story, just return to the previous status
                        await this.firestoreService.updateDocument('games', gameId, {
                            status: previousStatus,
                            foamDartAssaultPlayerId: null,
                            foamDartAssaultPhase: false
                        }, true);
                        return;
                    }

                    // Randomly select a player to remove from the team
                    const randomPlayerIndex = Math.floor(Math.random() * originalTeam.length);
                    const playerToRemove = originalTeam[randomPlayerIndex];

                    // Create the new team (original team less one person)
                    const newTeam = [...originalTeam];
                    newTeam.splice(randomPlayerIndex, 1);

                    // Update the game to redo the selected story with the new team
                    await this.firestoreService.updateDocument('games', gameId, {
                        status: 'mission',
                        foamDartAssaultPlayerId: null,
                        foamDartAssaultPhase: false,
                        currentStoryNum: storyToRedo,
                        mission: {
                            team: newTeam,
                            cardsPlayed: {}
                        },
                        gameLog: [...(currentGame.gameLog || []), {
                            timestamp: new Date(),
                            message: `${player.name} is redoing User Story ${storyToRedo} with its original team less ${currentGame.players[playerToRemove].name}.`
                        }]
                    }, true);
                }, 1000);
            }
        } else if (cardInfo.name === 'Rush Job, Tech Debt!') {
            // "Rush Job, Tech Debt!" card effect:
            // 1. All Sinister spies must request changes on the User Story
            // 2. The result is a merge no matter what
            // 3. The next User Story has one additional team member

            // Add log entry for the Rush Job, Tech Debt! card
            gameLogEntry.message += ` All Sinister spies must request changes on the User Story. The result is a merge no matter what. The next User Story will have one additional team member.`;

            // Get the current mission team if available
            const currentMissionTeam = game.mission?.team || [];

            // Get the current story number
            const currentStory = game.currentStoryNum || 1;

            // Calculate the next story number
            const nextStory = currentStory + 1;

            // Check if we're on the last story
            if (nextStory > 5) {
                throw new Error("Cannot add an additional team member beyond the 5th User Story.");
            }

            // Update the game state to enforce the card's effects
            additionalUpdates = {
                // Flag to indicate that all Sinister spies must request changes
                // This will be checked in the checkIfAllCardsPlayed function
                rushJobTechDebt: true,

                // Flag to indicate that the result is a merge no matter what
                // This will be checked in the checkIfAllCardsPlayed function
                rushJobTechDebtMerge: true,

                // Store the next story number to add an additional team member
                rushJobTechDebtNextStory: nextStory
            };
        } else if (cardInfo.name === 'Creative Differences!') {
            // "Creative Differences!" card effect:
            // 1. Nullify an agreed upon team
            // 2. Pass the Technical Owner token to the next player
            // 3. Any played management cards remain in effect

            // Get the current mission team if available
            const currentMissionTeam = game.mission?.team || [];

            // Add log entry for the Creative Differences! card
            gameLogEntry.message += ` The agreed upon team has been nullified, and the Technical Owner token has been passed to the next player.`;

            // Find the next player in the player order to be the new Technical Owner
            const playerOrder = game.playerOrder || [];
            const currentTOIndex = playerOrder.indexOf(game.currentTO_id || '');
            const nextTOIndex = (currentTOIndex + 1) % playerOrder.length;
            const nextTO_id = playerOrder[nextTOIndex];
            const nextTO = game.players[nextTO_id];

            // Add log entry for the new Technical Owner
            gameLogEntry.message += ` ${nextTO.name} is now the Technical Owner.`;

            // Update the game state to nullify the team and pass the Technical Owner token
            additionalUpdates = {
                currentTO_id: nextTO_id,
                mission: {
                    team: [], // Nullify the team
                    cardsPlayed: {} // Clear any cards played
                },
                teamVote: null // Clear any team votes
            };
        } else if (cardInfo.name === 'It\'s Show Time!') {
            // "It's Show Time!" card effect:
            // The Technical Owner adds two people to the User Story
            // Shuffle the team's reviews and reveal the top three cards to determine the story's result
            // Other cards remain unrevealed

            // Get the current mission team if available
            const currentMissionTeam = game.mission?.team || [];

            // Check if there's a team to modify
            if (currentMissionTeam.length === 0) {
                throw new Error("There is no team to modify for the User Story.");
            }

            // Save the current game status to return to after the It's Show Time! effect is resolved
            const previousStatus = game.status;

            // Add log entry for the It's Show Time! card
            gameLogEntry.message += ` The Technical Owner can now add two people to the User Story. The team's reviews will be shuffled and the top three cards will determine the story's result.`;

            // Update the game state to transition to the itsShowTime phase
            additionalUpdates = {
                status: 'itsShowTime',
                itsShowTimePlayerId: currentUserId,
                itsShowTimePhase: true,
                previousStatus: previousStatus, // Store the previous status to return to after the effect is resolved
                teamProposal: {
                    numToSelect: 2, // Two additional people can be added
                    selectedPlayers: [] // Start with no selected players
                }
            };

            // If this is an AI player, handle the It's Show Time! automatically after a short delay
            if (currentUserId.startsWith(gameId + '-AI-')) {
                // AI logic for It's Show Time! would go here
                // For now, we'll just have the AI randomly select two players to add
                setTimeout(async () => {
                    // Get the current game state
                    const currentGame = await this.firestoreService.getDocument<Game>('games', gameId, true);
                    if (!currentGame) return;

                    const missionTeam = currentGame.mission?.team || [];

                    // Get all players not on the team
                    const allPlayerIds = Object.keys(currentGame.players);
                    const playersNotOnTeam = allPlayerIds.filter(id => !missionTeam.includes(id));

                    // If there are fewer than 2 players not on the team, just add as many as possible
                    const numToAdd = Math.min(2, playersNotOnTeam.length);

                    if (numToAdd === 0) {
                        // No players to add, just proceed to shuffling and revealing
                        this.processItsShowTimeResults(gameId, currentGame);
                        return;
                    }

                    // Randomly select players to add
                    const playersToAdd = [];
                    const availablePlayers = [...playersNotOnTeam];
                    for (let i = 0; i < numToAdd; i++) {
                        const randomIndex = Math.floor(Math.random() * availablePlayers.length);
                        playersToAdd.push(availablePlayers[randomIndex]);
                        availablePlayers.splice(randomIndex, 1);
                    }

                    // Create the new team
                    const newTeam = [...missionTeam, ...playersToAdd];

                    // Update the game with the new team
                    await this.firestoreService.updateDocument('games', gameId, {
                        mission: {
                            ...currentGame.mission,
                            team: newTeam
                        },
                        itsShowTimePlayersToAdd: playersToAdd
                    }, true);

                    // Process the shuffling and revealing of cards
                    this.processItsShowTimeResults(gameId, {
                      ...currentGame,
                      mission: {
                        ...currentGame.mission,
                        cardsPlayed: currentGame.mission!.cardsPlayed,
                        team: newTeam
                      }
                    });
                }, 1000);
            }
        } else if (cardInfo.name === 'All Hands!') {
            // "All Hands!" card effect:
            // The Technical Owner adds players to the development team until it is the same size as the Dexter squad
            // If the Sales Rep is played, this card must be played

            // TODO: Add functionality to enforce that this card must be played if the Sales Rep card is played.
            // This would involve:
            // 1. Checking if the "Rush Job, Tech Debt!" (Sales Rep) card has been played
            // 2. Checking if any player has the "All Hands!" (COO) card
            // 3. Forcing that player to play the "All Hands!" card

            // Get the current mission team if available
            const currentMissionTeam = game.mission?.team || [];

            // Count the number of Dexter squad members
            let dexterSquadSize = 0;
            for (const playerId in game.players) {
                const playerRole = game.roles?.[playerId];
                if (playerRole) {
                    // Check if the player is part of the Dexter squad
                    const isDexter = playerRole.includes('Dexter') || playerRole === 'Duke' || playerRole === 'SupportManager';
                    if (isDexter) {
                        dexterSquadSize++;
                    }
                }
            }

            // Calculate how many players need to be added to the team
            const currentTeamSize = currentMissionTeam.length;
            const playersToAdd = Math.max(0, dexterSquadSize - currentTeamSize);

            // Add log entry for the All Hands! card
            if (playersToAdd > 0) {
                gameLogEntry.message += ` The Technical Owner needs to add ${playersToAdd} player(s) to the development team to match the Dexter squad size of ${dexterSquadSize}.`;
            } else {
                gameLogEntry.message += ` The development team already matches or exceeds the Dexter squad size of ${dexterSquadSize}.`;
            }

            // Save the current game status to return to after the All Hands! effect is resolved
            const previousStatus = game.status;

            // Update the game state to transition to a phase where the Technical Owner can add players
            if (playersToAdd > 0) {
                additionalUpdates = {
                    status: 'scopeCreep', // Reuse the scopeCreep phase for adding players
                    scopeCreepPlayerId: game.currentTO_id, // The Technical Owner will add the players
                    previousStatus: previousStatus, // Store the previous status to return to after the effect is resolved
                    teamProposal: {
                        numToSelect: playersToAdd, // Number of players to add
                        selectedPlayers: [] // Start with no selected players
                    },
                    allHandsPlayed: true // Flag to indicate that the All Hands! card was played
                };
            }
        }

        // Update the game
        await this.firestoreService.updateDocument('games', gameId, {
            players: updatedPlayers,
            playedManagementCard: playedCard,
            discardedManagementCards: discardedCards,
            managementCardPlayPhase: false, // End the management card play phase
            gameLog: [...(game.gameLog || []), gameLogEntry],
            ...additionalUpdates
        }, true);

        // Give other AI players a chance to play their management cards
        setTimeout(async () => {
            await this.aiPlayManagementCard();

            // After AI players have had a chance to play their management cards,
            // allow AI players on the mission team to submit their mission cards
            const currentGame = this.currentGame();
            if (currentGame && currentGame.status === 'mission' && currentGame.mission?.team) {
                const aiPlayersOnMission = currentGame.mission.team.filter(playerId =>
                    playerId.startsWith(gameId + '-AI-')
                );

                if (aiPlayersOnMission.length > 0) {
                    console.log(`playManagementCard: Triggering ${aiPlayersOnMission.length} AI players to submit mission cards`);
                    await this.submitAllAIMissionCards(aiPlayersOnMission);

                    // If all players on the mission are AI, add an additional safety check
                    if (aiPlayersOnMission.length === currentGame.mission.team.length) {
                        console.log("playManagementCard: All players on mission are AI, adding additional safety check");
                        // Add a short timeout to ensure the game state has been updated
                        setTimeout(async () => {
                            const latestGame = this.currentGame();
                            if (latestGame && latestGame.status === 'mission') {
                                console.log("playManagementCard safety check: Forcing check for all cards played");
                                if (latestGame.mission?.team && latestGame.mission?.cardsPlayed) {
                                    const updatedGame = { ...latestGame };
                                    await this.checkIfAllCardsPlayed(updatedGame, latestGame.mission.cardsPlayed);
                                }
                            }
                        }, 1000);
                    }
                }
            }
        }, 500);
    }

    // Function for AI to play a management card
    // Function to process the It's Show Time! card results
    async processItsShowTimeResults(gameId: string, game: Game): Promise<void> {
        if (!gameId || !game) {
            throw new Error("Game not available.");
        }

        // Get the current mission team
        const missionTeam = game.mission?.team || [];
        if (missionTeam.length === 0) {
            throw new Error("There is no team for the User Story.");
        }

        // Generate random reviews for each team member (approve or request changes)
        const reviews: ('approve' | 'request')[] = [];
        for (let i = 0; i < missionTeam.length; i++) {
            // Randomly determine if the player will approve or request changes
            const willApprove = Math.random() > 0.5;
            reviews.push(willApprove ? 'approve' : 'request');
        }

        // Shuffle the reviews
        const shuffledReviews = this.shuffleArray([...reviews]);

        // Reveal only the top three cards
        const revealedReviews = shuffledReviews.slice(0, 3);

        // Count the number of "request changes" cards in the revealed reviews
        const requestChangesCount = revealedReviews.filter(review => review === 'request').length;

        // Determine the story result based on the revealed reviews
        const storyResult = requestChangesCount >= 2 ? 'sinister' : 'dexter';

        // Get the current story number
        const currentStory = game.currentStoryNum || 1;

        // Update the story results
        const storyResults = [...(game.storyResults || [])];
        while (storyResults.length < currentStory) {
            storyResults.push(null);
        }
        storyResults[currentStory - 1] = storyResult;

        // Update the completed mission teams
        const completedMissionTeams = { ...(game.completedMissionTeams || {}) };
        completedMissionTeams[currentStory] = missionTeam;

        // Update the mission history
        const missionHistory = { ...(game.missionHistory || {}) };
        missionHistory[currentStory] = {
            team: missionTeam,
            acceptedTeamProposedBy: game.currentTO_id || '',
            requestChangesCount: requestChangesCount
        };

        // Add a log entry
        const gameLogEntry = {
            timestamp: new Date(),
            message: `The team's reviews were shuffled and the top three cards were revealed. The story result is ${storyResult === 'dexter' ? 'merged' : 'closed with changes requested'}.`
        };

        // Update the game state
        await this.firestoreService.updateDocument('games', gameId, {
            status: 'results', // Move to the results phase
            storyResults: storyResults,
            completedMissionTeams: completedMissionTeams,
            missionHistory: missionHistory,
            itsShowTimePhase: false,
            itsShowTimePlayerId: null,
            itsShowTimeShuffledReviews: shuffledReviews,
            itsShowTimeRevealedReviews: revealedReviews,
            gameLog: [...(game.gameLog || []), gameLogEntry],
            mission: {
                team: missionTeam,
                cardsPlayed: {} // Clear any cards played
            }
        }, true);
    }

    async aiPlayManagementCardForPlayer(aiPlayerId: string): Promise<void> {
        console.log(`aiPlayManagementCardForPlayer: Starting for AI player ${aiPlayerId}`);
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game) {
            console.log("aiPlayManagementCardForPlayer: No active game");
            return; // No active game
        }

        // Check if the player is an AI and has a management card
        if (!aiPlayerId.startsWith(gameId + '-AI-') ||
            !game.players[aiPlayerId]?.managementCard) {
            console.log(`aiPlayManagementCardForPlayer: Skipping AI player ${aiPlayerId}`);
            return; // Not an AI or no management card
        }

        // Check if we're in the right phase (mission phase or management card play phase)
        if (game.status !== 'mission' && !game.managementCardPlayPhase) {
            console.log(`aiPlayManagementCardForPlayer: Skipping AI player ${aiPlayerId} - not in mission phase or management card play phase`);
            return; // Wrong phase
        }

        const cardId = game.players[aiPlayerId].managementCard;
        const cardInfo = MANAGEMENT_CARDS[cardId!];

        if (!cardInfo) {
            console.log(`aiPlayManagementCardForPlayer: Unknown card ${cardId} for AI player ${aiPlayerId}`);
            return; // Unknown card
        }

        // Check if the card can be played in the current phase and story
        const currentStory = game.currentStoryNum || 1;
        if (!cardInfo.playablePhases.includes(game.status) || !cardInfo.playableStories.includes(currentStory)) {
            console.log(`aiPlayManagementCardForPlayer: Card ${cardId} cannot be played in phase ${game.status} or story ${currentStory}`);
            return; // Card cannot be played
        }

        // AI decision logic: For now, always play the card if it can be played
        try {
            console.log(`aiPlayManagementCardForPlayer: AI ${aiPlayerId} playing card ${cardId}`);
            await this.playManagementCard(aiPlayerId);
        } catch (error) {
            console.error(`aiPlayManagementCardForPlayer: Error playing card for AI ${aiPlayerId}:`, error);
        }
    }

    // Function to check if any AI players can play management cards
    async aiPlayManagementCard(): Promise<void> {
        console.log("aiPlayManagementCard: Starting");
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game) {
            console.log("aiPlayManagementCard: No active game");
            return; // No active game
        }

        // Check all AI players
        for (const playerId of Object.keys(game.players)) {
            if (playerId.startsWith(gameId + '-AI-') && game.players[playerId].managementCard) {
                await this.aiPlayManagementCardForPlayer(playerId);
            }
        }
    }


    // New method to submit all AI mission cards in a single update
    async submitAllAIMissionCards(aiPlayerIds: string[]): Promise<void> {
        console.log("submitAllAIMissionCards: Starting with AI players", aiPlayerIds);
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game || !game.mission) {
            console.log("submitAllAIMissionCards: No active game or no mission");
            return; // No active game or no mission
        }

        // Check if we're in the management phase or management card play phase
        if (game.managementPhase || game.managementCardPlayPhase) {
            // Check if all players on the mission are AI players
            const allAI = game.mission.team?.every(playerId => playerId.startsWith(gameId + '-AI-')) || false;

            // If all players are AI, proceed anyway to prevent the game from getting stuck
            if (allAI) {
                console.log("submitAllAIMissionCards: All players on mission are AI, proceeding despite management phase");
            } else {
                console.log("submitAllAIMissionCards: In management phase or management card play phase, waiting for management card to be drawn or played");
                return; // Wait for management card to be drawn and played or skipped
            }
        }

        console.log("submitAllAIMissionCards: Game status", game.status);
        console.log("submitAllAIMissionCards: Mission team", game.mission.team);

        // Collect cards for all AI players
        const cards: {[playerId: string]: 'approve' | 'request'} = {};

        for (const aiPlayerId of aiPlayerIds) {
            // Skip if player is not an AI, not on mission, or has already played
            if (!aiPlayerId.startsWith(gameId + '-AI-') ||
                game.status !== 'mission' ||
                !game.mission.team?.includes(aiPlayerId) ||
                game.mission.cardsPlayed?.[aiPlayerId]) {
                console.log(`submitAllAIMissionCards: Skipping AI player ${aiPlayerId}`);
                continue;
            }

            // Determine the card to play based on AI role
            const aiRole = game.roles?.[aiPlayerId];
            let card: 'approve' | 'request' = 'approve'; // Default to approve for Dexter

            // Sinister roles typically play 'request'
            if (aiRole === 'SinisterSpy' || aiRole === 'Sniper') {
                card = 'request';
            }

            // Special case for Duke (Loyal Dexter) - must approve
            if (aiRole === 'Duke' || aiRole === 'LoyalDexter') {
                card = 'approve';
            }

            console.log(`submitAllAIMissionCards: AI ${aiPlayerId} (${aiRole}) playing mission card: ${card}`);

            // Add card to the collection
            cards[aiPlayerId] = card;
        }

        // If no cards were collected, return
        if (Object.keys(cards).length === 0) {
            console.log("submitAllAIMissionCards: No cards to play");
            return;
        }

        // Combine with existing cards
        const updatedCardsPlayed = {
            ...(game.mission.cardsPlayed || {}),
            ...cards
        };
        console.log("submitAllAIMissionCards: Updated cards played", updatedCardsPlayed);

        try {
            // Update Firebase with all cards in a single update
            console.log("submitAllAIMissionCards: Updating database with cards");
            await this.firestoreService.updateDocument('games', gameId, {
                'mission.cardsPlayed': updatedCardsPlayed
            }, true);

            console.log("submitAllAIMissionCards: Database updated successfully");

            // Check if all players on the mission have played their cards
            // Create a copy of the game with updated cards played for proper mission completion check
            console.log("submitAllAIMissionCards: Checking if all cards played");
            const updatedGame = { ...game, mission: { ...game.mission, cardsPlayed: updatedCardsPlayed } };
            await this.checkIfAllCardsPlayed(updatedGame, updatedCardsPlayed);
            console.log("submitAllAIMissionCards: Completed");
        } catch (error) {
            console.error("submitAllAIMissionCards: Error updating database", error);
        }
    }

    // Keep for backward compatibility, but modify to use the batch method
    async aiSubmitMissionCardForPlayer(aiPlayerId: string): Promise<void> {
        this.submitAllAIMissionCards([aiPlayerId]);
    }

    // Keep the original method for backward compatibility
    async aiSubmitMissionCard(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            return; // No active game or user
        }

        // Check if the current user is an AI and needs to play a mission card
        if (currentUserId.startsWith(gameId + '-AI-') &&
            game.status === 'mission' &&
            game.mission?.team?.includes(currentUserId) &&
            !game.mission?.cardsPlayed?.[currentUserId]) {
            await this.aiSubmitMissionCardForPlayer(currentUserId);
        }
    }

    async submitMissionCard(card: 'approve' | 'request'): Promise<void> {
        console.log("submitMissionCard: Starting with card", card);
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            console.error("submitMissionCard: Game or user not available");
            throw new Error("Game or user not available.");
        }

        console.log("submitMissionCard: Game status", game.status);
        console.log("submitMissionCard: Mission team", game.mission?.team);
        console.log("submitMissionCard: Current user", currentUserId);

        // Check if we're in the management phase or management card play phase - if so, don't submit any cards yet
        if (game.managementPhase || game.managementCardPlayPhase) {
            console.error("submitMissionCard: In management phase or management card play phase, waiting for management card to be drawn or played");
            throw new Error("Cannot play mission cards until the management card is drawn and played or skipped.");
        }

        // 1. Check if the current game status is 'mission' and if the current user is on the mission team.\n
        if (game.status !== 'mission' || !game.mission?.team.includes(currentUserId)) {
            console.error("submitMissionCard: Not on mission or game not in mission phase");
            throw new Error("Not on a mission or game not in mission phase.");
        }

        // Prevent playing multiple cards
        if (game.mission.cardsPlayed?.[currentUserId]) {
             console.log("submitMissionCard: User already played a card for this mission");
             return; // Or throw an error if preferred
        }

        // Check if the player has the Janitor card and is on the 5th User Story
        const player = game.players[currentUserId];
        const currentStory = game.currentStoryNum || 1;
        if (player && player.managementCard === 'janitor' && currentStory === 5 && card === 'request') {
            console.log("submitMissionCard: Player has Janitor card and is on the 5th User Story, forcing approve card");
            // Force the player to approve changes on the 5th User Story
            card = 'approve';
        }

        // 3. Record the current user's card\n
        const updatedCardsPlayed = { ...game.mission?.cardsPlayed, [currentUserId]: card };
        console.log("submitMissionCard: Updated cards played", updatedCardsPlayed);

        console.log("submitMissionCard: Updating database with card");
        try {
            await this.firestoreService.updateDocument('games', gameId, {
                'mission.cardsPlayed': updatedCardsPlayed
            }, true);
            console.log("submitMissionCard: Database updated successfully");
        } catch (error) {
            console.error("submitMissionCard: Error updating database", error);
            throw error;
        }

        // Check if all players on the mission have played their cards
        // Create a copy of the game with updated cards played for proper mission completion check
        console.log("submitMissionCard: Checking if all cards played");
        const updatedGame = { ...game, mission: { ...game.mission, cardsPlayed: updatedCardsPlayed } };
        await this.checkIfAllCardsPlayed(updatedGame, updatedCardsPlayed);
        console.log("submitMissionCard: Completed");
    }

    // Helper method to check if all players on the mission have played their cards
    private async checkIfAllCardsPlayed(game: Game, updatedCardsPlayed: {[playerId: string]: 'approve' | 'request'}): Promise<void> {
        const gameId = this.activeGameId();
        if (!gameId || !game || !game.mission?.team) {
            console.log("checkIfAllCardsPlayed: Missing gameId, game, or mission team");
            return;
        }

        // Get the latest game state to ensure we're working with the most up-to-date data
        const latestGame = await this.firestoreService.getDocument<Game>('games', gameId, true);
        if (!latestGame) {
            console.log("checkIfAllCardsPlayed: Could not fetch latest game state");
            return;
        }

        // If the game is already in 'results' or 'gameOver' state, don't process again
        if (latestGame.status === 'results' || latestGame.status === 'gameOver') {
            console.log("checkIfAllCardsPlayed: Game already in", latestGame.status, "state, not processing again");
            return;
        }

        // If the game is not in 'mission' state, don't process
        if (latestGame.status !== 'mission') {
            console.log("checkIfAllCardsPlayed: Game not in mission state, current state:", latestGame.status);
            return;
        }

        // Use the mission team and cards played from the latest game state
        const missionTeam = latestGame.mission?.team || [];
        const latestCardsPlayed = latestGame.mission?.cardsPlayed || {};

        // Combine the cards played from the parameter with the latest cards played from the database
        const combinedCardsPlayed = { ...latestCardsPlayed, ...updatedCardsPlayed };

        const allPlayed = missionTeam.every(playerId => combinedCardsPlayed.hasOwnProperty(playerId));

        console.log("checkIfAllCardsPlayed: Mission team:", missionTeam);
        console.log("checkIfAllCardsPlayed: Latest cards played:", latestCardsPlayed);
        console.log("checkIfAllCardsPlayed: Updated cards played:", updatedCardsPlayed);
        console.log("checkIfAllCardsPlayed: Combined cards played:", combinedCardsPlayed);
        console.log("checkIfAllCardsPlayed: All played:", allPlayed);

        // If all players on the mission have played their cards, process the results
        if (allPlayed) {
            const requestCount = Object.values(combinedCardsPlayed).filter(card => card === 'request').length;
            const approveCount = Object.values(combinedCardsPlayed).filter(card => card === 'approve').length;

            // Determine if the mission succeeded or failed
            // In "The Sprint", any 'request' card causes the mission to fail
            // Even if a Team Lead card's preliminary review designated a player who chose to merge the mission
            let missionResult: 'dexter' | 'sinister' = requestCount > 0 ? 'sinister' : 'dexter';

            // Check if there's a preliminary review and the designated player chose to merge
            if (latestGame.preliminaryReview && latestGame.preliminaryReview.action === 'merge') {
                // If there are request cards, the mission should still fail regardless of the preliminary review
                if (requestCount > 0) {
                    missionResult = 'sinister';
                    console.log("checkIfAllCardsPlayed: Preliminary review chose to merge, but there are request cards, so the mission fails");
                }
            }

            // Check if the Rush Job, Tech Debt! card was played
            // If so, the result is a merge no matter what
            if (latestGame.rushJobTechDebtMerge) {
                missionResult = 'dexter';
                console.log("checkIfAllCardsPlayed: Rush Job, Tech Debt! card was played, so the result is a merge no matter what");
            }

            // Update the story results
            const storyResults = [...(latestGame.storyResults || [])];
            const currentStoryIndex = (latestGame.currentStoryNum || 1) - 1;
            storyResults[currentStoryIndex] = missionResult;

            let additionalLogMessage = '';
            let designatedPlayerId: string | null = null;

            if (missionResult === 'dexter') {
                additionalLogMessage = `Mission succeeded with ${approveCount} approve cards and ${requestCount} request cards. Dexter wins this story!`;
            } else {
                additionalLogMessage = `Mission failed with ${requestCount} request cards. Sinister wins this story!`;
                // Add clarification if there was a preliminary review that chose to merge
                if (latestGame.preliminaryReview && latestGame.preliminaryReview.action === 'merge' && requestCount > 0) {
                    const designatedPlayerName = latestGame.players[latestGame.preliminaryReview.designatedPlayerId]?.name || 'Unknown';
                    additionalLogMessage += ` ${designatedPlayerName} had to have requested changes on the mission since there were ${requestCount} request cards.`;
                }

                // Designate a player to draw a management card after mission failure
                // Only for stories 1-4, similar to the logic in submitVote
                const currentStory = latestGame.currentStoryNum || 1;
                if (currentStory <= 4) {
                    // Choose a player who was not on the mission team
                    const allPlayerIds = latestGame.playerOrder || [];
                    const nonMissionPlayers = allPlayerIds.filter(playerId => !missionTeam.includes(playerId));

                    if (nonMissionPlayers.length > 0) {
                        // Choose the first player after the current TO in the player order who wasn't on the mission
                        const currentTOIndex = allPlayerIds.indexOf(latestGame.currentTO_id!);
                        let designatedPlayerIndex = (currentTOIndex + 1) % allPlayerIds.length;

                        // Find the first player after the TO who wasn't on the mission
                        while (missionTeam.includes(allPlayerIds[designatedPlayerIndex])) {
                            designatedPlayerIndex = (designatedPlayerIndex + 1) % allPlayerIds.length;
                        }

                        designatedPlayerId = allPlayerIds[designatedPlayerIndex];
                        additionalLogMessage += ` ${latestGame.players[designatedPlayerId]?.name || 'Designated player'} can now draw a management card.`;
                    }
                }
            }

            // Check if the game is over
            const dexterWins = storyResults.filter(r => r === 'dexter').length;
            const sinisterWins = storyResults.filter(r => r === 'sinister').length;

            let nextStatus: Game['status'] = 'results';
            let winner: 'dexter' | 'sinister' | undefined = undefined;

            // Check for Janitor card win condition: Sinister wins on the 4th User Story or earlier
            const currentStory = latestGame.currentStoryNum || 1;
            let janitorWin = false;

            if (missionResult === 'sinister' && currentStory <= 4) {
                // Check if any player has the Janitor card
                for (const playerId in latestGame.players) {
                    const player = latestGame.players[playerId];
                    if (player.managementCard === 'janitor') {
                        janitorWin = true;
                        additionalLogMessage += ` Player ${player.name} with the Janitor card wins because Sinister won on the ${currentStory}${this.getOrdinalSuffix(currentStory)} User Story!`;
                        break;
                    }
                }
            }

            // In "The Sprint", Dexter needs 3 successful missions to win, Sinister needs 3 failed missions
            if (janitorWin) {
                nextStatus = 'gameOver';
                winner = 'sinister';
            } else if (dexterWins >= 3) {
                nextStatus = 'gameOver';
                winner = 'dexter';
                additionalLogMessage += ` Dexter has won ${dexterWins} stories and wins the game!`;
            } else if (sinisterWins >= 3) {
                nextStatus = 'gameOver';
                winner = 'sinister';
                additionalLogMessage += ` Sinister has won ${sinisterWins} stories and wins the game!`;
            }

            console.log("checkIfAllCardsPlayed: Current game status", latestGame.status);
            console.log("checkIfAllCardsPlayed: Updating game state to", nextStatus);
            try {
                // Create update object without winner field
                const updateData: any = {
                    status: nextStatus,
                    storyResults: storyResults,
                    mission: { ...latestGame.mission, cardsPlayed: combinedCardsPlayed },
                    gameLog: [...(latestGame.gameLog || []), { timestamp: new Date(), message: additionalLogMessage }],
                };

                // Check if the Rush Job, Tech Debt! card was played
                // If so, the next User Story has one additional team member
                if (latestGame.rushJobTechDebtNextStory) {
                    const nextStory = latestGame.rushJobTechDebtNextStory;
                    // Only apply this effect if we're not on the last story
                    if (nextStory <= 5) {
                        console.log(`checkIfAllCardsPlayed: Rush Job, Tech Debt! card was played, so User Story ${nextStory} will have one additional team member`);
                        // Store the next story number and the fact that it should have one additional team member
                        updateData.rushJobTechDebtNextStoryAdditionalMember = true;
                        // Add a log entry
                        updateData.gameLog = [...(updateData.gameLog || []), {
                            timestamp: new Date(),
                            message: `Due to the Rush Job, Tech Debt! card, User Story ${nextStory} will have one additional team member.`
                        }];
                    }
                }

                // If a player was designated to draw a management card after mission failure
                if (designatedPlayerId) {
                    updateData.managementDesignatedPlayer = designatedPlayerId;
                    updateData.managementPhase = true;
                }

                // Store the mission team for this completed story
                const completedMissionTeams = { ...(latestGame.completedMissionTeams || {}) };
                completedMissionTeams[currentStoryIndex] = missionTeam;
                updateData.completedMissionTeams = completedMissionTeams;

                // Store mission history with additional information
                const missionHistory = { ...(latestGame.missionHistory || {}) };
                missionHistory[currentStoryIndex] = {
                    team: missionTeam,
                    acceptedTeamProposedBy: latestGame.currentTO_id || '',
                    requestChangesCount: requestCount
                };
                updateData.missionHistory = missionHistory;

                // Only add winner field if it's defined
                if (winner !== undefined) {
                    updateData.winner = winner;
                }

                await this.firestoreService.updateDocument('games', gameId, updateData, true);
                console.log("checkIfAllCardsPlayed: Game state updated successfully");

                // Check if the designated player is an AI and trigger them to draw a card
                if (designatedPlayerId && designatedPlayerId.startsWith(gameId + '-AI-')) {
                    setTimeout(async () => {
                        await this.aiDrawManagementCard();
                    }, 2000); // Increased to 2 seconds to ensure the UI has time to update
                }

                // Verify the game state was updated correctly
                const updatedGame = await this.firestoreService.getDocument<Game>('games', gameId, true);
                console.log("checkIfAllCardsPlayed: Updated game status", updatedGame?.status);
            } catch (error) {
                console.error("checkIfAllCardsPlayed: Error updating game state", error);
            }
        }
    }

    async nextRound(): Promise<void> {
        console.log("nextRound: Starting");
        const gameId = this.activeGameId();
        const game = this.currentGame();

        console.log("nextRound: Game status", game?.status);
        console.log("nextRound: Game winner", game?.winner);

        if (!gameId || !game) {
            console.log("nextRound: No active game or game data");
            return;
        }

        if (game.status !== 'results') {
            console.log("nextRound: Game not in results phase, current status:", game.status);
            return;
        }

        if (game.winner) {
            console.log("nextRound: Game already has a winner:", game.winner);
            return;
        }

        // Check if we're in a shifted story due to PO card
        let nextStoryNum: number;
        let additionalLogMessage = '';

        // First, check if there are any lower-numbered stories that haven't been completed yet
        const storyResults = game.storyResults || [];
        let lowestIncompleteStory = -1;

        for (let i = 0; i < storyResults.length; i++) {
            if (storyResults[i] === null) {
                lowestIncompleteStory = i + 1; // Convert from 0-indexed to 1-indexed
                break;
            }
        }

        if (lowestIncompleteStory > 0) {
            // We found a lower-numbered story that hasn't been completed yet
            console.log("nextRound: Found lower-numbered incomplete story", lowestIncompleteStory);
            nextStoryNum = lowestIncompleteStory;
            additionalLogMessage = ` Returning to User Story #${nextStoryNum} which hasn't been completed yet.`;

            // If we're in a shifted story, update the game state
            if (game.originalStoryNum !== undefined) {
                // Add the current story to the list of shifted stories that have been completed
                const poShiftedStories = [...(game.poShiftedStories || []), game.currentStoryNum];

                // Update the game with the completed shifted story
                await this.firestoreService.updateDocument(
                    'games',
                    gameId,
                    {
                        poShiftedStories: poShiftedStories,
                        originalStoryNum: null // Clear the original story number
                    },
                    true
                );
            }
        } else if (game.originalStoryNum !== undefined) {
            // We're in a shifted story due to PO card, but there are no lower-numbered incomplete stories
            console.log("nextRound: Completing shifted story, proceeding to next story after original story", game.originalStoryNum);

            // Add the current story to the list of shifted stories that have been completed
            const poShiftedStories = [...(game.poShiftedStories || []), game.currentStoryNum];

            // Proceed to the next story after the original story
            nextStoryNum = game.originalStoryNum + 1;

            // Check if we need to skip any stories that were already played due to PO card
            if (poShiftedStories.length > 0) {
                // Skip any stories that have already been played due to PO card
                while (poShiftedStories.includes(nextStoryNum) && nextStoryNum <= (game.storiesTotal ?? 5)) {
                    console.log("nextRound: Skipping already played story", nextStoryNum);
                    additionalLogMessage = ` Skipping User Story #${nextStoryNum} as it was already played.`;
                    nextStoryNum++;
                }
            }

            additionalLogMessage = ` Proceeding to User Story #${nextStoryNum} after completing shifted story.`;

            // Update the game with the completed shifted story
            await this.firestoreService.updateDocument(
                'games',
                gameId,
                {
                    poShiftedStories: poShiftedStories,
                    originalStoryNum: null // Clear the original story number
                },
                true
            );
        } else {
            // Normal story progression
            nextStoryNum = (game.currentStoryNum ?? 0) + 1;

            // Check if we need to skip any stories that were already played due to PO card
            if (game.poShiftedStories && game.poShiftedStories.length > 0) {
                // Skip any stories that have already been played due to PO card
                while (game.poShiftedStories.includes(nextStoryNum) && nextStoryNum <= (game.storiesTotal ?? 5)) {
                    console.log("nextRound: Skipping already played story", nextStoryNum);
                    additionalLogMessage = ` Skipping User Story #${nextStoryNum} as it was already played.`;
                    nextStoryNum++;
                }
            }
        }

        const totalStories = game.storiesTotal ?? 5;

        console.log("nextRound: Next story", nextStoryNum, "of", totalStories);

        if (nextStoryNum > totalStories) {
            // Handle end of game if all stories are played
            // This might involve the assassination phase or declaring a winner based on mission results
            let winner: 'dexter' | 'sinister' | undefined = undefined;
            const dexterWins = game.storyResults?.filter(r => r === 'dexter').length ?? 0;
            const sinisterWins = game.storyResults?.filter(r => r === 'sinister').length ?? 0;

            console.log("nextRound: Dexter wins", dexterWins, "Sinister wins", sinisterWins);

            if (dexterWins > sinisterWins) {
                // Dexter wins unless there's an assassination phase
                // TODO: Implement assassination phase logic if applicable
                winner = 'dexter';
            } else if (sinisterWins >= dexterWins) {
                 // Sinister wins if they have more or equal failed missions
                 winner = 'sinister';
            }

            console.log("nextRound: Game over, winner is", winner);
            try {
                // Create update object without winner field
                const updateData: any = {
                    status: 'gameOver',
                    gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: `All stories played. Game over! ${winner ? winner.toUpperCase() + ' wins!' : ''}` }],
                };

                // Only add winner field if it's defined
                if (winner !== undefined) {
                    updateData.winner = winner;
                }

                await this.firestoreService.updateDocument(
                    'games',
                    gameId,
                    updateData,
                    true
                );
                console.log("nextRound: Game state updated to gameOver");
            } catch (error) {
                console.error("nextRound: Error updating game state to gameOver", error);
            }

        } else {
            // Move to the next round
            const playerIds = game.playerOrder || [];
            const currentTOIndex = playerIds.indexOf(game.currentTO_id!);
            const nextTOIndex = (currentTOIndex + 1) % playerIds.length;
            const nextTOId = playerIds[nextTOIndex];

            console.log("nextRound: Moving to next round, next TO is", nextTOId);
            try {
                await this.firestoreService.updateDocument(
                    'games',
                    gameId,
                    {
                        currentStoryNum: nextStoryNum,
                        currentTO_id: nextTOId,
                        voteFailsThisRound: 0,
                        teamVote: null, // Clear previous team vote data
                        mission: null, // Clear previous mission data
                        status: 'teamProposal', // Start the next round with team proposal
                        gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: `Starting User Story #${nextStoryNum}${additionalLogMessage}. ${game.players[nextTOId]?.name || 'Next Team Leader'} is the Team Leader.` }],
                    },
                    true
                );
                console.log("nextRound: Game state updated to teamProposal for next round");
            } catch (error) {
                console.error("nextRound: Error updating game state for next round", error);
            }
        }
        console.log("nextRound: Completed");
    }

    async getPublicGames(): Promise<Game[]> {
        try {
            // Query for public games that are in the lobby status
            const publicGames = await this.firestoreService.getCollection<Game>(
                'games',
                true,
                [where('settings.isPublic', '==', true), where('status', '==', 'lobby')]
            );
            return publicGames;
        } catch (error) {
            console.error("Error fetching public games:", error);
            return [];
        }
    }

    async deleteAllGames(): Promise<boolean> {
        try {
            await this.firestoreService.deleteAllDocumentsInCollection('games', true);
            console.log("All games deleted successfully");
            return true;
        } catch (error) {
            console.error("Error deleting all games:", error);
            throw error;
        }
    }

    // Helper method to get the ordinal suffix for a number (1st, 2nd, 3rd, etc.)
    private getOrdinalSuffix(num: number): string {
        const j = num % 10;
        const k = num % 100;
        if (j === 1 && k !== 11) {
            return 'st';
        }
        if (j === 2 && k !== 12) {
            return 'nd';
        }
        if (j === 3 && k !== 13) {
            return 'rd';
        }
        return 'th';
    }

    // Function to take a management card from another player (CEO card effect)
    async takeCEOManagementCard(targetPlayerId: string, cardId: string): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // Check if we're in the CEO card play phase
        if (game.status !== 'ceoCardPlay' || game.ceoCardPlayerId !== currentUserId) {
            throw new Error("You cannot take a management card at this time.");
        }

        // Get the target player
        const targetPlayer = game.players[targetPlayerId];
        if (!targetPlayer) {
            throw new Error("Target player not found.");
        }

        // Check if the target player has the specified management card
        if (targetPlayer.managementCard !== cardId) {
            throw new Error("Target player does not have the specified management card.");
        }

        // Get the current player
        const currentPlayer = game.players[currentUserId];
        if (!currentPlayer) {
            throw new Error("Current player not found.");
        }

        // Update the players' management cards
        const updatedPlayers = { ...game.players };
        updatedPlayers[currentUserId] = {
            ...currentPlayer,
            managementCard: cardId
        };
        updatedPlayers[targetPlayerId] = {
            ...targetPlayer,
            managementCard: null
        };

        // Add a log entry
        const gameLogEntry = {
            timestamp: new Date(),
            message: `${currentPlayer.name} took the ${MANAGEMENT_CARDS[cardId]?.title} card from ${targetPlayer.name}.`
        };

        // Get the previous status to return to
        const previousStatus = game.previousStatus || 'mission';

        // Update the game
        await this.firestoreService.updateDocument('games', gameId, {
            status: previousStatus,
            ceoCardPlayerId: null,
            players: updatedPlayers,
            gameLog: [...(game.gameLog || []), gameLogEntry]
        }, true);
    }

    // Function to draw two cards from the management deck (CEO card effect)
    async drawCEOCards(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // Check if we're in the CEO card play phase
        if (game.status !== 'ceoCardPlay' || game.ceoCardPlayerId !== currentUserId) {
            throw new Error("You cannot draw CEO cards at this time.");
        }

        // Get the available cards
        const availableCards = game.managementDeck || [];
        if (availableCards.length < 2) {
            throw new Error("Not enough cards in the management deck.");
        }

        // Draw two cards
        const drawnCards = [availableCards[0], availableCards[1]];
        const remainingDeck = availableCards.slice(2);

        // Add a log entry
        const gameLogEntry = {
            timestamp: new Date(),
            message: `${game.players[currentUserId].name} drew two cards from the management deck.`
        };

        // Update the game
        await this.firestoreService.updateDocument('games', gameId, {
            ceoCardDrawnCards: drawnCards,
            managementDeck: remainingDeck,
            gameLog: [...(game.gameLog || []), gameLogEntry]
        }, true);
    }

    // Function to select one of the drawn cards to keep (CEO card effect)
    async selectCEOCard(cardId: string): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // Check if we're in the CEO card play phase
        if (game.status !== 'ceoCardPlay' || game.ceoCardPlayerId !== currentUserId) {
            throw new Error("You cannot select a CEO card at this time.");
        }

        // Check if we have drawn cards
        if (!game.ceoCardDrawnCards || game.ceoCardDrawnCards.length < 2) {
            throw new Error("No cards have been drawn.");
        }

        // Check if the selected card is one of the drawn cards
        if (!game.ceoCardDrawnCards.includes(cardId)) {
            throw new Error("Selected card is not one of the drawn cards.");
        }

        // Get the current player
        const currentPlayer = game.players[currentUserId];
        if (!currentPlayer) {
            throw new Error("Current player not found.");
        }

        // Get the other card (the one not selected)
        const otherCard = game.ceoCardDrawnCards.find(card => card !== cardId);
        if (!otherCard) {
            throw new Error("Could not find the other card.");
        }

        // Update the player's management card
        const updatedPlayers = { ...game.players };
        updatedPlayers[currentUserId] = {
            ...currentPlayer,
            managementCard: cardId
        };

        // Add the other card to the discard pile
        const discardedCard = {
            cardId: otherCard,
            playedBy: currentUserId,
            discardedAt: new Date()
        };
        const discardedCards = [...(game.discardedManagementCards || []), discardedCard];

        // Add a log entry
        const gameLogEntry = {
            timestamp: new Date(),
            message: `${currentPlayer.name} kept the ${MANAGEMENT_CARDS[cardId]?.title} card and discarded the ${MANAGEMENT_CARDS[otherCard]?.title} card.`
        };

        // Get the previous status to return to
        const previousStatus = game.previousStatus || 'mission';

        // Update the game
        await this.firestoreService.updateDocument('games', gameId, {
            status: previousStatus,
            ceoCardPlayerId: null,
            ceoCardDrawnCards: null,
            players: updatedPlayers,
            discardedManagementCards: discardedCards,
            gameLog: [...(game.gameLog || []), gameLogEntry]
        }, true);
    }
}
