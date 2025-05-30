import { Component, computed, inject } from "@angular/core";
import { Game } from "../interfaces/game.interface";
import { AuthService } from "../services/auth.service";
import { GameService } from "../services/game.service";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";

// --- Game Board Component (Very Basic Stub) ---
@Component({
    selector: 'app-game-board',
    standalone: true,
    template: `
        <div class="min-h-screen flex flex-col" style="background-image: url('https://via.placeholder.com/1920x1080/1A202C/FFFFFF?Text=Game+Board+Background'); background-size: cover;">
            <nav class="bg-black bg-opacity-60 p-3 flex justify-between items-center shadow-lg text-sm sticky top-0 z-20">
                <div>Game: {{ gameService.currentGame()?.name }} - Round: {{ gameService.currentGame()?.currentStoryNum }} / {{ gameService.currentGame()?.storiesTotal }}</div>
                <div>My Role: <span class="font-bold text-cyan-400">{{ myRole() }}</span></div>
                <button (click)="gameService.leaveGame()" class="text-red-300 hover:text-red-100">Quit Game</button>
            </nav>

            @if (gameService.currentGame(); as game) {

            }

            @if (gameService.currentGame(); as game) {
                <div class="flex-grow container mx-auto p-4">
                    <div class="flex flex-wrap justify-center items-center gap-2 md:gap-4 p-2 md:p-4 mb-4">
                        @for (playerId of game.playerOrder; track playerId) {
                            <div class="p-2 rounded-full text-center w-20 h-20 md:w-24 md:h-24 flex flex-col justify-center items-center border-2"
                                 [ngClass]="{
                                    'border-yellow-400 shadow-yellow-400/50 shadow-lg': playerId === game.currentTO_id,
                                    'border-gray-600': playerId !== game.currentTO_id
                                 }">
                                <img src="https://via.placeholder.com/40/{{ getPlayerColor(playerId) }}/FFFFFF?Text={{game.players[playerId].name.substring(0,1).toUpperCase() || 'P'}}" alt="P" class="w-8 h-8 md:w-10 md:h-10 rounded-full mb-1">
                                <span class="text-xs md:text-sm truncate w-full">{{ game.players[playerId].name }}</span>
                                @if (playerId === authService.userId()) {
                                    <span class="text-xs text-yellow-300">(You)</span>
                                }
                            </div>
                        }
                    </div>

                    <div class="bg-slate-800 bg-opacity-80 p-3 my-2 flex flex-col md:flex-row justify-around items-center text-sm sticky top-[calc(env(safe-area-inset-top)_+_3.5rem)] z-10 shadow-md rounded">
                        <div>
                            User Stories:
                            <span class="flex">
                                @for (result of game.storyResults; track $index) {
                                    <span class="w-10 h-6 md:w-12 md:h-8 border mx-0.5 flex items-center justify-center text-xs rounded"
                                          [ngClass]="{
                                            'bg-blue-500 border-blue-400': result === 'dexter',
                                            'bg-red-500 border-red-400': result === 'sinister',
                                            'bg-gray-600 border-gray-500': result === null
                                          }">
                                        {{ $index + 1 }}
                                    </span>
                                }
                            </span>
                        </div>
                        <div class="my-1 md:my-0">Current Phase: <strong class="text-yellow-400">{{ game.status | titlecase }}</strong></div>
                        <div>
                            Rethrows: <span class="font-bold">{{ game.voteFailsThisRound || 0 }}</span> / 5
                        </div>
                    </div>

                    <div class="bg-slate-700 bg-opacity-90 p-4 md:p-6 rounded-lg shadow-xl min-h-[200px] md:min-h-[300px] flex flex-col items-center justify-center">
                        <h2 class="text-2xl font-semibold mb-4">{{ getPhaseTitle(game.status) }}</h2>

                        @switch (game.status) {
                            @case ('teamProposal') {
                                <div>
                                    @if (authService.userId() === game.currentTO_id) {
                                        <p class="mb-2">
                                            You are the TO. Select {{ getNumToSelect(game) }} players for User Story #{{game.currentStoryNum}}.
                                        </p>
                                        <div class="flex flex-wrap gap-2 mb-4">
                                            @for (playerId of game.playerOrder; track playerId) {
                                                <button class="px-3 py-1 rounded"
                                                        [ngClass]="{'bg-blue-500 text-white': selectedPlayers.includes(playerId), 'bg-gray-300 text-black': !selectedPlayers.includes(playerId)}"
                                                        (click)="togglePlayerSelection(playerId, game)">
                                                        {{ game.players[playerId]?.name }}
                                                </button>
                                            }
                                        </div>
                                        <button (click)="proposeTeam(game)"
                                                [disabled]="selectedPlayers.length !== getNumToSelect(game)"
                                                class="bg-green-500 hover:bg-green-600 px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                                                Propose Team
                                        </button>
                                    } @else {
                                        <p class="mb-2">
                                            Waiting for {{ game.players[game.currentTO_id!].name }} (TO) to propose a team.
                                        </p>
                                    }
                                    <!-- Removed duplicate Propose Team button -->
                                </div>
                            }
                            @case ('teamVoting') {
                                <div>
                                    <p class="mb-2">Team proposed by {{ game.players[game.currentTO_id!].name }}. Vote:</p>
                                    <div class="mb-4 text-lg">
                                        <!-- Display only the proposed team members -->
                                        Proposed Team: <span class="font-bold">{{ getProposedTeamNames(game) }}</span>

                                        <!-- Display voting status for all players -->
                                        <div class="mt-2">
                                            <p>Voting Status:</p>
                                            @for (playerId of game.playerOrder; track playerId) {
                                                <span [ngClass]="{'font-bold text-yellow-300': game.teamVote?.votes?.[playerId] === undefined, 'text-green-300': game.teamVote?.votes?.[playerId] === 'agree', 'text-red-300': game.teamVote?.votes?.[playerId] === 'rethrow'}">
                                                    {{ game.players[playerId]?.name }}:
                                                    {{ game.teamVote?.votes?.[playerId] ? (game.teamVote?.votes?.[playerId] === 'agree' ? 'Agreed' : 'Rethrow') : 'Not Voted' }}
                                                    @if (!$last){
                                                        ', '
                                                    }
                                                </span>
                                            }
                                        </div>

                                        <p class="mb-2">
                                            Votes Cast: {{ teamVoteCount() }} / {{ game.playerOrder.length }}
                                        </p>

                                        <p class="mb-4">Vote to AGREE or RETHROW.</p>
                                        <button (click)="gameService.submitVote('agree')"
                                                [disabled]="!!game.teamVote?.votes?.[authService.userId()!]"
                                                class="bg-green-500 hover:bg-green-600 px-6 py-3 rounded text-lg mr-2 disabled:opacity-50 disabled:cursor-not-allowed">
                                                AGREE
                                        </button>
                                        <button (click)="gameService.submitVote('rethrow')"
                                                [disabled]="!!game.teamVote?.votes?.[authService.userId()!]">
                                        </button>
                                        <button (click)="gameService.submitVote('rethrow')" class="bg-red-500 hover:bg-red-600 px-6 py-3 rounded text-lg">RETHROW</button>
                                    </div>
                                </div>
                            }
                            @case ('mission') {
                                <div>
                                    <p class="mb-2">Team on mission: <span class="font-bold">{{ getMissionTeamNames(game) }}</span></p>
                                    @if (isPlayerOnMission(game)) {
                                        <p class="mb-4">Play your card (Approve/Request).</p>
                                        <div class="flex gap-4">
                                            <button (click)="gameService.submitMissionCard('approve')"
                                                    [disabled]="!!game.mission?.cardsPlayed?.[authService.userId()!]"
                                                    class="bg-green-600 p-4 rounded w-24 h-32 disabled:opacity-50 disabled:cursor-not-allowed">
                                                APPROVE
                                            </button>
                                            <button (click)="gameService.submitMissionCard('request')"
                                                    [disabled]="!!game.mission?.cardsPlayed?.[authService.userId()!]"
                                                    class="bg-green-600 p-4 rounded w-24 h-32 disabled:opacity-50 disabled:cursor-not-allowed">
                                                APPROVE
                                            </button>
                                            <button (click)="gameService.submitMissionCard('request')"
                                                    [disabled]="!!game.mission?.cardsPlayed?.[authService.userId()!]"
                                                    class="bg-red-600 p-4 rounded w-24 h-32 disabled:opacity-50 disabled:cursor-not-allowed">
                                                REQUEST
                                            </button>
                                        </div>
                                        <p class="mt-4 text-sm">
                                            Cards Played: {{ missionCardsPlayedCount() }} / {{ game.mission?.team?.length }}
                                        </p>
                                    } @else {
                                        <p class="mb-4">Waiting for mission results...</p>
                                    }
                                </div>
                            }
                            @case ('results') {
                                <div>
                                @if (game.storyResults && (game.currentStoryNum ?? 1) > 1) {
                                    @if (game.storyResults[(game.currentStoryNum ?? 1) - 2] === 'dexter') {
                                        <p class="text-xl font-bold text-green-400 mb-4">User Story #{{ (game.currentStoryNum ?? 1) - 1 }} Succeeded!</p>
                                    } @else if (game.storyResults[(game.currentStoryNum ?? 1) - 2] === 'sinister') {
                                        <p class="text-xl font-bold text-red-400 mb-4">User Story #{{ (game.currentStoryNum ?? 1) - 1 }} Failed!</p>
                                    }
                                } @else {
                                    <p class="mb-2">Processing results...</p>
                                }

                                <button (click)="nextRound()" class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded">Next Round</button>
                                </div>
                            }
                            @case ('gameOver') {
                                <div>
                                    <h3 class="text-3xl font-bold mb-2">{{ game.winner }} Wins!</h3>
                                    <button (click)="gameService.leaveGame()" class="bg-gray-500 px-4 py-2 rounded">Back to Dashboard</button>
                                </div>
                            }
                            @default {
                                <p>Waiting for game to progress...</p>
                            }
                        }
                    </div>

                    <div class="grid md:grid-cols-2 gap-4 mt-4">
                        <div class="bg-slate-700 bg-opacity-90 p-3 rounded">
                            <h4 class="font-semibold border-b border-slate-600 pb-1 mb-1 text-sm">Your Role: <span class="text-cyan-300">{{myRole()}}</span></h4>
                            <p class="text-xs text-gray-300">{{getRoleDescription(myRole())}}</p>
                        </div>
                        <div class="bg-slate-700 bg-opacity-90 p-3 rounded">
                            <h4 class="font-semibold border-b border-slate-600 pb-1 mb-1 text-sm">Game Chat (Conceptual)</h4>
                            <div class="h-20 overflow-y-auto text-xs bg-slate-800 p-1 rounded"></div>
                        </div>
                    </div>
                </div>
            } @else {
                <div class="text-center p-8">Loading game...</div>
            }
        </div>
    `,
    imports: [CommonModule, FormsModule]
})
export class GameBoardComponent {
    authService = inject(AuthService);
    gameService = inject(GameService);

