import { Component, inject, signal } from "@angular/core";
import { AuthService } from "../services/auth.service";
import { GameService } from "../services/game.service";

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

            <div *ngIf="gameService.currentGame(); let game" class="container mx-auto p-8 flex-grow flex flex-col md:flex-row gap-6">
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
                            <div *ngFor="let playerId of game.playerOrder" class="flex items-center gap-3 p-2 bg-slate-800 rounded">
                                <img src="https://via.placeholder.com/60/4A90E2/FFFFFF?Text={{game.players[playerId].name?.substring(0,1) || 'P'}}" alt="Avatar" class="w-12 h-12 rounded-full border-2 border-blue-400">
                                <span class="font-medium text-lg">{{ game.players[playerId].name }} {{ game.players[playerId].isHost ? '(Host)' : '' }}</span>
                            </div>
                        </div>
                        <p *ngIf="objectKeys(game.players).length < game.settings.maxPlayers" class="text-center text-gray-400 mt-4">
                            Waiting for {{ game.settings.maxPlayers - objectKeys(game.players).length }} more player(s)...
                        </p>
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
                        <button *ngIf="authService.userId() === game.hostId" 
                                (click)="handleStartGame()"
                                [disabled]="objectKeys(game.players).length < 5" 
                                class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-lg text-xl disabled:opacity-50">
                            {{ objectKeys(game.players).length < 5 ? 'Need Min 5 Players' : 'Start Game' }}
                        </button>
                        <p *ngIf="authService.userId() !== game.hostId" class="text-gray-400">Waiting for host to start the game...</p>
                        <p *ngIf="startGameError()" class="text-red-400 mt-2">{{startGameError()}}</p>
                    </div>
                </div>
            </div>
            <div *ngIf="!gameService.currentGame()" class="text-center p-8">Loading game data or game not found...</div>
        </div>
    `,
    imports: [] // Add CommonModule for *ngFor, *ngIf
})
export class LobbyComponent {
    authService = inject(AuthService);
    gameService = inject(GameService);
    startGameError = signal<string | null>(null);

    objectKeys = Object.keys; // Helper to use Object.keys in template

    async handleStartGame() {
        this.startGameError.set(null);
        try {
            await this.gameService.startGame();
            // AppComponent effect will handle navigation to GameBoardComponent
        } catch (error: any) {
            this.startGameError.set(error.message || "Failed to start game.");
            console.error("Start game error:", error);
        }
    }
}