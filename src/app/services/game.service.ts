import { signal, WritableSignal, effect, inject, Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { serverTimestamp, Unsubscribe, where } from 'firebase/firestore';
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
            isHost: true
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
            name: currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : `Player ${Object.keys(game.players).length + 1}`)
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

        // Randomly select a player to be the first TO
        const randomIndex = Math.floor(Math.random() * game.playerOrder.length);
        const firstTO = game.playerOrder[randomIndex];

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

    async proposeTeam(team: Player[], overrideUserId?: string): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = overrideUserId || this.authService.userId();

        console.log("proposeTeam called with", { team, overrideUserId, currentUserId });

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // 1. Check if the current user is the current Team Leader (TO).
        if (game.currentTO_id !== currentUserId) {
            console.error("proposeTeam: User is not the current TO", { currentUserId, currentTO_id: game.currentTO_id });
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
            teamVote: { proposedTeam: teamPlayerIds, votes: {} },
            status: 'teamVoting',
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
        const requiredTeamSize = this.getRequiredTeamSize(Object.keys(game.players).length, game.currentStoryNum ?? 1);
        const allPlayers = Object.values(game.players);
        const shuffledPlayers = allPlayers.sort(() => 0.5 - Math.random()); // Shuffle players
        const proposedTeam = shuffledPlayers.slice(0, requiredTeamSize); // Select the first 'requiredTeamSize' players
        console.log("aiProposeTeam: Selected team", { requiredTeamSize, proposedTeam });

        try {
            // Call the proposeTeam() method with the randomly selected team and the AI's user ID
            await this.proposeTeam(proposedTeam, currentUserId);
            console.log("aiProposeTeam: Team proposed successfully");
        } catch (error) {
            console.error("aiProposeTeam: Error proposing team", error);
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

        const gameLogEntry = {
            timestamp: new Date(),
            message: `${game.players[currentUserId]?.name || 'Player'} voted to ${vote} the team.`
        };

        await this.firestoreService.updateDocument('games', gameId, {
            teamVote: {
                ...game.teamVote,
                votes: updatedVotes
            },
            gameLog: [...(game.gameLog || []), gameLogEntry]
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
                await this.firestoreService.updateDocument('games', gameId, {
                    mission: { team: missionTeam, cardsPlayed: {} },
                    status: nextStatus,
                    currentTO_id: nextTOId,
                    voteFailsThisRound: nextVoteFails,
                    gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: additionalLogMessage }],
                    teamVote: null, // Clear the team vote data for the next round
                }, true);

                // Check if there are any AI players on the mission team and trigger them to submit their cards
                const aiPlayersOnMission = missionTeam.filter(playerId =>
                    playerId.startsWith(gameId + '-AI-')
                );

                if (aiPlayersOnMission.length > 0) {
                    console.log(`Triggering ${aiPlayersOnMission.length} AI players to submit mission cards`);
                    // Use setTimeout to ensure this runs after the game state update is processed
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
                await this.firestoreService.updateDocument('games', gameId, {
                    mission: { team: missionTeam, cardsPlayed: {} },
                    status: nextStatus,
                    currentTO_id: nextTOId,
                    voteFailsThisRound: nextVoteFails,
                    gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: additionalLogMessage }],
                    teamVote: null, // Clear the team vote data for the next round
                }, true);

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


    // New method to submit all AI mission cards in a single update
    async submitAllAIMissionCards(aiPlayerIds: string[]): Promise<void> {
        console.log("submitAllAIMissionCards: Starting with AI players", aiPlayerIds);
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game || !game.mission) {
            console.log("submitAllAIMissionCards: No active game or no mission");
            return; // No active game or no mission
        }

        console.log("submitAllAIMissionCards: Game status", game.status);
        console.log("submitAllAIMissionCards: Mission team", game.mission.team);

        // Collect cards for all AI players
        const cards: {[playerId: string]: 'approve' | 'request'} = {};
        const gameLogEntries: {timestamp: Date, message: string}[] = [];

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

            // Add log entry
            gameLogEntries.push({
                timestamp: new Date(),
                message: `${game.players[aiPlayerId]?.name || 'AI Player'} played a card.`
            });
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
                'mission.cardsPlayed': updatedCardsPlayed,
                gameLog: [...(game.gameLog || []), ...gameLogEntries]
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

        // 3. Record the current user's card\n
        const updatedCardsPlayed = { ...game.mission?.cardsPlayed, [currentUserId]: card };
        console.log("submitMissionCard: Updated cards played", updatedCardsPlayed);

        const gameLogEntry = {
            timestamp: new Date(),
            message: `${game.players[currentUserId]?.name || 'Player'} played a card.`
        };

        console.log("submitMissionCard: Updating database with card");
        try {
            await this.firestoreService.updateDocument('games', gameId, {
                'mission.cardsPlayed': updatedCardsPlayed,
                gameLog: [...(game.gameLog || []), gameLogEntry]
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
            const missionResult: 'dexter' | 'sinister' = requestCount > 0 ? 'sinister' : 'dexter';

            // Update the story results
            const storyResults = [...(latestGame.storyResults || [])];
            const currentStoryIndex = (latestGame.currentStoryNum || 1) - 1;
            storyResults[currentStoryIndex] = missionResult;

            let additionalLogMessage = '';
            if (missionResult === 'dexter') {
                additionalLogMessage = `Mission succeeded with ${approveCount} approve cards and ${requestCount} request cards. Dexter wins this story!`;
            } else {
                additionalLogMessage = `Mission failed with ${requestCount} request cards. Sinister wins this story!`;
            }

            // Check if the game is over
            const dexterWins = storyResults.filter(r => r === 'dexter').length;
            const sinisterWins = storyResults.filter(r => r === 'sinister').length;

            let nextStatus: Game['status'] = 'results';
            let winner: 'dexter' | 'sinister' | undefined = undefined;

            // In "The Sprint", Dexter needs 3 successful missions to win, Sinister needs 3 failed missions
            if (dexterWins >= 3) {
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

                // Only add winner field if it's defined
                if (winner !== undefined) {
                    updateData.winner = winner;
                }

                await this.firestoreService.updateDocument('games', gameId, updateData, true);
                console.log("checkIfAllCardsPlayed: Game state updated successfully");

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

        const currentStoryNum = (game.currentStoryNum ?? 0) + 1;
        const totalStories = game.storiesTotal ?? 5;

        console.log("nextRound: Current story", currentStoryNum, "of", totalStories);

        if (currentStoryNum > totalStories) {
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
                        currentStoryNum: currentStoryNum,
                        currentTO_id: nextTOId,
                        voteFailsThisRound: 0,
                        teamVote: null, // Clear previous team vote data
                        mission: null, // Clear previous mission data
                        status: 'teamProposal', // Start the next round with team proposal
                        gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: `Starting User Story #${currentStoryNum}. ${game.players[nextTOId]?.name || 'Next Team Leader'} is the Team Leader.` }],
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
}
