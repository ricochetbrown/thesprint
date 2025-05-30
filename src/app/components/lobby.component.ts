import { Component, inject, signal } from "@angular/core";
import { AuthService } from "../services/auth.service";
import { GameService } from "../services/game.service";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";

// --- Lobby Component ---
@Component({
    selector: 'app-lobby',
    standalone: true,
    template: `
       <div class="min-h-screen flex flex-col" style="background-image: url('https://via.placeholder.com/1920x1080/3D4852/FFFFFF?Text=Lobby+Background'); background-size: cover;">
            <nav class="bg-black bg-opacity-50 p-4 flex justify-between items-center shadow-lg">
                <img src="https://via.placeholder.com/120/007ACC/FFFFFF?Text=SPRINT" alt="The Sprint Logo" class="h-10">
                <div class="text-xl font-semibold">
                    Game Lobby: {{ gameService.currentGame()?.name }} (Code: {{ gameService.activeGameId() }})
                </div>
                <button (click)="gameService.leaveGame()" class="text-red-400 hover:text-red-200">Leave Lobby</button>
            </nav>

            @if (gameService.currentGame(); as game) {
                <div class="container mx-auto p-8 flex-grow flex flex-col md:flex-row gap-6">
                    <div class="md:w-1/3 space-y-6">
                        <div class="bg-slate-700 bg-opacity-85 p-6 rounded-lg shadow-xl">
                            <h2 class="text-2xl font-semibold mb-4 border-b border-slate-600 pb-2">Game Settings</h2>
                            <p><strong>Host:</strong> {{ game.hostName }}</p>
                            <p><strong>Players:</strong> {{ objectKeys(game.players).length }} / {{ game.settings.maxPlayers }}</p>
                            <p><strong>Visibility:</strong> {{ game.settings.isPublic ? 'Public' : 'Private' }}</p>
                        </div>
                        <div class="bg-slate-700 bg-opacity-85 p-6 rounded-lg shadow-xl">
                            <h2 class="text-2xl font-semibold mb-4 border-b border-slate-600 pb-2">Players</h2>
                            <div class="space-y-3">
                                @for (playerId of game.playerOrder; track playerId) {
                                    <div class="flex items-center gap-3 p-2 bg-slate-800 rounded">
                                        <img src="https://via.placeholder.com/60/{{ getPlayerColor(playerId) }}/FFFFFF?Text={{game.players[playerId].name.substring(0,1).toUpperCase() || 'P'}}" alt="Avatar" class="w-12 h-12 rounded-full border-2" [style.borderColor]="'#' + getPlayerColor(playerId)">
                                        <span class="font-medium text-lg">{{ game.players[playerId].name }} {{ game.players[playerId].isHost ? '(Host)' : '' }}</span>
                                        @if (playerId === authService.userId()) {
                                            <span class="text-xs text-yellow-300 ml-auto">(You)</span>
                                        }
                                    </div>
                                }
                            </div>
                            @if (objectKeys(game.players).length < game.settings.maxPlayers) {
                                <p class="text-center text-gray-400 mt-4">
                                    Waiting for {{ game.settings.maxPlayers - objectKeys(game.players).length }} more player(s)...
                                </p>
                            }
                        </div>
                    </div>

                    <div class="md:w-2/3 bg-slate-700 bg-opacity-85 p-6 rounded-lg shadow-xl flex flex-col">
                        <h2 class="text-2xl font-semibold mb-4 border-b border-slate-600 pb-2">Lobby Chat (Conceptual)</h2>
                        <div class="flex-grow bg-slate-800 p-3 rounded mb-4 min-h-[200px]"></div>
                        <form class="flex gap-2">
                            <input type="text" class="flex-grow p-3 bg-slate-600 rounded border border-slate-500" placeholder="Type your message...">
                            <button type="submit" class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-5 rounded">Send</button>
                        </form>

                        <div class="mt-6 text-center">
                            @if (authService.userId() === game.hostId) {
                                @if (objectKeys(game.players).length < game.settings.maxPlayers) {
                                <button (click)="fillWithAIPlayers()"
                                        [disabled]="objectKeys(game.players).length >= game.settings.maxPlayers"
                                        class="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-3 px-6 rounded-lg text-xl disabled:opacity-50 disabled:cursor-not-allowed mr-4">
                                    Fill with AI
                                </button>
                                }

                                <button (click)="handleStartGame()"
                                        [disabled]="objectKeys(game.players).length < 5 || objectKeys(game.players).length > 12" 
                                        class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-lg text-xl disabled:opacity-50 disabled:cursor-not-allowed" [class.bg-red-500]="objectKeys(game.players).length > 12">
                                    {{ objectKeys(game.players).length < 5 ? 'Need Min 5 Players' : 'Start Game' }}
                                </button>
                            } @else {
                                <p class="text-gray-400">Waiting for host ({{game.hostName}}) to start the game...</p>
                            }
                            @if (startGameError()) {
                                <p class="text-red-400 mt-2">{{startGameError()}}</p>
                            }
                        </div>
                    </div>
                </div>
            } @else {
                <div class="text-center p-8">Loading game data or game not found...</div>
            }
        </div>
    `,
    imports: [CommonModule, FormsModule]
})
export class LobbyComponent {
    authService = inject(AuthService);
    gameService = inject(GameService);
    startGameError = signal<string | null>(null);

    objectKeys = Object.keys;

    getPlayerColor(playerId: string): string {
        let hash = 0;
        for (let i = 0; i < playerId.length; i++) {
            hash = playerId.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash; 
        }
        const color = Math.abs(hash).toString(16).substring(0, 6);
        return "000000".substring(0, 6 - color.length) + color;
    }

    async handleStartGame() {
        this.startGameError.set(null);
        try {
            await this.gameService.startGame();
        } catch (error: any) {
            this.startGameError.set(error.message || "Failed to start game.");
            console.error("Start game error:", error);
        }
    }

    async fillWithAIPlayers() {
        const game = this.gameService.currentGame();
        if (game) {
            const playersNeeded = game.settings.maxPlayers - this.objectKeys(game.players).length;
            if (playersNeeded > 0) {
                await this.gameService.addAIPlayers(game.id, playersNeeded);
            }
        }
    }
}