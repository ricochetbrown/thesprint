import { Component, computed, inject } from "@angular/core";
import { Game } from "../interfaces/game.interface";
import { AuthService } from "../services/auth.service";
import { GameService } from "../services/game.service";
import { CommonModule } from "@angular/common";

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

            <div *ngIf="gameService.currentGame(); let game" class="flex-grow container mx-auto p-4">
                <div class="flex flex-wrap justify-center items-center gap-2 md:gap-4 p-2 md:p-4 mb-4">
                    <div *ngFor="let playerId of game.playerOrder" 
                         class="p-2 rounded-full text-center w-20 h-20 md:w-24 md:h-24 flex flex-col justify-center items-center border-2"
                         [ngClass]="{
                            'border-yellow-400 shadow-yellow-400/50 shadow-lg': playerId === game.currentTO_id,
                            'border-gray-600': playerId !== game.currentTO_id
                         }">
                        <img src="https://via.placeholder.com/40/{{ getPlayerColor(playerId) }}/FFFFFF?Text={{game.players[playerId].name?.substring(0,1) || 'P'}}" alt="P" class="w-8 h-8 md:w-10 md:h-10 rounded-full mb-1">
                        <span class="text-xs md:text-sm truncate w-full">{{ game.players[playerId].name }}</span>
                        <span *ngIf="playerId === authService.userId()" class="text-xs text-yellow-300">(You)</span>
                    </div>
                </div>

                <div class="bg-slate-800 bg-opacity-80 p-3 my-2 flex flex-col md:flex-row justify-around items-center text-sm sticky top-[calc(env(safe-area-inset-top)_+_3.5rem)] z-10 shadow-md rounded">
                    <div>
                        User Stories:
                        <span class="flex">
                            <span *ngFor="let result of game.storyResults; let i = index"
                                  class="w-10 h-6 md:w-12 md:h-8 border mx-0.5 flex items-center justify-center text-xs rounded"
                                  [ngClass]="{
                                    'bg-blue-500 border-blue-400': result === 'dexter',
                                    'bg-red-500 border-red-400': result === 'sinister',
                                    'bg-gray-600 border-gray-500': result === null
                                  }">
                                {{ i + 1 }}
                            </span>
                        </span>
                    </div>
                    <div class="my-1 md:my-0">Current Phase: <strong class="text-yellow-400">{{ game.status }}</strong></div>
                    <div>
                        Rethrows: <span class="font-bold">{{ game.voteFailsThisRound || 0 }}</span> / 5
                    </div>
                </div>
                
                <div class="bg-slate-700 bg-opacity-90 p-4 md:p-6 rounded-lg shadow-xl min-h-[200px] md:min-h-[300px] flex flex-col items-center justify-center">
                    <h2 class="text-2xl font-semibold mb-4">{{ getPhaseTitle(game.status) }}</h2>
                    
                    <div *ngIf="game.status === 'teamProposal'">
                        <p *ngIf="authService.userId() === game.currentTO_id" class="mb-2">
                            You are the TO. Select {{ getNumToSelect(game) }} players for User Story #{{game.currentStoryNum}}.
                        </p>
                        <p *ngIf="authService.userId() !== game.currentTO_id" class="mb-2">
                            Waiting for {{ game.players[game.currentTO_id!]?.name }} (TO) to propose a team.
                        </p>
                        <button *ngIf="authService.userId() === game.currentTO_id" class="bg-green-500 hover:bg-green-600 px-4 py-2 rounded">Propose Team (TODO)</button>
                    </div>

                    <div *ngIf="game.status === 'teamVoting'">
                        <p class="mb-2">Team proposed by {{ game.players[game.currentTO_id!]?.name }}: 
                            <span class="font-bold">{{ getProposedTeamNames(game) }}</span>
                        </p>
                        <p class="mb-4">Vote to AGREE or RETHROW.</p>
                        <button class="bg-green-500 hover:bg-green-600 px-6 py-3 rounded text-lg mr-2">AGREE (TODO)</button>
                         <button class="bg-red-500 hover:bg-red-600 px-6 py-3 rounded text-lg">RETHROW (TODO)</button>
                    </div>
                    
                    <div *ngIf="game.status === 'mission'">
                        <p class="mb-2">Team on mission: <span class="font-bold">{{ getMissionTeamNames(game) }}</span></p>
                        <p *ngIf="isPlayerOnMission(game)" class="mb-4">Play your card (Approve/Request).</p>
                        <p *ngIf="!isPlayerOnMission(game)" class="mb-4">Waiting for mission results...</p>
                        <div *ngIf="isPlayerOnMission(game)" class="flex gap-4">
                            <button class="bg-green-600 p-4 rounded w-24 h-32">APPROVE (TODO)</button>
                            <button class="bg-red-600 p-4 rounded w-24 h-32">REQUEST (TODO)</button>
                        </div>
                    </div>

                    <div *ngIf="game.status === 'results'">
                        <p class="mb-2">Displaying results for User Story #{{(game.currentStoryNum ?? 0) - 1}} or Vote...</p>
                        <button class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded">Next Round (TODO)</button>
                    </div>

                    <div *ngIf="game.status === 'gameOver'">
                        <h3 class="text-3xl font-bold mb-2">{{ game.winner?.toUpperCase() }} Wins!</h3>
                        <button (click)="gameService.leaveGame()" class="bg-gray-500 px-4 py-2 rounded">Back to Dashboard</button>
                    </div>

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
            <div *ngIf="!gameService.currentGame()" class="text-center p-8">Loading game...</div>
        </div>
    `,
    imports: [
        CommonModule
    ] // Add CommonModule
})
export class GameBoardComponent {
    authService = inject(AuthService);
    gameService = inject(GameService);

    myRole = computed(() => {
        const game = this.gameService.currentGame();
        const myId = this.authService.userId();
        if (game && myId && game.roles && game.roles[myId]) {
            return game.roles[myId];
        }
        return 'Unknown';
    });

    getPlayerColor(playerId: string): string {
        // Simple color hashing for variety
        let hash = 0;
        for (let i = 0; i < playerId.length; i++) {
            hash = playerId.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        return "00000".substring(0, 6 - c.length) + c;
    }

    getPhaseTitle(status: Game['status']): string {
        switch(status) {
            case 'teamProposal': return 'Team Proposal';
            case 'teamVoting': return 'Team Vote';
            case 'mission': return 'Pull Request Review';
            case 'results': return 'Results';
            case 'gameOver': return 'Game Over';
            default: return 'Ongoing Game';
        }
    }

    getNumToSelect(game: Game): number {
        // Placeholder - this logic is complex and depends on player count and story number
        // from "manual (1).pdf" page 6.
        const playerCount = game.playerOrder.length;
        const storyNum = game.currentStoryNum || 1;
        if (playerCount === 5) { // Example for 5 players
            const map = [2,3,2,3,3]; // 1st, 2nd, 3rd, 4th, 5th story
            return map[storyNum - 1] || 2;
        }
        return 2; // Default
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
        // Basic descriptions
        if (role === 'Duke') return "You know Sinister. Guide Dexter. Must Approve.";
        if (role === 'Sniper') return "Sinister. If Dexter wins, you can snipe the Duke.";
        if (role === 'SinisterSpy') return "Sinister. Cause missions to fail. Can Approve/Request.";
        if (role === 'LoyalDexter') return "Dexter. Help missions succeed. Must Approve.";
        return "Your objective will be revealed.";
    }
}