 selectedPlayers: string[] = []; // Array to hold selected player IDs for team proposal

    myRole = computed(() => {
        const game = this.gameService.currentGame();
        const myId = this.authService.userId();
        if (game && myId && game.roles && game.roles[myId]) {
            return game.roles[myId];
        }
        return 'Unknown';
    });

    teamVoteCount = computed(() => {
        const game = this.gameService.currentGame();
        if (game?.teamVote?.votes) {
            return Object.keys(game.teamVote.votes).length;
        }
        return 0;
    });

    missionCardsPlayedCount = computed(() => {
        const game = this.gameService.currentGame();
        if (game?.mission?.cardsPlayed) {
            return Object.keys(game.mission.cardsPlayed).length;
        }
        return 0;
    });

    getPlayerColor(playerId: string): string {
        let hash = 0;
        for (let i = 0; i < playerId.length; i++) {
            hash = playerId.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash;
        }
        const color = Math.abs(hash).toString(16).substring(0, 6);
        return "000000".substring(0, 6 - color.length) + color;
    }


    getPhaseTitle(status: Game['status'] | undefined): string {
        if (!status) return 'Loading...';
        switch(status) {
            case 'teamProposal': return 'Team Proposal';
            case 'teamVoting': return 'Team Vote';
            case 'mission': return 'Pull Request Review';
            case 'results': return 'Results';
            case 'gameOver': return 'Game Over';
            default: return status.charAt(0).toUpperCase() + status.slice(1);
        }
    }

