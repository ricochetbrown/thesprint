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

                        // Check if the current player is an AI and needs to play a mission card
                        const isAICheckMission = currentUserId && gameId && currentUserId.startsWith(gameId + '-AI-'); // Check if the gameId is part of the AI ID

                        if (game && currentUserId && isAICheckMission && game.status === 'mission' && game.mission?.team?.includes(currentUserId) && !game.mission?.cardsPlayed?.[currentUserId]) {
                            this.aiSubmitMissionCard();
                        }

                        // Check if the current player is an AI and needs to vote
                        const isAICheck = currentUserId && gameId && currentUserId.startsWith(gameId + '-AI-'); // Check if the gameId is part of the AI ID
                        if (game && currentUserId && isAICheck && game.status === 'teamVoting' && !game.teamVote?.votes?.[currentUserId]) {
                            this.aiSubmitVote();
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

    async aiSubmitVote(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId(); // Get current user ID inside the async function

        if (!gameId || !game || !currentUserId) {
            return; // No active game or user
        }

        // Check if the current player is an AI, is the current TO, and needs to vote
        const isAI = currentUserId.startsWith(gameId + '-AI-'); // Example AI ID check
        if (!isAI || game.status !== 'teamVoting' || game.teamVote?.votes?.[currentUserId]) {
            return; // Not an AI or already voted or not in voting phase
        }

        // Determine the vote: 'agree' if 5th rethrow (index 4), otherwise random
        const vote: 'agree' | 'rethrow' = (game.voteFailsThisRound ?? 0) === 4 ? 'agree' : (Math.random() > 0.5 ? 'agree' : 'rethrow');

        await this.submitVote(vote);
    }

    async aiSubmitMissionCard(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId(); // Get current user ID inside the async function

        if (!gameId || !game || !currentUserId) {
            return; // No active game or user
        }

        // Check if the current player is an AI, the game status is 'mission', and their card is not played
        const isAI = currentUserId.startsWith(gameId + '-AI-'); // Example AI ID check
        if (!isAI || game.status !== 'mission' || !game.mission?.team?.includes(currentUserId) || game.mission?.cardsPlayed?.[currentUserId]) {
            return; // Not an AI or not on mission or not in mission phase or already played
        }

        // Determine the card to play based on AI role
        const aiRole = game.roles?.[currentUserId];
        let card: 'approve' | 'request' = 'approve'; // Default to approve for Dexter

        // Sinister roles typically play 'request'
        if (aiRole === 'SinisterSpy' || aiRole === 'Sniper') {
            card = 'request';
        }

        // Special case for Duke (Loyal Dexter) - must approve
        if (aiRole === 'Duke' || aiRole === 'LoyalDexter') {
             card = 'approve';
        }

        await this.submitMissionCard(card);
    }

    async submitMissionCard(card: 'approve' | 'request'): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();
        const currentUserId = this.authService.userId();

        if (!gameId || !game || !currentUserId) {
            throw new Error("Game or user not available.");
        }

        // 1. Check if the current game status is 'mission' and if the current user is on the mission team.\n
        if (game.status !== 'mission' || !game.mission?.team.includes(currentUserId)) {
            throw new Error("Not on a mission or game not in mission phase.");
        }

        // Prevent playing multiple cards
        if (game.mission.cardsPlayed?.[currentUserId]) {
             console.log("User already played a card for this mission.");
             return; // Or throw an error if preferred
        }

        // 3. Record the current user's card\n
        const updatedCardsPlayed = { ...game.mission?.cardsPlayed, [currentUserId]: card };

        await this.firestoreService.updateDocument('games', gameId, { 'mission.cardsPlayed': updatedCardsPlayed }, true);
    }

    async nextRound(): Promise<void> {
        const gameId = this.activeGameId();
        const game = this.currentGame();

        if (!gameId || !game || game.status !== 'results' || game.winner) {
            // Only proceed if in results phase and game is not over
            return;
        }

        const currentStoryNum = (game.currentStoryNum ?? 0) + 1;
        const totalStories = game.storiesTotal ?? 5;

        if (currentStoryNum > totalStories) {
            // Handle end of game if all stories are played
            // This might involve the assassination phase or declaring a winner based on mission results
            let winner: 'dexter' | 'sinister' | undefined = undefined;
            const dexterWins = game.storyResults?.filter(r => r === 'dexter').length ?? 0;
            const sinisterWins = game.storyResults?.filter(r => r === 'sinister').length ?? 0;

            if (dexterWins > sinisterWins) {
                // Dexter wins unless there's an assassination phase
                // TODO: Implement assassination phase logic if applicable
                winner = 'dexter';
            } else if (sinisterWins >= dexterWins) {
                 // Sinister wins if they have more or equal failed missions
                 winner = 'sinister';
            }

            await this.firestoreService.updateDocument(
                'games',
                gameId,
                {
                    status: 'gameOver',
                    winner: winner,
                    gameLog: [...(game.gameLog || []), { timestamp: new Date(), message: `All stories played. Game over! ${winner ? winner.toUpperCase() + ' wins!' : ''}` }],
                },
                true
            );

        } else {
            // Move to the next round
            const playerIds = game.playerOrder || [];
            const currentTOIndex = playerIds.indexOf(game.currentTO_id!);
            const nextTOIndex = (currentTOIndex + 1) % playerIds.length;
            const nextTOId = playerIds[nextTOIndex];

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
        }
    }

}