    getNumToSelect(game: Game): number {
        const playerCount = game.playerOrder.length;
        const storyNum = game.currentStoryNum || 1;
        // Based on "manual (1).pdf" page 6 (5 User Story Team Size)
        // Players:       5  6  7  8  9 10
        // 1st User Story: 2  2  2  3  3  3
        // 2nd User Story: 3  3  3  4  4  4
        // 3rd User Story: 2  4  3  4  4  4  (Note: 6p/3rd is 4, not 3 as in some games)
        // 4th User Story: 3  3  4  5  5  5  (* requires 2 fails for 7+ players)
        // 5th User Story: 3  4  4  5  5  5
        const teamSizes: {[key: number]: number[]} = {
             5: [2,3,2,3,3],
             6: [2,3,4,3,4], // Corrected 6p/3rd to 4
             7: [2,3,3,4,4], // Avalon has 2,3,3,4*,4 for 7p. Sprint has 2,3,3,4*,4.
             8: [3,4,4,5,5],
             9: [3,4,4,5,5],
            10: [3,4,4,5,5],
            11: [3,4,5,5,5], // Assuming similar pattern for 11,12 or use 7-story chart
            12: [3,4,5,5,5],
        };
        return (teamSizes[playerCount] && teamSizes[playerCount][storyNum - 1]) || 2;
    }

    getProposedTeamNames(game: Game): string {
        if (!game.teamVote?.proposedTeam) return 'N/A';
        return game.teamVote.proposedTeam.map(id => game.players[id]?.name || 'Unknown').join(', ');
    }

    getMissionTeamNames(game: Game): string {
        if (!game.mission?.team) return 'N/A';
        return game.mission.team.map(id => game.players[id]?.name || 'Unknown').join(', ');
    }

    isPlayerOnMission(game: Game): boolean {
        const myId = this.authService.userId();
        return !!(myId && game.mission?.team?.includes(myId));
    }

    getRoleDescription(role: string): string {
        if (role === 'Duke') return "You know Sinister. Guide Dexter. Must Approve.";
        if (role === 'Sniper') return "Sinister. If Dexter wins, you can snipe the Duke.";
        if (role === 'SinisterSpy') return "Sinister. Cause missions to fail. Can Approve/Request.";
        if (role === 'LoyalDexter') return "Dexter. Help missions succeed. Must Approve.";
        return "Your objective will be revealed.";
    }

    proposeTeam(game: Game): void {
        console.log("Propose Team clicked");
        // Convert selectedPlayers IDs to Player objects
        const selectedTeam = this.selectedPlayers.map(playerId => game.players[playerId]);
        this.gameService.proposeTeam(selectedTeam);
    }

    togglePlayerSelection(playerId: string, game: Game): void {
        const numToSelect = this.getNumToSelect(game);

        // If player is already selected, remove them
        if (this.selectedPlayers.includes(playerId)) {
            this.selectedPlayers = this.selectedPlayers.filter(id => id !== playerId);
        }
        // If player is not selected and we haven't reached the limit, add them
        else if (this.selectedPlayers.length < numToSelect) {
            this.selectedPlayers.push(playerId);
        }
        // If we've reached the limit, replace the first selected player
        else {
            this.selectedPlayers.shift(); // Remove the first player
            this.selectedPlayers.push(playerId); // Add the new player
        }
    }

    nextRound(): void {
        this.gameService.nextRound();
    }
}
